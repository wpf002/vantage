/**
 * Phase 10 — watchlist + alert response shapes. Mirror the API's
 * watchlistStore / alertStore return types. Kept here so server components and
 * server actions share one definition.
 */

export interface WatchlistSummary {
  id: string;
  name: string;
  kind: 'system' | 'personal';
  description: string | null;
  ownerUserId: string | null;
  itemCount: number;
  lastActivityAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface WatchlistItem {
  entity: string;
  addedAt: string;
  ticker: string | null;
  name: string | null;
  sector: string | null;
  assetClass: string | null;
  classConfidence: number | null;
  score: number | null;
  label: string | null;
  scoreConfidence: number | null;
  scoredAt: string | null;
}

export interface WatchlistDetail extends WatchlistSummary {
  items: WatchlistItem[];
}

export interface WatchlistsResponse {
  mine: WatchlistSummary[];
  system: WatchlistSummary[];
}

export type AlertRuleType =
  | 'label_change'
  | 'score_move'
  | 'classification_transition'
  | 'morning_digest';

export interface AlertChannels {
  web: boolean;
  email: boolean;
}

export interface AlertRule {
  id: string;
  watchlistId: string;
  ruleType: AlertRuleType;
  config: Record<string, unknown>;
  channels: AlertChannels;
  active: boolean;
  summary: string;
  createdAt: string;
  lastFiredAt: string | null;
}

export interface AlertEvent {
  id: string;
  ruleId: string;
  entity: string;
  ruleType: string;
  payload: Record<string, unknown>;
  watchlistId: string | null;
  watchlistName: string | null;
  dispatchedAt: string;
  acknowledgedAt: string | null;
}

export interface AlertEventsResponse {
  events: AlertEvent[];
  nextCursor: string | null;
}

export const PUBLIC_LABELS: { value: string; display: string }[] = [
  { value: 'aligned_strength', display: 'Aligned Strength' },
  { value: 'expected_weakness', display: 'Expected Weakness' },
  { value: 'validated_story', display: 'Validated Story' },
  { value: 'temporary_relief', display: 'Temporary Relief' },
  { value: 'cracks_forming', display: 'Cracks Forming' },
  { value: 'story_on_thin_ice', display: 'Story on Thin Ice' },
  { value: 'market_underreaction', display: 'Market Underreaction' },
  { value: 'narrative_breakdown', display: 'Narrative Breakdown' },
];

export const ASSET_CLASSES = ['CORE', 'HIGH_ASYMMETRY', 'TACTICAL', 'AVOID'] as const;

export function labelDisplay(value: string | null): string {
  if (!value) return '—';
  return PUBLIC_LABELS.find((l) => l.value === value)?.display ?? value;
}

/** Compact mono relative time, e.g. "3h ago". */
export function relativeAge(iso: string | null): string {
  if (!iso) return '—';
  const ms = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(ms)) return '—';
  const mins = Math.floor(ms / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}
