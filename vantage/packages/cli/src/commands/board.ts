/**
 * `vantage board [--date YYYY-MM-DD]` — print the Daily Board's five sections
 * as text blocks. Pure read against the Phase 9 board endpoint.
 */

interface Mover {
  ticker: string;
  name: string;
  scoreDelta: number;
  currentScore: number;
  currentLabel: string;
}
interface LabelChange {
  ticker: string;
  name: string;
  score: number;
  transitionedFromLabel: string;
}
interface ClassTransition {
  ticker: string;
  name: string;
  fromClass: string;
  toClass: string;
  confidence: number;
}
interface BoardResponse {
  asOf: string;
  sections: {
    biggestMoversUp: Mover[];
    biggestMoversDown: Mover[];
    newNarrativeBreakdowns: LabelChange[];
    freshMarketUnderreactions: LabelChange[];
    classificationTransitions: ClassTransition[];
  };
}

export interface BoardOpts {
  date?: string;
  url?: string;
}

const pad = (s: string, n: number): string => (s.length > n ? s.slice(0, n - 1) + '…' : s.padEnd(n));

function block(title: string, rows: string[]): string[] {
  const out = [``, `── ${title} ──`];
  if (rows.length === 0) out.push('  (nothing notable)');
  else out.push(...rows.map((r) => `  ${r}`));
  return out;
}

export async function board(opts: BoardOpts): Promise<void> {
  const base = opts.url ?? process.env.API_URL ?? 'http://localhost:4000';
  const resp = await fetch(`${base}/v1/board${opts.date ? `?date=${opts.date}` : ''}`);
  if (resp.status === 404) {
    process.stderr.write(`No board available for ${opts.date ?? 'today'} (no recent scoring activity).\n`);
    process.exit(1);
    return;
  }
  if (!resp.ok) {
    process.stderr.write(`Request failed: ${resp.status} ${await resp.text()}\n`);
    process.exit(1);
    return;
  }
  const data = (await resp.json()) as BoardResponse;
  const s = data.sections;
  const sign = (n: number) => (n >= 0 ? `+${n.toFixed(1)}` : n.toFixed(1));

  const lines: string[] = [`Daily Updates — ${data.asOf}`];
  lines.push(
    ...block(
      'Biggest Score Moves: Up',
      s.biggestMoversUp.map((r) => `${pad(r.ticker, 8)} ${pad(r.name, 28)} Δ ${sign(r.scoreDelta).padStart(6)}  score ${r.currentScore.toFixed(0)}  ${r.currentLabel}`),
    ),
  );
  lines.push(
    ...block(
      'Biggest Score Moves: Down',
      s.biggestMoversDown.map((r) => `${pad(r.ticker, 8)} ${pad(r.name, 28)} Δ ${sign(r.scoreDelta).padStart(6)}  score ${r.currentScore.toFixed(0)}  ${r.currentLabel}`),
    ),
  );
  lines.push(
    ...block(
      'New Narrative Breakdowns',
      s.newNarrativeBreakdowns.map((r) => `${pad(r.ticker, 8)} ${pad(r.name, 28)} score ${r.score.toFixed(0)}  was: ${r.transitionedFromLabel}`),
    ),
  );
  lines.push(
    ...block(
      'Fresh Market Underreactions',
      s.freshMarketUnderreactions.map((r) => `${pad(r.ticker, 8)} ${pad(r.name, 28)} score ${r.score.toFixed(0)}  was: ${r.transitionedFromLabel}`),
    ),
  );
  lines.push(
    ...block(
      'Classification Transitions',
      s.classificationTransitions.map((r) => `${pad(r.ticker, 8)} ${pad(r.name, 28)} ${r.fromClass} → ${r.toClass}  conf ${(r.confidence * 100).toFixed(0)}%`),
    ),
  );
  lines.push('');
  process.stdout.write(lines.join('\n') + '\n');
}
