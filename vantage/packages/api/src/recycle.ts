/**
 * Restart this process when it gets heavy, and only when nobody would notice.
 *
 * The API also runs every queue worker in-process, so a six-week-old container
 * is carrying six weeks of job allocations: 1.26 GB resident against a ~0.2 GB
 * fresh boot. Railway bills memory by the minute, so the drift was costing
 * about $12/month for memory nothing is using.
 *
 * Two things make a self-restart safe here rather than reckless:
 *   - it waits for quiet — no HTTP request and no running job — so a restart
 *     cannot interrupt a request or a half-finished job, and BullMQ hands any
 *     scheduled work to the next process,
 *   - it measures the cgroup, which is what the invoice measures. An earlier
 *     version of this idea elsewhere read the Node heap, missed the page cache
 *     entirely, and never fired.
 *
 * Decisions are pure functions so the thresholds can be tested without
 * allocating a gigabyte or waiting a week.
 */
import { readFileSync } from 'node:fs';

export const RECYCLE_MB = Number(process.env.API_RECYCLE_MB ?? 700);
export const RECYCLE_MIN_UPTIME_MS = Number(process.env.API_RECYCLE_MIN_UPTIME_MS ?? 15 * 60 * 1000);
/** How long the process must be untouched by HTTP before a restart is invisible. */
export const RECYCLE_QUIET_MS = Number(process.env.API_RECYCLE_QUIET_MS ?? 5 * 60 * 1000);
export const RECYCLE_CHECK_MS = Number(process.env.API_RECYCLE_CHECK_MS ?? 5 * 60 * 1000);

/** The number Railway bills: cgroup v2, then v1, then this process off-container. */
export function containerMemoryBytes(read: (p: string) => number | null = readBytes): number {
  for (const path of ['/sys/fs/cgroup/memory.current', '/sys/fs/cgroup/memory/memory.usage_in_bytes']) {
    const value = read(path);
    if (value != null && Number.isFinite(value) && value > 0) return value;
  }
  return process.memoryUsage().rss;
}

function readBytes(path: string): number | null {
  try {
    const n = Number(readFileSync(path, 'utf8').trim());
    return Number.isFinite(n) && n > 0 ? n : null;
  } catch {
    return null;
  }
}

export interface RecycleState {
  memoryBytes: number;
  uptimeMs: number;
  msSinceLastRequest: number;
  activeJobs: number;
  thresholdMb?: number;
  minUptimeMs?: number;
  quietMs?: number;
}

export function shouldRecycle({
  memoryBytes,
  uptimeMs,
  msSinceLastRequest,
  activeJobs,
  thresholdMb = RECYCLE_MB,
  minUptimeMs = RECYCLE_MIN_UPTIME_MS,
  quietMs = RECYCLE_QUIET_MS,
}: RecycleState): boolean {
  if (thresholdMb <= 0) return false; // API_RECYCLE_MB=0 turns it off
  if (uptimeMs < minUptimeMs) return false; // never loop on a bad threshold
  if (activeJobs > 0) return false; // finish the work first
  if (msSinceLastRequest < quietMs) return false; // somebody is using it
  return memoryBytes / (1024 * 1024) > thresholdMb;
}
