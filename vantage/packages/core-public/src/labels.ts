import { z } from 'zod';

/**
 * Eight signal labels emerge from the Public Score and its directional components.
 * Mapped per the project description's taxonomy table.
 */

export const PublicLabel = z.enum([
  'aligned_strength',
  'expected_weakness',
  'validated_story',
  'temporary_relief',
  'cracks_forming',
  'story_on_thin_ice',
  'market_underreaction',
  'narrative_breakdown',
]);
export type PublicLabel = z.infer<typeof PublicLabel>;

export const PublicLabelMeta: Record<
  PublicLabel,
  {
    display: string;
    direction: 'bullish' | 'bearish' | 'neutral';
    range: [number, number];
    description: string;
  }
> = {
  aligned_strength: {
    display: 'Aligned Strength',
    direction: 'bullish',
    range: [0, 25],
    description: 'Beat + price confirmed + narrative supported.',
  },
  expected_weakness: {
    display: 'Expected Weakness',
    direction: 'bearish',
    range: [0, 25],
    description: 'Miss + price reflected it correctly.',
  },
  validated_story: {
    display: 'Validated Story',
    direction: 'bullish',
    range: [26, 45],
    description: 'Narrative supported, recent results in line.',
  },
  temporary_relief: {
    display: 'Temporary Relief',
    direction: 'bearish',
    range: [26, 45],
    description: 'Price holding despite weak data.',
  },
  cracks_forming: {
    display: 'Cracks Forming',
    direction: 'bearish',
    range: [46, 65],
    description: 'Gap widening, directional risk building.',
  },
  story_on_thin_ice: {
    display: 'Story on Thin Ice',
    direction: 'bearish',
    range: [46, 65],
    description: 'Heat elevated, narrative weak.',
  },
  market_underreaction: {
    display: 'Market Underreaction',
    direction: 'bullish',
    range: [66, 100],
    description: 'Real beat, no price response.',
  },
  narrative_breakdown: {
    display: 'Narrative Breakdown',
    direction: 'bearish',
    range: [66, 100],
    description: 'Story not justified by numbers.',
  },
};

export interface LabelClassifierInputs {
  publicScore: number;
  egsDirection: 'confirming' | 'disconfirming' | 'neutral';
  nisScore: number;
  nhsScore: number;
  surpriseSign: number; // +1 beat, -1 miss, 0 in-line
}

/**
 * Pick the label from score band + direction signals.
 * Bands are taken from PublicLabelMeta ranges.
 */
export function classifyLabel(inputs: LabelClassifierInputs): PublicLabel {
  const { publicScore, egsDirection, nisScore, nhsScore, surpriseSign } = inputs;

  // Band 0–25 — aligned outcomes
  if (publicScore <= 25) {
    return surpriseSign >= 0 ? 'aligned_strength' : 'expected_weakness';
  }

  // Band 26–45 — narrative-driven
  if (publicScore <= 45) {
    return nisScore >= 60 ? 'validated_story' : 'temporary_relief';
  }

  // Band 46–65 — deteriorating or overheated
  if (publicScore <= 65) {
    return nhsScore >= 60 ? 'story_on_thin_ice' : 'cracks_forming';
  }

  // Band 66+ — extreme reading
  return egsDirection === 'disconfirming' && surpriseSign > 0
    ? 'market_underreaction'
    : 'narrative_breakdown';
}
