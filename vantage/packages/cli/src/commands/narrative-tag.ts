import { tagNarrativeForTicker } from '@vantage/api/lib';

/**
 * `vantage narrative-tag --ticker NVDA` — run news-assisted narrative tagging
 * for one ticker immediately, bypassing the daily cron queue. Useful for
 * exercising the LLM pipeline without waiting.
 */

export interface NarrativeTagOpts {
  ticker: string;
}

export async function narrativeTag(opts: NarrativeTagOpts): Promise<void> {
  process.stderr.write(`Tagging ${opts.ticker.toUpperCase()} — fetching news + segments…\n`);
  try {
    const result = await tagNarrativeForTicker(opts.ticker);
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    process.exit(0);
  } catch (err) {
    process.stderr.write(`narrative-tag failed: ${(err as Error).message}\n`);
    process.exit(1);
  }
}
