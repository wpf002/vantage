import { Signal, ValidationError, ENGINE_VERSIONS } from '@vantage/shared';
import type { Signal as SignalT, TransformStep } from '@vantage/shared';

/**
 * Harmonizer — gatekeeper for every Signal entering the platform.
 *
 * Responsibilities:
 *   1. Validate against the universal Signal schema.
 *   2. Enforce non-empty transformChain (no signals without lineage).
 *   3. Stamp harmonizer version on metadata.
 *   4. Cross-source dedupe (same entity + signalType + timestamp wins by confidence).
 */

export interface HarmonizeOptions {
  enforceLineage?: boolean; // default true — reject signals with empty transformChain
  enforceConfidenceFloor?: number; // optional — reject below this
}

export function harmonize(raw: unknown, opts: HarmonizeOptions = {}): SignalT {
  const parsed = Signal.safeParse(raw);
  if (!parsed.success) {
    throw new ValidationError('signal failed schema validation', { issues: parsed.error.issues });
  }
  const s = parsed.data;

  const enforceLineage = opts.enforceLineage ?? true;
  if (enforceLineage && s.transformChain.length === 0) {
    throw new ValidationError(
      `signal has empty transformChain — nothing scores without lineage`,
      { entity: s.entity, signalType: s.signalType },
    );
  }

  if (opts.enforceConfidenceFloor !== undefined && s.confidence < opts.enforceConfidenceFloor) {
    throw new ValidationError(
      `signal confidence ${s.confidence.toFixed(2)} below floor ${opts.enforceConfidenceFloor.toFixed(2)}`,
      { entity: s.entity, signalType: s.signalType },
    );
  }

  return {
    ...s,
    metadata: {
      ...(s.metadata ?? {}),
      harmonizerVersion: ENGINE_VERSIONS.HARMONIZER,
    },
  };
}

/**
 * Dedupe a batch — for each (entity, signalType, timestamp) tuple keep the
 * highest-confidence signal. Preserves transformChain of the winner.
 */
export function dedupe(signals: SignalT[]): SignalT[] {
  const byKey = new Map<string, SignalT>();
  for (const s of signals) {
    const key = `${s.entity}|${s.signalType}|${s.timestamp}`;
    const existing = byKey.get(key);
    if (!existing || s.confidence > existing.confidence) {
      byKey.set(key, s);
    }
  }
  return Array.from(byKey.values());
}

/**
 * Walk a signal's transformChain and flatten it into a list of (op, input, output)
 * tuples suitable for the audit log table.
 */
export function flattenLineage(s: SignalT): Array<{
  entity: string;
  signalType: string;
  step: number;
  op: string;
  inputs: Record<string, unknown>;
  output: unknown;
  weight: number | null;
  ts: string;
}> {
  return s.transformChain.map((step: TransformStep, idx) => ({
    entity: s.entity,
    signalType: s.signalType,
    step: idx,
    op: step.op,
    inputs: step.inputs,
    output: step.output,
    weight: step.weight ?? null,
    ts: step.ts,
  }));
}
