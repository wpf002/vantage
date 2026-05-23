import { z } from 'zod';
import { PublicLabel } from '@vantage/core-public';
import { AssetClass } from '@vantage/shared';

/**
 * Phase 10 — alert rule config + channel schemas. Shared by the routes (input
 * validation) and the evaluator worker (matching logic). config is stored as
 * jsonb; these schemas are the source of truth for its shape per ruleType.
 */

export const AlertRuleType = z.enum([
  'label_change',
  'score_move',
  'classification_transition',
  'morning_digest',
]);
export type AlertRuleType = z.infer<typeof AlertRuleType>;

export const AlertChannels = z.object({
  web: z.boolean(),
  email: z.boolean(),
});
export type AlertChannels = z.infer<typeof AlertChannels>;

export const LabelChangeConfig = z.object({
  targetLabel: PublicLabel.nullable(), // null = any label change
});

export const ScoreMoveConfig = z.object({
  thresholdPoints: z.number().min(0.5).max(100),
  direction: z.enum(['up', 'down', 'either']),
});

export const ClassificationTransitionConfig = z.object({
  targetClass: AssetClass.nullable(), // null = any transition
});

export const MorningDigestConfig = z.object({
  localTimezone: z.string().min(1),
  sendHour: z.number().int().min(0).max(23),
});

export type LabelChangeConfig = z.infer<typeof LabelChangeConfig>;
export type ScoreMoveConfig = z.infer<typeof ScoreMoveConfig>;
export type ClassificationTransitionConfig = z.infer<typeof ClassificationTransitionConfig>;
export type MorningDigestConfig = z.infer<typeof MorningDigestConfig>;

/** Validate a config blob against the schema for its ruleType. Throws on mismatch. */
export function parseRuleConfig(ruleType: AlertRuleType, config: unknown): Record<string, unknown> {
  switch (ruleType) {
    case 'label_change':
      return LabelChangeConfig.parse(config);
    case 'score_move':
      return ScoreMoveConfig.parse(config);
    case 'classification_transition':
      return ClassificationTransitionConfig.parse(config);
    case 'morning_digest':
      return MorningDigestConfig.parse(config);
  }
}

/** Human summary of a rule, for UI + email + CLI. */
export function describeRule(
  ruleType: AlertRuleType,
  config: Record<string, unknown>,
): string {
  switch (ruleType) {
    case 'label_change': {
      const c = LabelChangeConfig.parse(config);
      return c.targetLabel
        ? `When any item moves to ${labelDisplay(c.targetLabel)}`
        : 'When any item changes label';
    }
    case 'score_move': {
      const c = ScoreMoveConfig.parse(config);
      const dir =
        c.direction === 'either' ? 'in either direction' : `${c.direction} ${c.direction === 'up' ? '↑' : '↓'}`;
      return `When any item's score moves ${c.thresholdPoints} points ${dir}`;
    }
    case 'classification_transition': {
      const c = ClassificationTransitionConfig.parse(config);
      return c.targetClass
        ? `When any item is reclassified to ${c.targetClass}`
        : 'When any item changes asset class';
    }
    case 'morning_digest': {
      const c = MorningDigestConfig.parse(config);
      const hh = String(c.sendHour).padStart(2, '0');
      return `Morning Read delivered at ${hh}:00 (${c.localTimezone})`;
    }
  }
}

const LABEL_DISPLAY: Record<string, string> = {
  aligned_strength: 'Aligned Strength',
  expected_weakness: 'Expected Weakness',
  validated_story: 'Validated Story',
  temporary_relief: 'Temporary Relief',
  cracks_forming: 'Cracks Forming',
  story_on_thin_ice: 'Story on Thin Ice',
  market_underreaction: 'Market Underreaction',
  narrative_breakdown: 'Narrative Breakdown',
};

export function labelDisplay(label: string): string {
  return LABEL_DISPLAY[label] ?? label;
}
