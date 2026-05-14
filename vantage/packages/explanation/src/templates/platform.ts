import type { Signal } from '@vantage/shared';
import { fill } from '../index.js';

export const PLATFORM_TEMPLATES: Record<string, (s: Signal) => string> = {
  'platform.classification': (s) => {
    const cls = s.metadata?.assetClass as string | undefined;
    return fill(`{entity} classified as {class}. {rationale}`, {
      entity: s.entity,
      class: cls ?? 'unclassified',
      rationale: s.rationale,
    });
  },
  'platform.allocation': (s) => {
    const sleeve = s.metadata?.sleeve as string | undefined;
    return fill(`Allocated {weight}% of portfolio to {entity} in the {sleeve} sleeve.`, {
      entity: s.entity,
      weight: (s.magnitude * 100).toFixed(1),
      sleeve: sleeve ?? 'unknown',
    });
  },
  'platform.simulation_outcome': (s) =>
    fill(
      `Simulation outcome for portfolio {entity}: expected magnitude {magnitude} ({direction}). Confidence {confidence}.`,
      {
        entity: s.entity,
        magnitude: s.magnitude.toFixed(2),
        direction: s.direction,
        confidence: s.confidence.toFixed(2),
      },
    ),
};
