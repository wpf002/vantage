import { FmpClient } from '@vantage/data-ingest/public';

/**
 * Phase 10 — recent news fetch for narrative tagging. Pulls the trailing
 * `days` window of headlines + summaries from FMP's stock-news endpoint.
 */

export interface NewsArticle {
  title: string;
  text: string;
  publishedAt: string;
  source: string;
  url: string;
}

export async function fetchRecentNews(
  ticker: string,
  days = 14,
  fmpApiKey?: string,
): Promise<NewsArticle[]> {
  const key = fmpApiKey ?? process.env.FMP_API_KEY;
  if (!key) throw new Error('FMP_API_KEY required to fetch news');
  const client = new FmpClient({ apiKey: key });
  const news = await client.stockNews(ticker, 50);
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
  return news
    .filter((n) => n.title && n.title.trim().length > 0)
    .filter((n) => {
      const t = Date.parse(n.publishedAt);
      return !Number.isFinite(t) || t >= cutoff;
    })
    .map((n) => ({
      title: n.title,
      text: n.text,
      publishedAt: n.publishedAt,
      source: n.source,
      url: n.url,
    }));
}
