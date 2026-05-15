/**
 * `vantage classify-status` — read the current classification for an entity.
 *
 * This is a state-inspection command. Fresh runs are handled automatically by
 * the Phase 4 worker queue whenever a new Signal is persisted, so the CLI
 * just hits GET /v1/classifications/:entity and prints what's there.
 */

interface ContributingSignal {
  signalType: string;
  direction: 'bullish' | 'neutral' | 'bearish';
  magnitude: number;
  confidence: number;
  rationale: string;
  timestamp: string;
}

interface ClassificationResponse {
  entity: string;
  name: string;
  ticker: string | null;
  marketType: 'public' | 'private' | null;
  sector: string | null;
  assetClass: 'CORE' | 'HIGH_ASYMMETRY' | 'TACTICAL' | 'AVOID';
  confidence: number;
  rationale: string;
  contributingSignals: ContributingSignal[];
  asOf: string;
}

export async function classifyStatus(opts: { entity: string; url?: string }): Promise<void> {
  const base = opts.url ?? process.env.API_URL ?? 'http://localhost:4000';
  const url = `${base}/v1/classifications/${encodeURIComponent(opts.entity)}`;

  const resp = await fetch(url);
  if (resp.status === 404) {
    process.stderr.write(
      `\nNo classification yet for ${opts.entity}.\n` +
        `Score the company first (POST /v1/public/score-live or value-live) — the worker\n` +
        `will classify it within a few seconds, then re-run this command.\n\n`,
    );
    process.exit(1);
    return;
  }
  if (!resp.ok) {
    process.stderr.write(`Request failed: ${resp.status} ${await resp.text()}\n`);
    process.exit(1);
    return;
  }

  const data = (await resp.json()) as ClassificationResponse;

  const top3 = [...data.contributingSignals]
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, 3);

  const lines: string[] = [];
  lines.push(`── ${data.name}${data.ticker ? ` (${data.ticker})` : ''} ──`);
  lines.push(`Entity          : ${data.entity}`);
  if (data.sector) lines.push(`Sector          : ${data.sector}`);
  lines.push('');
  lines.push(`Asset class     : ${data.assetClass}`);
  lines.push(`Confidence      : ${(data.confidence * 100).toFixed(0)}%`);
  lines.push(`Rationale       : ${data.rationale}`);
  lines.push(`As of           : ${data.asOf}`);
  lines.push('');
  lines.push(`Top contributing signals:`);
  if (top3.length === 0) {
    lines.push('  (none)');
  } else {
    for (const s of top3) {
      lines.push(
        `  · ${s.signalType.padEnd(28)} ${s.direction.padEnd(8)} ` +
          `mag ${s.magnitude.toFixed(2)}  conf ${s.confidence.toFixed(2)}`,
      );
    }
  }
  lines.push('');

  process.stderr.write(lines.join('\n'));
  process.stdout.write(JSON.stringify(data, null, 2) + '\n');
}
