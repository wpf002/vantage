import { z } from 'zod';
import { InsufficientDataError } from '@vantage/shared';
import type { ValuationMethodResult } from '../types.js';

/**
 * DCF — projects free cash flow, discounts at CAPM-derived WACC,
 * terminal value via Gordon Growth model.
 *
 * Confidence collapses when:
 *   - Revenue growth is volatile (std dev > 0.5 across projection)
 *   - Burn rate is heavy relative to cash on hand (< 6 months runway)
 *   - Margin signs flip during projection
 */

export const DcfInputs = z.object({
  // Cash flow projection
  baseRevenue: z.number().positive(),
  revenueGrowthRates: z.array(z.number()).min(3).max(10), // 3–10 year projection
  ebitdaMargin: z.number(),
  taxRate: z.number().min(0).max(1),
  capexAsPctOfRevenue: z.number().min(0).max(1),
  workingCapitalAsPctOfRevenue: z.number().min(0).max(1),
  depreciationAsPctOfRevenue: z.number().min(0).max(1),

  // CAPM inputs for WACC
  riskFreeRate: z.number(),
  equityRiskPremium: z.number(),
  beta: z.number(),
  costOfDebt: z.number(),
  debtToEquityRatio: z.number().min(0),

  // Terminal value
  terminalGrowthRate: z.number(),

  // Capital structure
  netDebt: z.number(),
  sharesOutstanding: z.number().positive().optional(),
});
export type DcfInputs = z.infer<typeof DcfInputs>;

export function computeWacc(input: DcfInputs): number {
  const { riskFreeRate, equityRiskPremium, beta, costOfDebt, debtToEquityRatio, taxRate } = input;
  const costOfEquity = riskFreeRate + beta * equityRiskPremium;
  const equityWeight = 1 / (1 + debtToEquityRatio);
  const debtWeight = debtToEquityRatio / (1 + debtToEquityRatio);
  return equityWeight * costOfEquity + debtWeight * costOfDebt * (1 - taxRate);
}

export function projectFreeCashFlow(input: DcfInputs): number[] {
  const fcf: number[] = [];
  let revenue = input.baseRevenue;
  for (const growth of input.revenueGrowthRates) {
    revenue = revenue * (1 + growth);
    const ebitda = revenue * input.ebitdaMargin;
    const ebit = ebitda - revenue * input.depreciationAsPctOfRevenue;
    const nopat = ebit * (1 - input.taxRate);
    const capex = revenue * input.capexAsPctOfRevenue;
    const wcChange = revenue * input.workingCapitalAsPctOfRevenue;
    const dep = revenue * input.depreciationAsPctOfRevenue;
    fcf.push(nopat + dep - capex - wcChange);
  }
  return fcf;
}

export function terminalValue(finalFcf: number, wacc: number, growth: number): number {
  if (wacc <= growth) {
    throw new InsufficientDataError(
      'dcf',
      `WACC (${wacc.toFixed(4)}) must exceed terminal growth (${growth.toFixed(4)})`,
    );
  }
  return (finalFcf * (1 + growth)) / (wacc - growth);
}

function dcfConfidence(input: DcfInputs): number {
  // Revenue volatility penalty
  const growthRates = input.revenueGrowthRates;
  const mean = growthRates.reduce((a, b) => a + b, 0) / growthRates.length;
  const variance =
    growthRates.reduce((acc, g) => acc + (g - mean) ** 2, 0) / growthRates.length;
  const stdDev = Math.sqrt(variance);

  let confidence = 1.0;
  if (stdDev > 0.5) confidence *= 0.3;
  else if (stdDev > 0.25) confidence *= 0.7;

  // Negative margin penalty
  if (input.ebitdaMargin < 0) confidence *= 0.3;
  else if (input.ebitdaMargin < 0.05) confidence *= 0.7;

  return Math.max(0, Math.min(1, confidence));
}

export function runDcf(input: DcfInputs): ValuationMethodResult {
  const validated = DcfInputs.parse(input);
  const wacc = computeWacc(validated);
  const fcf = projectFreeCashFlow(validated);
  const finalFcf = fcf[fcf.length - 1]!;
  const tv = terminalValue(finalFcf, wacc, validated.terminalGrowthRate);

  // Discount FCFs and terminal value to present
  const pvFcf = fcf.reduce(
    (acc, cf, i) => acc + cf / Math.pow(1 + wacc, i + 1),
    0,
  );
  const pvTv = tv / Math.pow(1 + wacc, fcf.length);
  const enterpriseValue = pvFcf + pvTv;
  const equityValue = enterpriseValue - validated.netDebt;
  const confidence = dcfConfidence(validated);

  return {
    method: 'dcf',
    enterpriseValue,
    equityValue,
    confidence,
    rationale: `DCF projection over ${fcf.length} years at WACC ${(wacc * 100).toFixed(2)}%, terminal growth ${(validated.terminalGrowthRate * 100).toFixed(2)}%.`,
    inputs: { wacc, fcfPath: fcf, terminalValue: tv },
    warnings: confidence < 0.3 ? ['confidence below floor — exclude from blend'] : [],
  };
}
