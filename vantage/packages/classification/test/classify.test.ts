import { describe, it, expect } from 'vitest';
import { classify } from '../src/index.js';
import type { ClassificationContext } from '../src/index.js';
import type { Signal } from '@vantage/shared';

const TS = '2024-01-01T00:00:00.000Z';
const CHAIN = [{ op: 'test', inputs: {}, output: null, ts: TS }];

function makeSignal(overrides: Partial<Signal>): Signal {
  return {
    entity: 'AAPL',
    timestamp: TS,
    signalType: 'public.score',
    direction: 'bullish',
    magnitude: 0.5,
    confidence: 0.75,
    sourceVersion: '0.1.0',
    transformChain: CHAIN,
    rationale: 'test signal',
    ...overrides,
  };
}

describe('classify()', () => {
  it('returns CORE for high-confidence bullish signals with intact narrative', () => {
    const ctx: ClassificationContext = {
      entity: 'AAPL',
      signals: [
        makeSignal({ direction: 'bullish', confidence: 0.85, signalType: 'public.score' }),
        makeSignal({ direction: 'bullish', confidence: 0.80, signalType: 'private.blended_valuation' }),
        makeSignal({ direction: 'bullish', confidence: 0.90, signalType: 'public.expectation_gap' }),
      ],
    };
    const result = classify(ctx);
    expect(result.classification).toBe('CORE');
    expect(result.confidence).toBeGreaterThan(0.7);
  });

  it('returns AVOID for net bearish signals', () => {
    const ctx: ClassificationContext = {
      entity: 'WEAK',
      signals: [
        makeSignal({ direction: 'bearish', confidence: 0.6, signalType: 'public.score' }),
        makeSignal({ direction: 'bearish', confidence: 0.7, signalType: 'private.blended_valuation' }),
        makeSignal({ direction: 'bullish', confidence: 0.5, signalType: 'public.expectation_gap' }),
      ],
    };
    const result = classify(ctx);
    expect(result.classification).toBe('AVOID');
  });

  it('returns AVOID when average confidence is below the floor', () => {
    const ctx: ClassificationContext = {
      entity: 'LOW',
      signals: [
        makeSignal({ direction: 'bullish', confidence: 0.1, signalType: 'public.score' }),
        makeSignal({ direction: 'bullish', confidence: 0.15, signalType: 'private.blended_valuation' }),
      ],
    };
    const result = classify(ctx);
    expect(result.classification).toBe('AVOID');
  });

  it('returns TACTICAL when narrative heat (NHS) is elevated', () => {
    const ctx: ClassificationContext = {
      entity: 'HOT',
      signals: [
        makeSignal({ direction: 'bullish', confidence: 0.6, signalType: 'public.score' }),
        makeSignal({
          direction: 'bullish',
          confidence: 0.6,
          signalType: 'public.narrative_heat',
          magnitude: 0.65,
        }),
      ],
    };
    const result = classify(ctx);
    expect(result.classification).toBe('TACTICAL');
  });

  it('returns HIGH_ASYMMETRY for moderate-confidence bullish signals', () => {
    const ctx: ClassificationContext = {
      entity: 'MOD',
      signals: [
        makeSignal({ direction: 'bullish', confidence: 0.5, signalType: 'public.score' }),
        makeSignal({ direction: 'bullish', confidence: 0.55, signalType: 'private.blended_valuation' }),
      ],
    };
    const result = classify(ctx);
    expect(result.classification).toBe('HIGH_ASYMMETRY');
  });

  it('result includes the entity and contributing signal types', () => {
    const ctx: ClassificationContext = {
      entity: 'TEST',
      signals: [
        makeSignal({ direction: 'bullish', confidence: 0.8, signalType: 'public.score' }),
      ],
    };
    const result = classify(ctx);
    expect(result.entity).toBe('TEST');
    expect(result.contributingSignals).toContain('public.score');
    expect(result.asOf).toBeTruthy();
  });
});
