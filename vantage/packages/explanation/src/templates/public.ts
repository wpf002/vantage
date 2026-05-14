import type { Signal } from '@vantage/shared';
import { fill } from '../index.js';

export const PUBLIC_TEMPLATES: Record<string, (s: Signal) => string> = {
  'public.score': (s) => {
    const label = s.metadata?.label as string | undefined;
    return fill(
      `{ticker} — {label}. Public Score {score} of 100 (confidence {confidence}). Three layers: Expectation Gap, Narrative Integrity, Narrative Heat.`,
      {
        ticker: s.entity,
        label: label ?? 'unlabeled',
        score: (s.magnitude * 100).toFixed(1),
        confidence: s.confidence.toFixed(2),
      },
    );
  },
  'public.expectation_gap': (s) =>
    fill(`{ticker} — Expectation Gap {score} ({direction}).`, {
      ticker: s.entity,
      score: (s.magnitude * 100).toFixed(1),
      direction: s.direction,
    }),
  'public.narrative_integrity': (s) =>
    fill(`{ticker} — Narrative Integrity {score} of 100.`, {
      ticker: s.entity,
      score: (s.magnitude * 100).toFixed(1),
    }),
  'public.narrative_heat': (s) =>
    fill(`{ticker} — Narrative Heat {score} of 100.`, {
      ticker: s.entity,
      score: (s.magnitude * 100).toFixed(1),
    }),
};
