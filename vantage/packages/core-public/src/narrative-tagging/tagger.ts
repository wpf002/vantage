import { z } from 'zod';
import type { NewsArticle } from './news-fetcher.js';

/**
 * Phase 10 — LLM-backed narrative tagger. Given a ticker's known revenue
 * segments and recent news, asks Claude which segment(s) the dominant market
 * narrative is centered on. Strictly *tagging*, never scoring — the NIS math
 * stays deterministic; the LLM only identifies which segment matters.
 *
 * Tolerant of failure: returns null so the caller can fall back to the
 * rule-based heuristic.
 */

const ANTHROPIC_BASE = 'https://api.anthropic.com/v1/messages';
export const NARRATIVE_TAGGER_MODEL = 'claude-opus-4-7';
const MAX_TOKENS = 1024;

const SYSTEM_PROMPT = [
  'You are a financial analyst classifying which of a company\'s reported revenue',
  'segments the current market narrative is centered on. You are given the',
  'company\'s actual revenue segments and recent news headlines.',
  '',
  'Pick the segment(s) the dominant narrative driving market attention is about.',
  'A segment may be the narrative even if it is not the largest by revenue — and',
  'the narrative may be a theme (e.g. membership, AI, advertising) that maps onto',
  'a specific reported segment. Only choose from the provided segment names.',
  '',
  'Return JSON only, no prose: { "tags": [{ "segment": string, "confidence": number, "reasoning": string }] }',
  'confidence is 0-1. Omit segments that are not part of the narrative.',
].join('\n');

const MessagesResponse = z.object({
  content: z.array(z.object({ type: z.string(), text: z.string().optional() })),
});

export const NarrativeTag = z.object({
  segment: z.string(),
  confidence: z.number().min(0).max(1),
  reasoning: z.string().optional(),
});
export type NarrativeTag = z.infer<typeof NarrativeTag>;

const TaggerResult = z.object({ tags: z.array(NarrativeTag) });

export interface NarrativeTaggerResult {
  tags: NarrativeTag[];
  rationale: string;
  modelVersion: string;
}

/** Extract candidate JSON objects from mixed text, last-first. */
function findJsonObjects(text: string): string[] {
  const out: string[] = [];
  const stack: number[] = [];
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '{') stack.push(i);
    else if (text[i] === '}' && stack.length > 0) {
      const start = stack.pop()!;
      if (stack.length === 0) out.push(text.slice(start, i + 1));
    }
  }
  return out;
}

export async function tagNarrativeSegments(
  ticker: string,
  news: NewsArticle[],
  knownSegments: string[],
  anthropicApiKey?: string,
  opts: { baseUrl?: string; model?: string; timeoutMs?: number } = {},
): Promise<NarrativeTaggerResult | null> {
  const key = anthropicApiKey ?? process.env.ANTHROPIC_API_KEY;
  if (!key) return null;
  if (knownSegments.length === 0 || news.length === 0) return null;

  const bullets = news
    .slice(0, 40)
    .map((n) => `- ${n.title}`)
    .join('\n');
  const userMsg =
    `${ticker}'s segments: ${knownSegments.join(', ')}.\n\n` +
    `Recent news:\n${bullets}\n\n` +
    'Which segments are the dominant narrative driving market attention? ' +
    'Return JSON: { "tags": [{ "segment": string, "confidence": number 0-1, "reasoning": string }] }.';

  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), opts.timeoutMs ?? 30_000);
  try {
    const resp = await fetch(opts.baseUrl ?? ANTHROPIC_BASE, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': key,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: opts.model ?? NARRATIVE_TAGGER_MODEL,
        max_tokens: MAX_TOKENS,
        system: SYSTEM_PROMPT,
        messages: [{ role: 'user', content: userMsg }],
      }),
      signal: ctl.signal,
    });
    if (!resp.ok) return null;
    const parsed = MessagesResponse.safeParse(await resp.json());
    if (!parsed.success) return null;

    const text = parsed.data.content
      .filter((b) => b.type === 'text' && typeof b.text === 'string')
      .map((b) => b.text as string)
      .join('\n');

    for (const candidate of findJsonObjects(text).reverse()) {
      let json: unknown;
      try {
        json = JSON.parse(candidate);
      } catch {
        continue;
      }
      const result = TaggerResult.safeParse(json);
      if (result.success) {
        // Keep only tags whose segment matches a known one (case-insensitive,
        // substring-tolerant) so the LLM can't invent segments.
        const known = knownSegments.map((s) => s.toLowerCase());
        const tags = result.data.tags.filter((tag) =>
          known.some(
            (k) =>
              k === tag.segment.toLowerCase() ||
              k.includes(tag.segment.toLowerCase()) ||
              tag.segment.toLowerCase().includes(k),
          ),
        );
        if (tags.length === 0) return null;
        return {
          tags,
          rationale: tags.map((t2) => t2.reasoning).filter(Boolean).join(' '),
          modelVersion: opts.model ?? NARRATIVE_TAGGER_MODEL,
        };
      }
    }
    return null;
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}
