import { runLivePublicScore } from '@vantage/core-public/orchestrator';
import type { LivePublicScoreConfig } from '@vantage/core-public/orchestrator';

/**
 * `vantage score-public-live` — run the live public-scoring orchestrator for
 * any US-listed ticker. Human-readable summary to stderr, full JSON to stdout.
 */

interface EgsLike {
  score: number;
  direction: string;
}
interface ScoreLike {
  score: number;
}

function fmtPct(value: unknown): string {
  return typeof value === 'number' ? `${(value * 100).toFixed(1)}%` : 'n/a';
}

export async function scorePublicLive(opts: { ticker: string }): Promise<void> {
  const key = process.env.FMP_API_KEY;
  if (!key) {
    process.stderr.write('Missing required env var: FMP_API_KEY\n');
    process.exit(1);
    return;
  }

  const ticker = opts.ticker.toUpperCase();
  const config: LivePublicScoreConfig = {
    ticker,
    fmpApiKey: key,
    ...(process.env.ML_SERVICE_URL ? { mlServiceUrl: process.env.ML_SERVICE_URL } : {}),
  };

  process.stderr.write(`\nPulling fresh FMP data for ${ticker} — about 10 seconds...\n\n`);

  const result = await runLivePublicScore(config);
  const { result: score, signal, inputs } = result;

  const meta = (signal.metadata ?? {}) as Record<string, unknown>;
  const prov = (meta.provenance ?? {}) as Record<string, unknown>;
  const egs = score.components.egs as EgsLike;
  const nis = score.components.nis as ScoreLike;
  const nhs = score.components.nhs as ScoreLike;
  const segments = (prov.segments ?? []) as Array<{
    name: string;
    revenueSharePct: number;
    isNarrativeSegment: boolean;
  }>;

  const lines: string[] = [];
  lines.push(`── ${inputs.profile.companyName} (${ticker}) ──`);
  lines.push(
    `Sector        : ${inputs.profile.sector ?? 'n/a'} · ${inputs.profile.industry ?? 'n/a'}`,
  );
  lines.push('');
  lines.push(`Public Score  : ${score.score.toFixed(1)} / 100`);
  lines.push(`Label         : ${(meta.labelDisplay as string) ?? score.label}`);
  lines.push(`Direction     : ${score.direction}`);
  lines.push(`Confidence    : ${(score.confidence * 100).toFixed(0)}%`);
  lines.push('');
  lines.push(`Expectation Gap    : ${egs.score.toFixed(1)} (${egs.direction})`);
  lines.push(`Narrative Integrity: ${nis.score.toFixed(1)}`);
  lines.push(`Narrative Heat     : ${nhs.score.toFixed(1)}`);
  lines.push('');
  lines.push(
    `Earnings landed    : ${(prov.earningsDate as string) ?? 'n/a'}` +
      ` · EPS surprise ${fmtPct(prov.epsSurprisePct)}` +
      ` · 1d ${fmtPct(prov.oneDayReturn)} · 3d ${fmtPct(prov.threeDayReturn)}`,
  );
  lines.push(
    `Segments parsed    : ` +
      (segments.length > 0
        ? segments
            .map(
              (s) =>
                `${s.name} ${s.revenueSharePct.toFixed(0)}%${s.isNarrativeSegment ? '*' : ''}`,
            )
            .join(', ')
        : 'none'),
  );
  lines.push('');

  process.stderr.write(lines.join('\n'));
  process.stdout.write(JSON.stringify(result, null, 2) + '\n');
}
