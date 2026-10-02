import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ResourceMonitor, formatResourceLine } from "../src/resources.js";

// Real proc-file fixtures catch wrong stat offsets, omitted subprocesses,
// double-counting, PID reuse and accidental inclusion of unrelated programs.
async function processFile(root: string, pid: number, parent: number, name: string, ticks: number, rssKiB: number, started = 100, waitedTicks = 0) {
  await mkdir(join(root, String(pid)), { recursive: true });
  const fields = Array(50).fill("0");
  fields[0] = "S"; fields[1] = String(parent);
  fields[11] = String(ticks); fields[12] = "0"; fields[13] = String(waitedTicks); fields[19] = String(started);
  await writeFile(join(root, String(pid), "stat"), `${pid} (${name}) ${fields.join(" ")}`);
  await writeFile(join(root, String(pid), "status"), `Name:\t${name}\nVmRSS:\t${rssKiB} kB\n`);
}

test("resource samples name components, measure CPU deltas and include only owned process trees", async () => {
  const dir = await mkdtemp(join(tmpdir(), "sawot-proc-"));
  let now = 1000;
  const monitor = new ResourceMonitor({ backendPid: 10, sidecarPid: 20, procRoot: dir, clockTicks: 100,
    now: () => now, wsl: false, command: async (_file, args) => args[0].startsWith("--query-gpu")
      ? "GPU-abc, Test GPU, 2048, 8192, 25\n" : '<nvidia_smi_log><gpu id="0"><uuid>GPU-abc</uuid><processes><process_info><pid>20</pid><type>G</type><used_memory>512 MiB</used_memory></process_info><process_info><pid>99</pid><type>C</type><used_memory>1536 MiB</used_memory></process_info></processes></gpu></nvidia_smi_log>' });
  try {
    await processFile(dir, 10, 1, "node", 100, 1024);
    await processFile(dir, 20, 1, "python", 200, 2048);
    await processFile(dir, 30, 20, "transcribe (cpp)", 300, 512);
    await processFile(dir, 99, 1, "unrelated", 9000, 9999);
    const initial = await monitor.sample();
    assert.equal(initial.total.cpuPercent, null, "first sample is warming up, not idle");
    assert.equal(initial.total.ramBytes, 3670016);
    assert.deepEqual(initial.components.map(c => c.name), ["Backend", "Speech (STT/TTS)", "Speech · transcribe (cpp)"]);
    assert.equal(initial.total.vramBytes, 536870912);
    assert.equal(initial.gpus[0].vramUsedBytes, 2147483648, "device memory is separate from SAWOT memory");
    now = 6000;
    await processFile(dir, 10, 1, "node", 200, 1024);
    await processFile(dir, 20, 1, "python", 450, 2048);
    await processFile(dir, 30, 20, "transcribe (cpp)", 900, 512);
    const next = await monitor.sample();
    assert.deepEqual(next.components.map(c => c.cpuPercent), [20, 170, 120]);
    assert.equal(next.total.cpuPercent, 190, "100% means one CPU core");
    assert.match(formatResourceLine(next), /Backend.*CPU 20\.0%.*Speech \(STT\/TTS\).*CPU 170\.0%/);
    assert.match(formatResourceLine(next), /Test GPU.*device GPU 25\.0%/);
    assert.doesNotMatch(formatResourceLine(next), /unrelated/);
    now = 11000;
    await processFile(dir, 30, 20, "new child", 99999, 512, 500);
    const reused = await monitor.sample();
    assert.equal(reused.components[2].cpuPercent, null, "a reused PID must establish its own CPU baseline");
    assert.equal(reused.total.cpuPercent, null, "a new process with pre-existing CPU must establish a baseline");
  } finally { monitor.stop(); await rm(dir, { recursive: true, force: true }); }
});

