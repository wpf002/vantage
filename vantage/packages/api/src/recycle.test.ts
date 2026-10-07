/**
 * The API restarts itself when it gets heavy. It also serves HTTP and runs ten
 * queue workers in-process, so "heavy" is not enough on its own — a restart in
 * the wrong second drops a request or abandons a job. These pin the guards.
 */
import { describe, expect, it } from 'vitest';
import { containerMemoryBytes, shouldRecycle } from './recycle.js';

const MB = 1024 * 1024;
const MIN = 60 * 1000;
const idle = {
  uptimeMs: 60 * MIN,
  msSinceLastRequest: 30 * MIN,
  activeJobs: 0,
  thresholdMb: 700,
  minUptimeMs: 15 * MIN,
  quietMs: 5 * MIN,
};

describe('shouldRecycle', () => {
  it('restarts a heavy, idle process', () => {
    expect(shouldRecycle({ ...idle, memoryBytes: 1260 * MB })).toBe(true);
  });

  it('leaves a fresh process alone', () => {
    expect(shouldRecycle({ ...idle, memoryBytes: 200 * MB })).toBe(false);
  });

  it('waits for a running job, however heavy', () => {
    expect(shouldRecycle({ ...idle, memoryBytes: 2000 * MB, activeJobs: 1 })).toBe(false);
  });

  it('waits for HTTP to go quiet', () => {
    expect(shouldRecycle({ ...idle, memoryBytes: 2000 * MB, msSinceLastRequest: 30 * 1000 })).toBe(false);
  });

  it('will not restart in the first minutes, so a wrong threshold cannot loop', () => {
    expect(shouldRecycle({ ...idle, memoryBytes: 4000 * MB, uptimeMs: 60 * 1000 })).toBe(false);
  });

  it('can be switched off', () => {
    expect(shouldRecycle({ ...idle, memoryBytes: 4000 * MB, thresholdMb: 0 })).toBe(false);
  });
});

describe('containerMemoryBytes', () => {
  it('prefers the cgroup, which is what Railway bills', () => {
    expect(containerMemoryBytes((p) => (p === '/sys/fs/cgroup/memory.current' ? 1_300_000_000 : null))).toBe(
      1_300_000_000,
    );
  });

  it('falls back to cgroup v1, then to this process', () => {
    expect(
      containerMemoryBytes((p) => (p === '/sys/fs/cgroup/memory/memory.usage_in_bytes' ? 900_000_000 : null)),
    ).toBe(900_000_000);
    expect(Math.abs(containerMemoryBytes(() => null) - process.memoryUsage().rss)).toBeLessThan(25 * MB);
  });

  it('treats a zero or nonsense reading as no reading', () => {
    // Accepting a zero here is how a recycle check quietly never fires.
    expect(Math.abs(containerMemoryBytes(() => 0) - process.memoryUsage().rss)).toBeLessThan(25 * MB);
    expect(Math.abs(containerMemoryBytes(() => Number.NaN) - process.memoryUsage().rss)).toBeLessThan(25 * MB);
  });
});
