import { z } from 'zod';
import { UpstreamError } from '@vantage/shared';

/**
 * Company-intel fetcher — the ONLY LLM step in the private scoring path.
 *
 * Uses the Anthropic Messages API with the web_search tool to research a
 * private company and return STRUCTURED DATA ONLY (revenue / headcount /
 * funding). It never produces decisions or adjustments — just the figures the
 * deterministic engines consume. Output is Zod-validated; any drift fails loud.
 */

const ANTHROPIC_BASE = 'https://api.anthropic.com/v1/messages';
const DEFAULT_MODEL = 'claude-opus-4-7';
const TIMEOUT_MS = 90_000;
const MAX_TOKENS = 1500;

export const CompanyIntel = z.object({
  companyName: z.string(),
  revenueLtmUsd: z.number().nullable(),
  revenueAsOfMonth: z.string().nullable(),
  revenueSource: z.string().nullable(),
  revenueConfidence: z.enum(['high', 'medium', 'low', 'unknown']),
  headcount: z.number().nullable(),
  lastFundingDate: z.string().nullable(),
  lastFundingAmountUsd: z.number().nullable(),
  lastFundingValuationUsd: z.number().nullable(),
  growthCommentary: z.string().nullable(),
});
export type CompanyIntel = z.infer<typeof CompanyIntel>;

export interface CompanyIntelConfig {
  apiKey: string;
  model?: string;
  baseUrl?: string;
}

const SYSTEM_PROMPT = [
  'You are a financial research assistant. Research the named private company',
  'using web search and return STRUCTURED JSON ONLY — no prose, no code fences,',
  'no commentary outside the JSON object.',
  '',
  'Return exactly this schema:',
  '{',
  '  "companyName": string,',
  '  "revenueLtmUsd": number | null,',
  '  "revenueAsOfMonth": "YYYY-MM" | null,',
  '  "revenueSource": string | null,',
  '  "revenueConfidence": "high" | "medium" | "low" | "unknown",',
  '  "headcount": number | null,',
  '  "lastFundingDate": "YYYY-MM-DD" | null,',
  '  "lastFundingAmountUsd": number | null,',
  '  "lastFundingValuationUsd": number | null,',
  '  "growthCommentary": string | null',
  '}',
  '',
  'Rules:',
  '- Prefer FT, Bloomberg, WSJ, The Information, and official company sources.',
  '- For SaaS companies prefer the LATEST reported ARR; otherwise use annual revenue.',
  '- Convert all currency figures to USD.',
  '- Set revenueConfidence to "low" or "unknown" for disputed or stale figures.',
  '- Use null for any figure you cannot source with reasonable confidence.',
].join('\n');

const ContentBlock = z
  .object({ type: z.string(), text: z.string().optional() })
  .passthrough();

const MessagesResponse = z
  .object({ content: z.array(ContentBlock) })
  .passthrough();

/**
 * Scan text for balanced top-level { ... } objects. The model is told to
 * return JSON only, but with web search it sometimes wraps the object in
 * prose (or stray braces appear in commentary), so we extract every balanced
 * candidate and let the caller try each one.
 */
function findJsonObjects(text: string): string[] {
  const objects: string[] = [];
  let depth = 0;
  let start = -1;
  let inString = false;
  let escaped = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === '{') {
      if (depth === 0) start = i;
      depth += 1;
    } else if (ch === '}' && depth > 0) {
      depth -= 1;
      if (depth === 0 && start !== -1) {
        objects.push(text.slice(start, i + 1));
        start = -1;
      }
    }
  }
  return objects;
}

export async function fetchCompanyIntel(
  companyName: string,
  config: CompanyIntelConfig,
): Promise<CompanyIntel> {
  if (!config.apiKey) throw new UpstreamError('anthropic', 'missing API key');

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const resp = await fetch(config.baseUrl ?? ANTHROPIC_BASE, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': config.apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: config.model ?? DEFAULT_MODEL,
        max_tokens: MAX_TOKENS,
        system: SYSTEM_PROMPT,
        tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: 6 }],
        messages: [
          {
            role: 'user',
            content:
              `Research ${companyName}. Find their latest reported revenue (or ARR), ` +
              'current headcount, and most recent funding round (date, amount, valuation). ' +
              'Return the structured JSON only.',
          },
        ],
      }),
      signal: controller.signal,
    });

    if (!resp.ok) {
      const detail = await resp.text().catch(() => '');
      throw new UpstreamError('anthropic', `HTTP ${resp.status} ${detail}`.trim());
    }

    const parsed = MessagesResponse.parse(await resp.json());
    const textBlocks = parsed.content
      .filter(
        (b): b is { type: string; text: string } =>
          b.type === 'text' && typeof b.text === 'string',
      )
      .map((b) => b.text);
    if (textBlocks.length === 0) {
      throw new UpstreamError('anthropic', 'no text block in response');
    }
    // The model may interleave prose with the JSON across blocks. Pull every
    // balanced object out of the combined text and take the last one that
    // both parses and matches the CompanyIntel schema.
    const candidates = findJsonObjects(textBlocks.join('\n'));
    if (candidates.length === 0) {
      throw new UpstreamError('anthropic', 'no JSON object found in response');
    }
    for (const candidate of candidates.reverse()) {
      let json: unknown;
      try {
        json = JSON.parse(candidate);
      } catch {
        continue;
      }
      const result = CompanyIntel.safeParse(json);
      if (result.success) return result.data;
    }
    throw new UpstreamError(
      'anthropic',
      'no response JSON object matched the CompanyIntel schema',
    );
  } catch (err) {
    if (err instanceof UpstreamError) throw err;
    throw new UpstreamError('anthropic', err instanceof Error ? err.message : String(err));
  } finally {
    clearTimeout(timer);
  }
}