test("speech CPU includes children that finish between samples without counting previously sampled children twice", async () => {
  const dir = await mkdtemp(join(tmpdir(), "sawot-proc-"));
  let now = 1000;
  const monitor = new ResourceMonitor({ backendPid: 10, sidecarPid: 20, procRoot: dir, clockTicks: 100,
    now: () => now, wsl: true, command: async () => { throw new Error("no GPU"); } });
  try {
    await processFile(dir, 10, 1, "node", 0, 1024);
    await processFile(dir, 20, 1, "python", 100, 2048);
    await processFile(dir, 30, 20, "ffmpeg", 100, 512);
    await monitor.sample();
    now = 6000;
    await rm(join(dir, "30"), { recursive: true });
    // Child consumed another 100 ticks, then the parent reaped all 200.
    await processFile(dir, 20, 1, "python", 100, 2048, 100, 200);
    const reaped = await monitor.sample();
    assert.equal(reaped.components[1].cpuPercent, 20);
    assert.equal(reaped.total.cpuPercent, 20);
    now = 11000;
    // A new ffmpeg started and finished entirely inside this interval.
    await processFile(dir, 20, 1, "python", 100, 2048, 100, 300);
    const transient = await monitor.sample();
    assert.equal(transient.components[1].cpuPercent, 20);
    assert.equal(transient.total.cpuPercent, 20);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("WSL's empty process GPU query is unavailable, while device counters and CPU remain usable", async () => {
  const dir = await mkdtemp(join(tmpdir(), "sawot-proc-"));
  const monitor = new ResourceMonitor({ backendPid: 10, sidecarPid: 20, procRoot: dir, clockTicks: 100, wsl: true,
    command: async (_file, args) => args[0].startsWith("--query-gpu") ? "GPU-abc, RTX Test, N/A, 8192, N/A\n" : "" });
  try {
    await processFile(dir, 10, 1, "node", 100, 1024);
    const snapshot = await monitor.sample();
    assert.equal(snapshot.total.ramBytes, null, "missing speech RAM must not show a complete app total");
    assert.equal(snapshot.components[0].ramBytes, 1048576);
    assert.equal(snapshot.components[1].ramBytes, null);
    assert.equal(snapshot.total.vramBytes, null);
    assert.equal(snapshot.gpus[0].utilizationPercent, null);
    assert.equal(snapshot.gpus[0].vramUsedBytes, null);
    assert.match(formatResourceLine(snapshot), /N\/A/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("absent GPU tools do not hide RAM or invent zero GPU activity", async () => {
  const dir = await mkdtemp(join(tmpdir(), "sawot-proc-"));
  const monitor = new ResourceMonitor({ backendPid: 10, sidecarPid: 20, procRoot: dir, clockTicks: 100,
    command: async () => { throw new Error("not installed"); } });
  try {
    await processFile(dir, 10, 1, "node", 0, 1024);
    await processFile(dir, 20, 1, "python", 0, 2048);
    const snapshot = await monitor.sample();
    assert.equal(snapshot.total.ramBytes, 3145728);
    assert.deepEqual(snapshot.gpus, []);
    assert.equal(snapshot.total.vramBytes, null);
    assert.match(formatResourceLine(snapshot), /GPU N\/A/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

for (const table of ["<processes>N/A</processes>", "", "<processes><process_info><pid>20</pid><used_memory>N/A</used_memory></process_info></processes>"]) {
  test(`unsupported native GPU process counters stay unknown: ${table || "missing table"}`, async () => {
    const dir = await mkdtemp(join(tmpdir(), "sawot-proc-"));
    const monitor = new ResourceMonitor({ backendPid: 10, sidecarPid: 20, procRoot: dir, clockTicks: 100, wsl: false,
      command: async (_file, args) => args[0].startsWith("--query-gpu") ? "GPU-abc, GPU, 2048, 8192, 25\n"
        : `<nvidia_smi_log><gpu id="0"><uuid>GPU-abc</uuid>${table}</gpu></nvidia_smi_log>` });
    try {
      await processFile(dir, 10, 1, "node", 100, 1024);
      await processFile(dir, 20, 1, "python", 200, 2048);
      const snapshot = await monitor.sample();
      assert.equal(snapshot.total.vramBytes, null);
      assert.equal(snapshot.components[1].vramBytes, null);
      assert.equal(snapshot.gpus[0].vramUsedBytes, 2147483648);
    } finally { await rm(dir, { recursive: true, force: true }); }
  });
}
