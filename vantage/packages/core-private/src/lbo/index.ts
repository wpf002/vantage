import { z } from 'zod';
import { InsufficientDataError } from '@vantage/shared';
import type { ValuationMethodResult } from '../types.js';

/**
 * LBO — reverse-solves the entry price that delivers a target IRR
 * given leverage, hold period, exit multiple, and EBITDA trajectory.
 *
 * Conservative model: no dividend recap, no add-ons, single-tranche debt.
 */

export const LboInputs = z.object({
  entryEbitda: z.number().positive(),
  exitEbitda: z.number().positive(),
  exitMultiple: z.number().positive(), // EV / EBITDA at exit
  debtToEbitda: z.number().min(0).max(8), // leverage ratio at entry
  interestRate: z.number().min(0),
  taxRate: z.number().min(0).max(1),
  holdYears: z.number().int().min(3).max(10),
  targetIrr: z.number().min(0).default(0.25),
  capexAsPctOfEbitda: z.number().min(0).max(1).default(0.1),
  workingCapitalChangeAsPctOfEbitda: z.number().min(-1).max(1).default(0.05),
});
export type LboInputs = z.infer<typeof LboInputs>;

export function runLbo(input: LboInputs): ValuationMethodResult {
  const v = LboInputs.parse(input);
  const entryDebt = v.debtToEbitda * v.entryEbitda;

  // Cumulative FCF over hold (simple: avg of entry/exit EBITDA)
  const avgEbitda = (v.entryEbitda + v.exitEbitda) / 2;
  const annualInterest = entryDebt * v.interestRate;
  const annualTax = Math.max(0, (avgEbitda - annualInterest) * v.taxRate);
  const annualCapex = avgEbitda * v.capexAsPctOfEbitda;
  const annualWcChange = avgEbitda * v.workingCapitalChangeAsPctOfEbitda;
  const annualFcf = avgEbitda - annualInterest - annualTax - annualCapex - annualWcChange;
  const cumulativeDebtPaydown = Math.max(0, Math.min(entryDebt, annualFcf * v.holdYears));

  const exitEv = v.exitMultiple * v.exitEbitda;
  const exitDebt = Math.max(0, entryDebt - cumulativeDebtPaydown);
  const exitEquity = exitEv - exitDebt;

  if (exitEquity <= 0) {
    throw new InsufficientDataError('lbo', 'exit equity non-positive under these assumptions');
  }

  // Solve entry equity for target IRR: exitEquity = entryEquity * (1 + irr)^years
  const requiredEntryEquity = exitEquity / Math.pow(1 + v.targetIrr, v.holdYears);
  const enterpriseValue = requiredEntryEquity + entryDebt;
  const equityValue = requiredEntryEquity;

  // Confidence falls when leverage is extreme or hold is short
  let confidence = 0.7;
  if (v.debtToEbitda > 6) confidence *= 0.6;
  if (v.holdYears < 4) confidence *= 0.8;

  return {
    method: 'lbo',
    enterpriseValue,
    equityValue,
    confidence,
    rationale: `LBO reverse-solve at ${(v.targetIrr * 100).toFixed(0)}% target IRR over ${v.holdYears}y. Leverage ${v.debtToEbitda.toFixed(1)}x, exit ${v.exitMultiple.toFixed(1)}x.`,
    inputs: {
      entryDebt,
      cumulativeDebtPaydown,
      exitEv,
      exitEquity,
      requiredEntryEquity,
      annualFcf,
    },
    warnings: confidence < 0.3 ? ['confidence below floor — exclude from blend'] : [],
  };
}
