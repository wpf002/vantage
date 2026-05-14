import type { Signal } from '@vantage/shared';
import { fill } from '../index.js';

export const PRIVATE_TEMPLATES: Record<string, (s: Signal) => string> = {
  'private.blended_valuation': (s) => {
    const weights = s.metadata?.weights as { dcf: number; comps: number; lbo: number } | undefined;
    const dcf = weights ? `${(weights.dcf * 100).toFixed(0)}% DCF` : '';
    const comps = weights ? `${(weights.comps * 100).toFixed(0)}% Comps` : '';
    const lbo = weights ? `${(weights.lbo * 100).toFixed(0)}% LBO` : '';
    const breakdown = [dcf, comps, lbo].filter(Boolean).join(' · ');
    return fill(
      `Blended valuation for {entity}. Method mix: {breakdown}. Confidence {confidence}. Audit chain has {steps} steps.`,
      {
        entity: s.entity,
        breakdown,
        confidence: s.confidence.toFixed(2),
        steps: s.transformChain.length,
      },
    );
  },
  'private.dcf': (s) =>
    fill(`DCF for {entity} — confidence {confidence}.`, {
      entity: s.entity,
      confidence: s.confidence.toFixed(2),
    }),
  'private.comps': (s) =>
    fill(`Comps for {entity} — confidence {confidence}.`, {
      entity: s.entity,
      confidence: s.confidence.toFixed(2),
    }),
  'private.lbo': (s) =>
    fill(`LBO reverse-solve for {entity} — confidence {confidence}.`, {
      entity: s.entity,
      confidence: s.confidence.toFixed(2),
    }),
  'private.ml_adjustment': (s) => {
    const delta = s.metadata?.delta as number | undefined;
    return fill(
      `XGBoost adjustment for {entity}: {direction} {pct}% on alt-data signals.`,
      {
        entity: s.entity,
        direction: delta !== undefined && delta > 0 ? '+' : '',
        pct: delta !== undefined ? (delta * 100).toFixed(1) : 'n/a',
      },
    );
  },
};
