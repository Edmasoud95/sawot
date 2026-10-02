export interface ResourceComponent {
  id: string;
  name: string;
  pid: number | null;
  cpuPercent: number | null;
  ramBytes: number | null;
  vramBytes: number | null;
  includedIn?: "backend" | "speech";
}
export interface ResourceSnapshot {
  sampledAt: number;
  intervalMs: number;
  cpu: { name: string; cores: number };
  total: { cpuPercent: number | null; ramBytes: number | null; vramBytes: number | null };
  components: ResourceComponent[];
  gpus: { uuid: string; name: string; utilizationPercent: number | null; vramUsedBytes: number | null; vramTotalBytes: number | null }[];
  notes: string[];
}

export const resourceBytes = (n: number | null | undefined): string => n == null ? "N/A"
  : n >= 1024 ** 3 ? `${(n / 1024 ** 3).toFixed(2)} GiB` : `${Math.round(n / 1024 ** 2)} MiB`;
export const resourcePercent = (n: number | null | undefined): string => n == null ? "N/A" : `${n.toFixed(1)}%`;
