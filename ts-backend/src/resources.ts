import { execFile } from "node:child_process";
import { readFile, readdir } from "node:fs/promises";
import { cpus, release } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

type Counter = number | null;
export interface ResourceComponent {
  id: string;
  name: string;
  pid: number | null;
  cpuPercent: Counter;
  ramBytes: Counter;
  vramBytes: Counter;
  includedIn?: "backend" | "speech";
}
export interface ResourceSnapshot {
  sampledAt: number;
  intervalMs: number;
  cpu: { name: string; cores: number };
  total: { cpuPercent: Counter; ramBytes: Counter; vramBytes: Counter };
  components: ResourceComponent[];
  gpus: { name: string; uuid: string; utilizationPercent: Counter; vramUsedBytes: Counter; vramTotalBytes: Counter }[];
  notes: string[];
}
type Command = (file: string, args: string[]) => Promise<string>;
interface Options {
  sidecarUrl?: string;
  sidecarPid?: number;
  backendPid?: number;
  procRoot?: string;
  clockTicks?: number;
  now?: () => number;
  wsl?: boolean;
  command?: Command;
}
interface Proc { pid: number; parent: number; name: string; ticks: number; started: number }

const execute = promisify(execFile);
const command: Command = async (file, args) => (await execute(file, args, { timeout: 1500, maxBuffer: 256 * 1024 })).stdout;
const numeric = (value: string | undefined): Counter => value?.trim() && /^\d+(\.\d+)?$/.test(value.trim()) ? Number(value) : null;
const mib = (value: string | undefined): Counter => { const n = numeric(value); return n === null ? null : n * 1024 * 1024; };
const sum = (values: Counter[]): Counter => values.length && values.every(v => v !== null) ? values.reduce<number>((a, b) => a + b!, 0) : null;
const validPid = (pid: unknown): pid is number => Number.isSafeInteger(pid) && Number(pid) > 0;

/** One sampler shared by the terminal and API. It never touches model engines
 * or sends inference requests. CPU uses process ticks (100% = one CPU core);
 * RAM is resident memory, including owned subprocesses, not JS/Python heaps. */
export class ResourceMonitor {
  snapshot: ResourceSnapshot | null = null;
  private previous = new Map<string, { ticks: number; at: number }>();
  private previousGroups = new Map<string, { ticks: number; at: number; members: Set<string> }>();
  private rootStarts = new Map<number, number>();
  private ticks: number | null | undefined;
  private timer?: ReturnType<typeof setTimeout>;
  private stopped = true;
  private pending?: Promise<ResourceSnapshot>;
  private readonly run: Command;
  private readonly procRoot: string;
  private readonly backendPid: number;
  private readonly wsl: boolean;

  constructor(private options: Options = {}) {
    this.run = options.command ?? command;
    this.procRoot = options.procRoot ?? "/proc";
    this.backendPid = options.backendPid ?? process.pid;
    this.ticks = options.clockTicks;
    this.wsl = options.wsl ?? /microsoft/i.test(release());
  }

  sample(): Promise<ResourceSnapshot> {
    // Browser requests and the terminal must not launch overlapping probes.
    if (!this.pending) this.pending = this.collect().finally(() => { this.pending = undefined; });
    return this.pending;
  }

  start(log: (line: string) => void = console.log): void {
    if (!this.stopped) return;
    this.stopped = false;
    let first = true;
    const tick = async () => {
      try {
        const snapshot = await this.sample();
        if (!this.stopped) {
          if (first) { log(`[resources] CPU: ${snapshot.cpu.name} (${snapshot.cpu.cores} logical cores; 100% = one core). GPU counters labeled device include other applications. N/A = counter unavailable or warming up.`); first = false; }
          log(formatResourceLine(snapshot));
        }
      }
      catch { if (!this.stopped) log("[resources] Resource counters unavailable"); }
      if (!this.stopped) { this.timer = setTimeout(tick, 5000); this.timer.unref(); }
    };
    void tick();
  }

  stop(): void { this.stopped = true; clearTimeout(this.timer); }

