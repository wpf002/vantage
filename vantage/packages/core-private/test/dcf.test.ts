import { describe, it, expect } from 'vitest';
import fixture from '../fixtures/saas-series-c.json' with { type: 'json' };
import { runDcf, computeWacc } from '../src/dcf/index.js';

describe('DCF — golden fixture', () => {
  it('computes WACC within expected range', () => {
    const wacc = computeWacc(fixture.dcf as any);
    expect(wacc).toBeGreaterThan(0.08);
    expect(wacc).toBeLessThan(0.11);
  });

  it('produces a positive enterprise value above the floor', () => {
    const result = runDcf(fixture.dcf as any);
    expect(result.enterpriseValue).toBeGreaterThan(fixture.expected.enterpriseValue_minimum);
    expect(result.confidence).toBeGreaterThan(0.5);
  });

  it('rationale references WACC and projection length', () => {
    const result = runDcf(fixture.dcf as any);
    expect(result.rationale).toMatch(/WACC/);
    expect(result.rationale).toMatch(/5 years/);
  });
});
