/**
 * `vantage meta-capture` / `vantage meta-status` — Phase 8 meta-learning.
 *
 * meta-capture runs the outcome-capture sweep (grades matured decisions
 * against realized prices). meta-status prints the calibration report.
 */

interface CaptureResult {
  horizonDays: number;
  scanned: number;
  graded: number;
  skipped: number;
}
interface Summary {
  key: string;
  count: number;
  hitRate: number;
  avgReturn: number;
}
interface MetaResponse {
  horizonDays: number;
  totals: { graded: number; pending: number; overallHitRate: number };
  scoreReturnCorrelation: number | null;
  byLabel: Summary[];
  byClass: Summary[];
}

const base = (url?: string) => url ?? process.env.API_URL ?? 'http://localhost:4000';
const pct = (n: number) => `${(n * 100).toFixed(0)}%`;
const sret = (n: number) => `${n >= 0 ? '+' : '-'}${(Math.abs(n) * 100).toFixed(1)}%`;

export async function metaCapture(opts: { horizon?: string; url?: string }): Promise<void> {
  const body = opts.horizon ? { horizonDays: Number(opts.horizon) } : {};
  const resp = await fetch(`${base(opts.url)}/v1/meta/capture`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!resp.ok) {
    process.stderr.write(`Request failed: ${resp.status} ${await resp.text()}\n`);
    process.exit(1);
  }
  const r = (await resp.json()) as CaptureResult;
  process.stdout.write(
    `Outcome capture (horizon ${r.horizonDays}d): scanned ${r.scanned}, graded ${r.graded}, skipped ${r.skipped}\n`,
  );
}

export async function metaStatus(opts: { url?: string }): Promise<void> {
  const resp = await fetch(`${base(opts.url)}/v1/meta`);
  if (!resp.ok) {
    process.stderr.write(`Request failed: ${resp.status} ${await resp.text()}\n`);
    process.exit(1);
  }
  const d = (await resp.json()) as MetaResponse;
  const lines: string[] = [];
  lines.push(`── Meta-Learning Report (horizon ${d.horizonDays}d) ──`);
  lines.push(`Graded ${d.totals.graded} · Pending ${d.totals.pending} · Hit rate ${pct(d.totals.overallHitRate)}`);
  lines.push(
    `Score→return correlation: ${d.scoreReturnCorrelation === null ? 'n/a' : d.scoreReturnCorrelation.toFixed(2)}`,
  );
  const block = (title: string, rows: Summary[]) => {
    lines.push('', `${title}:`);
    if (rows.length === 0) lines.push('  (none)');
    for (const r of rows) {
      lines.push(`  ${r.key.padEnd(22)} n=${String(r.count).padStart(3)}  hit ${pct(r.hitRate).padStart(4)}  avg ${sret(r.avgReturn)}`);
    }
  };
  block('By label', d.byLabel);
  block('By class', d.byClass);
  lines.push('');
  process.stdout.write(lines.join('\n') + '\n');
}
