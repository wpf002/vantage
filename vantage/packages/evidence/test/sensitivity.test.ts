import { describe, it, expect } from 'vitest';
import { computeWeightedAverageSensitivity, computeFunctionSensitivity } from '../src/sensitivity.js';
import type { SignalInput } from '../src/sensitivity.js';

describe('computeWeightedAverageSensitivity()', () => {
  it('returns empty result for empty inputs', () => {
    const result = computeWeightedAverageSensitivity([]);
    expect(result.sensitivity).toEqual({});
    expect(result.maxSensitivitySignalId).toBeUndefined();
    expect(result.maxSensitivityDelta).toBe(0);
  });

  it('removing the only input → delta equals the baseline', () => {
    const inputs: SignalInput[] = [{ id: 'a', value: 0.8, weight: 1 }];
    const result = computeWeightedAverageSensitivity(inputs);
    // baseline = 0.8, without 'a' = 0
    expect(result.sensitivity['a']).toBeCloseTo(0.8, 5);
    expect(result.maxSensitivitySignalId).toBe('a');
  });

  it('identifies the highest-weight signal as most sensitive', () => {
    const inputs: SignalInput[] = [
      { id: 'heavy', value: 0.9, weight: 0.8 },
      { id: 'light', value: 0.3, weight: 0.1 },
      { id: 'medium', value: 0.5, weight: 0.1 },
    ];
    const result = computeWeightedAverageSensitivity(inputs);
    expect(result.maxSensitivitySignalId).toBe('heavy');
    expect(result.maxSensitivityDelta).toBeGreaterThan(0);
  });

  it('all equal inputs produce equal sensitivities', () => {
    const inputs: SignalInput[] = [
      { id: 'a', value: 0.6, weight: 1 },
      { id: 'b', value: 0.6, weight: 1 },
      { id: 'c', value: 0.6, weight: 1 },
    ];
    const result = computeWeightedAverageSensitivity(inputs);
    // removing any one of three equal inputs → same delta
    const deltas = Object.values(result.sensitivity);
    expect(Math.max(...deltas) - Math.min(...deltas)).toBeCloseTo(0, 10);
  });

  it('delta is always non-negative', () => {
    const inputs: SignalInput[] = [
      { id: 'x', value: 0.2, weight: 2 },
      { id: 'y', value: 0.8, weight: 1 },
    ];
    const result = computeWeightedAverageSensitivity(inputs);
    for (const delta of Object.values(result.sensitivity)) {
      expect(delta).toBeGreaterThanOrEqual(0);
    }
  });
});

describe('computeFunctionSensitivity()', () => {
  it('returns empty result for empty inputs', () => {
    const result = computeFunctionSensitivity([], () => 0);
    expect(result.sensitivity).toEqual({});
    expect(result.maxSensitivitySignalId).toBeUndefined();
  });

  it('uses the recompute function correctly', () => {
    // Score = sum of values, value[a]=10, value[b]=1
    const inputs = [{ id: 'a' }, { id: 'b' }];
    const values: Record<string, number> = { a: 10, b: 1 };
    const recompute = (ids: string[]) => ids.reduce((sum, id) => sum + values[id]!, 0);
    const result = computeFunctionSensitivity(inputs, recompute);
    expect(result.maxSensitivitySignalId).toBe('a');
    expect(result.sensitivity['a']).toBeCloseTo(10, 5); // removing a changes score by 10
    expect(result.sensitivity['b']).toBeCloseTo(1, 5);  // removing b changes score by 1
  });

  it('returns 0 delta when removal from single-element set → fallback 0', () => {
    const inputs = [{ id: 'only' }];
    const result = computeFunctionSensitivity(inputs, (ids) => ids.length * 5);
    // baseline = 5, without 'only' (empty) = 0, delta = 5
    expect(result.sensitivity['only']).toBeCloseTo(5, 5);
    expect(result.maxSensitivitySignalId).toBe('only');
  });
});
