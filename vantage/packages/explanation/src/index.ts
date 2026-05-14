import type { Signal } from '@vantage/shared';
import { PRIVATE_TEMPLATES } from './templates/private.js';
import { PUBLIC_TEMPLATES } from './templates/public.js';
import { PLATFORM_TEMPLATES } from './templates/platform.js';

/**
 * Deterministic explanation engine.
 *
 * No LLM. Pure template substitution from signal metadata.
 * Every output is reproducible byte-for-byte given the same inputs.
 *
 * Templates use {key} placeholders. Missing keys render literally
 * so they're easy to spot in QA.
 */

type Template = (s: Signal) => string;

const ALL_TEMPLATES: Record<string, Template> = {
  ...PRIVATE_TEMPLATES,
  ...PUBLIC_TEMPLATES,
  ...PLATFORM_TEMPLATES,
};

export function explain(signal: Signal): string {
  const template = ALL_TEMPLATES[signal.signalType];
  if (!template) {
    return signal.rationale; // fall back to whatever the engine wrote
  }
  return template(signal);
}

export function explainBatch(signals: Signal[]): Array<{ entity: string; explanation: string }> {
  return signals.map((s) => ({ entity: s.entity, explanation: explain(s) }));
}

/**
 * Substitute {key} placeholders from a flat record.
 * Missing keys remain as-is — visible bugs over silent failures.
 */
export function fill(template: string, vars: Record<string, string | number | undefined>): string {
  return template.replace(/\{(\w+)\}/g, (_, k) => {
    const v = vars[k];
    return v === undefined ? `{${k}}` : String(v);
  });
}
