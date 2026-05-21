/**
 * `vantage screener` — query the Phase 9 screener endpoint and print a
 * plain-text table. Pure read; useful for admin scripting and quick visual
 * sanity checks.
 *
 *   vantage screener --label aligned_strength --score-min 70 --sector technology
 */

interface ScreenerResult {
  ticker: string;
  name: string;
  sector: string;
  marketCap: number | null;
  score: number;
  label: string;
  confidence: number;
  assetClass: string | null;
  lastScoredAt: string;
}
interface ScreenerResponse {
  results: ScreenerResult[];
  nextCursor: string | null;
  totalEstimate: number;
}

export interface ScreenerOpts {
  label?: string[];
  sector?: string[];
  class?: string[];
  scoreMin?: string;
  scoreMax?: string;
  confidenceMin?: string;
  marketCapMin?: string;
  marketCapMax?: string;
  sortBy?: string;
  sortDir?: string;
  limit?: string;
  url?: string;
}

function fmtCap(usd: number | null): string {
  if (usd == null) return '—';
  return `$${(usd / 1e9).toFixed(1)}B`;
}

function pad(s: string, n: number): string {
  return s.length > n ? s.slice(0, n - 1) + '…' : s.padEnd(n);
}

export async function screener(opts: ScreenerOpts): Promise<void> {
  const base = opts.url ?? process.env.API_URL ?? 'http://localhost:4000';
  const p = new URLSearchParams();
  for (const v of opts.label ?? []) p.append('label', v);
  for (const v of opts.sector ?? []) p.append('sector', v);
  for (const v of opts.class ?? []) p.append('class', v);
  if (opts.scoreMin) p.set('scoreMin', opts.scoreMin);
  if (opts.scoreMax) p.set('scoreMax', opts.scoreMax);
  if (opts.confidenceMin) p.set('confidenceMin', opts.confidenceMin);
  if (opts.marketCapMin) p.set('marketCapMin', opts.marketCapMin);
  if (opts.marketCapMax) p.set('marketCapMax', opts.marketCapMax);
  if (opts.sortBy) p.set('sortBy', opts.sortBy);
  if (opts.sortDir) p.set('sortDir', opts.sortDir);
  p.set('limit', opts.limit ?? '50');

  const resp = await fetch(`${base}/v1/screener?${p.toString()}`);
  if (!resp.ok) {
    process.stderr.write(`Request failed: ${resp.status} ${await resp.text()}\n`);
    process.exit(1);
    return;
  }
  const data = (await resp.json()) as ScreenerResponse;

  const lines: string[] = [];
  lines.push(
    `${pad('TICKER', 8)} ${pad('COMPANY', 28)} ${pad('SECTOR', 22)} ` +
      `${'SCORE'.padStart(6)} ${pad('LABEL', 22)} ${pad('CLASS', 16)} ` +
      `${'CONF'.padStart(5)} ${'MKTCAP'.padStart(9)}`,
  );
  lines.push('─'.repeat(124));
  for (const r of data.results) {
    lines.push(
      `${pad(r.ticker, 8)} ${pad(r.name, 28)} ${pad(r.sector, 22)} ` +
        `${r.score.toFixed(0).padStart(6)} ${pad(r.label, 22)} ${pad(r.assetClass ?? '—', 16)} ` +
        `${(r.confidence * 100).toFixed(0).padStart(4)}% ${fmtCap(r.marketCap).padStart(9)}`,
    );
  }
  lines.push('─'.repeat(124));
  lines.push(
    `${data.results.length} shown · ${data.totalEstimate.toLocaleString()} match` +
      (data.nextCursor ? ' · more pages available (use the API cursor)' : ''),
  );
  process.stdout.write(lines.join('\n') + '\n');
}
