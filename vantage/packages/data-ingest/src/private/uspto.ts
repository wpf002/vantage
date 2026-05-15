import { z } from 'zod';
import { UpstreamError } from '@vantage/shared';

/**
 * USPTO patent-activity fetcher via PatentsView's free query API.
 *
 * Counts patents with a `patent_date` in the trailing 12 months for a given
 * assignee organization. We only need the aggregate count, so we request a
 * single row and read `total_patent_count` off the envelope.
 */

const PATENTSVIEW_BASE = 'https://api.patentsview.org/patents/query';
const TIMEOUT_MS = 15_000;

const QueryResponse = z
  .object({
    total_patent_count: z.number().nullable().optional(),
    count: z.number().nullable().optional(),
  })
  .passthrough();

export interface PatentActivity {
  assignee: string;
  patentsFiledTrailing12m: number;
  asOf: string;
}

function oneYearAgoIso(): string {
  const d = new Date();
  d.setFullYear(d.getFullYear() - 1);
  return d.toISOString().slice(0, 10);
}

export async function fetchPatentActivity(assignee: string): Promise<PatentActivity> {
  const query = {
    _and: [
      { assignee_organization: assignee },
      { _gte: { patent_date: oneYearAgoIso() } },
    ],
  };
  const fields = JSON.stringify(['patent_number']);
  const options = JSON.stringify({ per_page: 1 });
  const url =
    `${PATENTSVIEW_BASE}?q=${encodeURIComponent(JSON.stringify(query))}` +
    `&f=${encodeURIComponent(fields)}&o=${encodeURIComponent(options)}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const resp = await fetch(url, {
      headers: { 'user-agent': 'vantage-data-ingest' },
      signal: controller.signal,
    });
    if (!resp.ok) throw new UpstreamError('uspto', `HTTP ${resp.status}`);
    const parsed = QueryResponse.parse(await resp.json());
    return {
      assignee,
      patentsFiledTrailing12m: parsed.total_patent_count ?? parsed.count ?? 0,
      asOf: new Date().toISOString(),
    };
  } catch (err) {
    if (err instanceof UpstreamError) throw err;
    throw new UpstreamError('uspto', err instanceof Error ? err.message : String(err));
  } finally {
    clearTimeout(timer);
  }
}