  private async speechPid(processes: Map<number, Proc>): Promise<number | null> {
    if (validPid(this.options.sidecarPid)) {
      const entry = processes.get(this.options.sidecarPid);
      const started = this.rootStarts.get(this.options.sidecarPid);
      if (entry && (started === undefined || started === entry.started)) return entry.pid;
    }
    if (!this.options.sidecarUrl) return null;
    try {
      const url = new URL(this.options.sidecarUrl);
      // A remote service's PID belongs to another host or namespace.
      if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) return null;
      const response = await fetch(new URL("health", this.options.sidecarUrl.replace(/\/?$/, "/")), { signal: AbortSignal.timeout(1000) });
      if (!response.ok) return null;
      const health = await response.json();
      const entry = processes.get(health.pid);
      if (health.service === "sawot-inference" && validPid(health.pid) && entry) {
        // Ensure loopback wasn't forwarded into a different PID namespace.
        const cmdline = await readFile(join(this.procRoot, String(health.pid), "cmdline"), "utf8");
        if (cmdline.includes("sidecar.main")) return health.pid;
      }
    } catch { /* Loading, disconnected, or a sidecar from an older version. */ }
    return null;
  }

  private async collect(): Promise<ResourceSnapshot> {
    const at = (this.options.now ?? (() => performance.now()))();
    const notes = ["CPU: 100% = one logical core. RAM: summed resident memory; shared pages may be counted more than once.",
      "Subprocess rows are included in their Backend or Speech component totals.",
      "External model servers, browsers and remote providers are excluded from SAWOT process totals. GPU device counters include all applications."];
    const processes = new Map<number, Proc>();
    try {
      const ids = (await readdir(this.procRoot)).filter(id => /^\d+$/.test(id));
      // Bound concurrent file descriptors on busy hosts.
      for (let i = 0; i < ids.length; i += 64) await Promise.all(ids.slice(i, i + 64).map(async id => {
        try {
          const stat = await readFile(join(this.procRoot, id, "stat"), "utf8");
          const end = stat.lastIndexOf(")");
          const fields = stat.slice(end + 2).trim().split(/\s+/);
          const proc = { pid: Number(id), parent: Number(fields[1]), name: stat.slice(stat.indexOf("(") + 1, end),
            // Waited-child ticks retain work from helpers (e.g. ffmpeg) that
            // start and exit entirely between samples. Summing a live tree's
            // lifetime ticks also prevents reaping from counting them twice.
            ticks: Number(fields[11]) + Number(fields[12]) + Number(fields[13]) + Number(fields[14]), started: Number(fields[19]) };
          if (end > 0 && Number.isFinite(proc.ticks) && Number.isFinite(proc.started)) processes.set(proc.pid, proc);
        } catch { /* Process exited, or proc visibility is restricted. */ }
      }));
    } catch { notes.push("Process-tree counters require Linux /proc access."); }
    if (this.ticks === undefined) {
      try { this.ticks = numeric((await this.run("getconf", ["CLK_TCK"])).trim()); }
      catch { this.ticks = null; }
    }
    const speechPid = await this.speechPid(processes);
    const roots = new Map<number, "backend" | "speech">([[this.backendPid, "backend"]]);
    if (speechPid !== null && speechPid !== this.backendPid) roots.set(speechPid, "speech");
    const owned = new Map<number, "backend" | "speech">();
    for (const entry of processes.values()) {
      let ancestor: Proc | undefined = entry;
      const visited = new Set<number>();
      while (ancestor && !visited.has(ancestor.pid)) {
        visited.add(ancestor.pid);
        const group = roots.get(ancestor.pid);
        if (group) {
          const started = this.rootStarts.get(ancestor.pid);
          if (started === undefined || started === ancestor.started) owned.set(entry.pid, group);
          break;
        }
        ancestor = processes.get(ancestor.parent);
      }
    }
    for (const pid of roots.keys()) {
      const entry = processes.get(pid);
      if (entry && !this.rootStarts.has(pid)) this.rootStarts.set(pid, entry.started);
    }
    const components: ResourceComponent[] = [];
    const next = new Map<string, { ticks: number; at: number }>();
    for (const [pid, group] of [...owned].sort((a, b) => a[0] - b[0])) {
      const entry = processes.get(pid)!;
      const id = `${pid}:${entry.started}`;
      const before = this.previous.get(id);
      const cpuPercent = before && this.ticks && at > before.at
        ? Math.max(0, (entry.ticks - before.ticks) / this.ticks / ((at - before.at) / 1000) * 100) : null;
      next.set(id, { ticks: entry.ticks, at });
      let ramBytes: Counter = null;
      try {
        const status = await readFile(join(this.procRoot, String(pid), "status"), "utf8");
        const rss = status.match(/^VmRSS:\s+(\d+)\s+kB/m);
        if (rss) ramBytes = Number(rss[1]) * 1024;
      } catch { /* Process exited during collection. */ }
      components.push({ id, name: roots.has(pid) ? (group === "backend" ? "Backend" : "Speech (STT/TTS)")
        : `${group === "backend" ? "Backend" : "Speech"} · ${entry.name}`, pid, cpuPercent, ramBytes, vramBytes: null,
        ...(!roots.has(pid) ? { includedIn: group } : {}) });
    }
    this.previous = next;
    for (const [id, name, pid] of [["backend", "Backend", this.backendPid], ["speech", "Speech (STT/TTS)", speechPid]] as const) {
      if (!components.some(c => c.name === name && c.pid === pid && pid !== null)) components.push({ id, name, pid: null, cpuPercent: null,
        ramBytes: id === "backend" && this.backendPid === process.pid ? process.memoryUsage().rss : null, vramBytes: null });
    }
    // Put primary components first, then named subprocesses.
    components.sort((a, b) => (a.name === "Backend" ? -2 : a.name === "Speech (STT/TTS)" ? -1 : 0)
      - (b.name === "Backend" ? -2 : b.name === "Speech (STT/TTS)" ? -1 : 0));
    if (components.some(c => c.pid === null)) notes.push("Some component process counters are unavailable; totals stay N/A until all components can be measured.");

    const gpus: ResourceSnapshot["gpus"] = [];
    try {
      const output = await this.run("nvidia-smi", ["--query-gpu=uuid,name,memory.used,memory.total,utilization.gpu", "--format=csv,noheader,nounits"]);
      for (const line of output.trim().split("\n")) {
        const [uuid, name, used, total, utilization] = line.split(",").map(v => v.trim());
        if (uuid && name) gpus.push({ uuid, name, utilizationPercent: numeric(utilization), vramUsedBytes: mib(used), vramTotalBytes: mib(total) });
      }
    } catch { notes.push("GPU counters unavailable (nvidia-smi missing, unsupported or inaccessible)."); }
    if (gpus.length && !this.wsl) {
      try {
        // The CSV compute-apps query omits graphics/Vulkan allocations. The
        // XML process table covers both graphics and compute process types.
        const output = await this.run("nvidia-smi", ["-q", "-x"]);
        const memory = new Map<number, Counter>();
        const covered = new Set<string>();
        for (const block of output.matchAll(/<gpu\s[^>]*>([\s\S]*?)<\/gpu>/g)) {
          const uuid = block[1].match(/<uuid>([^<]*)<\/uuid>/)?.[1].trim();
          if (!uuid || !gpus.some(g => g.uuid === uuid)) continue;
          const processTable = block[1].match(/<processes>([\s\S]*?)<\/processes>/);
          if (!processTable) throw new Error("Unsupported process counters");
          if (processTable[1].trim() && !processTable[1].includes("<process_info>")) throw new Error("Unsupported process counters");
          covered.add(uuid);
          for (const entry of processTable[1].matchAll(/<process_info>([\s\S]*?)<\/process_info>/g)) {
            const pid = numeric(entry[1].match(/<pid>([^<]*)<\/pid>/)?.[1]);
            if (pid === null) throw new Error("Unsupported process counters");
            const used = entry[1].match(/<used_memory>([^<]*)<\/used_memory>/)?.[1].trim();
            const value = used?.match(/^(\d+(?:\.\d+)?) MiB$/) ? mib(used.split(" ")[0]) : null;
            memory.set(pid, value === null || memory.get(pid) === null ? null : (memory.get(pid) ?? 0) + value);
          }
        }
        if (covered.size !== gpus.length) throw new Error("Incomplete GPU process counters");
        // Host GPU PIDs cannot be safely attributed inside container PID namespaces.
        let container = false;
        if (!this.options.procRoot) {
          container = await readFile("/proc/1/cgroup", "utf8").then(v => /docker|kubepods|containerd|libpod|lxc/.test(v)).catch(() => false);
          container ||= await readFile("/.dockerenv", "utf8").then(() => true).catch(() => false);
          container ||= await readFile("/run/.containerenv", "utf8").then(() => true).catch(() => false);
        }
        if (!container) {
          for (const c of components) if (c.pid !== null) c.vramBytes = memory.get(c.pid) ?? (memory.has(c.pid) ? null : 0);
        } else notes.push("Container GPU process attribution unavailable; device counters remain visible.");
      } catch { notes.push("Per-component VRAM counters unavailable; device counters remain visible."); }
    } else if (this.wsl && gpus.length) notes.push("WSL does not reliably expose per-process GPU memory; SAWOT VRAM is N/A. Device-wide GPU and VRAM counters remain visible.");
    const groups = new Map<string, { ticks: number; at: number; members: Set<string> }>();
    for (const [pid, group] of roots) {
      const root = components.find(c => c.pid === pid && !c.includedIn);
      if (!root) continue;
      const members = components.filter(c => c.pid === pid || c.includedIn === group);
      const ticks = members.reduce((total, c) => total + processes.get(c.pid!)!.ticks, 0);
      const identities = new Set(members.map(c => c.id));
      const before = this.previousGroups.get(root.id);
      root.cpuPercent = before && this.ticks && at > before.at && ticks >= before.ticks
        && members.every(c => before.members.has(c.id))
        ? (ticks - before.ticks) / this.ticks / ((at - before.at) / 1000) * 100 : null;
      root.ramBytes = sum(members.map(c => c.ramBytes));
      root.vramBytes = sum(members.map(c => c.vramBytes));
      groups.set(root.id, { ticks, at, members: identities });
    }
    this.previousGroups = groups;
    const primary = components.filter(c => !c.includedIn);
    const hardware = cpus();
    const snapshot: ResourceSnapshot = { sampledAt: Date.now(), intervalMs: 5000,
      cpu: { name: hardware[0]?.model || "CPU", cores: hardware.length }, components, gpus, notes,
      total: { cpuPercent: sum(primary.map(c => c.cpuPercent)), ramBytes: sum(primary.map(c => c.ramBytes)), vramBytes: sum(primary.map(c => c.vramBytes)) } };
    this.snapshot = snapshot;
    return snapshot;
  }
}

const bytes = (n: Counter) => n === null ? "N/A" : n >= 1024 ** 3 ? `${(n / 1024 ** 3).toFixed(2)} GiB` : `${Math.round(n / 1024 ** 2)} MiB`;
const percent = (n: Counter) => n === null ? "N/A" : `${n.toFixed(1)}%`;
export function formatResourceLine(s: ResourceSnapshot): string {
  const components = s.components.map(c => `${c.name}${c.includedIn ? " (included)" : ""}: RAM ${bytes(c.ramBytes)}, CPU ${percent(c.cpuPercent)}, VRAM ${bytes(c.vramBytes)}`);
  const gpus = s.gpus.map(g => `${g.name}: device GPU ${percent(g.utilizationPercent)}, device VRAM ${bytes(g.vramUsedBytes)}/${bytes(g.vramTotalBytes)}`);
  return `[resources] SAWOT: RAM ${bytes(s.total.ramBytes)}, CPU ${percent(s.total.cpuPercent)}, VRAM ${bytes(s.total.vramBytes)} | ${components.join(" | ")} | ${gpus.join(" | ") || "GPU N/A"}`;
}
