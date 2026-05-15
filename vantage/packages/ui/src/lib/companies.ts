// Static demo data for every seeded company. Wire to the API in a later phase;
// for now this is what the public/private pages and the homepage read from.

export type Direction = 'bullish' | 'bearish' | 'neutral';

export interface AuditStep {
  step: number;
  label: string; // plain-English name of what ran
  op: string; // technical identifier, kept for the receipts trail
  weight?: number | null;
  ts: string;
}

export interface ScoreFactor {
  name: string;
  meaning: string; // what this factor actually measures, in plain English
  score: number;
  reading: string; // what it's telling us right now
}

export interface MethodWeight {
  method: string;
  weight: number;
  why: string; // why it got this weight, in plain English
}

export interface PublicCompany {
  kind: 'public';
  ticker: string;
  name: string;
  asOf: string;
  sector: string;
  score: number;
  confidence: number;
  direction: Direction;
  read: string; // the headline verdict
  readPlain: string; // one line explaining the verdict
  rationale: string;
  factors: ScoreFactor[];
  lineage: AuditStep[];
}

export interface PrivateCompany {
  kind: 'private';
  id: string;
  name: string;
  asOf: string;
  sector: string;
  lifeStage: string;
  confidence: number;
  direction: Direction;
  read: string;
  readPlain: string;
  valuation: { bear: number; base: number; bull: number };
  methods: MethodWeight[];
  rationale: string;
  lineage: AuditStep[];
}

const AS_OF = '2026-05-14';

const publicLineage = (egs: number, nis: number, nhs: number): AuditStep[] => [
  { step: 0, label: 'Expectation Gap Analysis', op: 'public.egs', weight: egs, ts: AS_OF },
  { step: 1, label: 'Narrative Integrity Check', op: 'public.nis', weight: nis, ts: AS_OF },
  { step: 2, label: 'Narrative Heat Reading', op: 'public.nhs', weight: nhs, ts: AS_OF },
];

const privateLineage = (dcf: number, comps: number, lbo: number): AuditStep[] => [
  { step: 0, label: 'Discounted Cash Flow', op: 'private.dcf', weight: dcf, ts: AS_OF },
  { step: 1, label: 'Comparable Companies', op: 'private.comps', weight: comps, ts: AS_OF },
  { step: 2, label: 'Buyout (LBO) Model', op: 'private.lbo', weight: lbo, ts: AS_OF },
  { step: 3, label: 'Machine-Learning Adjustment', op: 'private.ml_adjustment', weight: null, ts: AS_OF },
];

const factor = (name: string, meaning: string, score: number, reading: string): ScoreFactor => ({
  name,
  meaning,
  score,
  reading,
});

const PUBLIC_COMPANIES: Record<string, PublicCompany> = {
  NVDA: {
    kind: 'public',
    ticker: 'NVDA',
    name: 'NVIDIA Corporation',
    asOf: AS_OF,
    sector: 'Technology',
    score: 67.2,
    confidence: 0.71,
    direction: 'bearish',
    read: 'Story on Thin Ice',
    readPlain: 'The price is leaning on a growth story the numbers have not fully backed up yet.',
    rationale:
      "NVIDIA's stock is priced for AI demand to keep compounding at its current pace. The business is still growing fast — but more slowly than the headline story implies, and the most recent earnings beat barely moved the price, which tells you expectations were already very high. Nothing here is broken. It is simply priced for everything to go right, which leaves little room for it to go wrong.",
    factors: [
      factor(
        'Expectation Gap',
        'How far the stock price has run compared with what the fundamentals currently support.',
        42,
        'Stretched — price is ahead of the numbers',
      ),
      factor(
        'Narrative Integrity',
        'Whether the growth story investors are paying for still holds together.',
        38,
        'Weakening — growth is real but slower than the story',
      ),
      factor(
        'Narrative Heat',
        'How much hype and momentum is baked into the price right now.',
        78,
        'Running hot — heavy crowding and aggressive targets',
      ),
    ],
    lineage: publicLineage(0.45, 0.35, 0.2),
  },
  COST: {
    kind: 'public',
    ticker: 'COST',
    name: 'Costco Wholesale Corporation',
    asOf: AS_OF,
    sector: 'Consumer Staples',
    score: 34.0,
    confidence: 0.84,
    direction: 'bullish',
    read: 'Aligned Strength',
    readPlain: 'The price and the business are telling the same story — no gap to worry about.',
    rationale:
      "Costco's valuation and its fundamentals are moving together. Membership renewals are near record highs, store traffic is steady, and the premium the market pays for the stock has been earned consistently for years. It is a quiet, well-supported story — which, for a company like this, is exactly what you want to see.",
    factors: [
      factor(
        'Expectation Gap',
        'How far the stock price has run compared with what the fundamentals currently support.',
        31,
        'Close — price tracks the business',
      ),
      factor(
        'Narrative Integrity',
        'Whether the growth story investors are paying for still holds together.',
        82,
        'Intact — renewals and traffic confirm it',
      ),
      factor(
        'Narrative Heat',
        'How much hype and momentum is baked into the price right now.',
        29,
        'Calm — little speculative premium',
      ),
    ],
    lineage: publicLineage(0.45, 0.35, 0.2),
  },
  'BRK.B': {
    kind: 'public',
    ticker: 'BRK.B',
    name: 'Berkshire Hathaway Inc.',
    asOf: AS_OF,
    sector: 'Financials',
    score: 29.5,
    confidence: 0.86,
    direction: 'bullish',
    read: 'What You See Is What You Get',
    readPlain: 'The price reflects the business — there is no narrative premium to unwind.',
    rationale:
      "Berkshire trades close to what its parts are actually worth. The insurance operations are throwing off cash, the investment portfolio is marked to market for anyone to check, and there is no growth story propping up the valuation. There is very little here to surprise you on the downside — and that predictability is the whole point.",
    factors: [
      factor(
        'Expectation Gap',
        'How far the stock price has run compared with what the fundamentals currently support.',
        24,
        'Tight — price sits near intrinsic value',
      ),
      factor(
        'Narrative Integrity',
        'Whether the growth story investors are paying for still holds together.',
        88,
        'Solid — earnings power is plainly visible',
      ),
      factor(
        'Narrative Heat',
        'How much hype and momentum is baked into the price right now.',
        22,
        'Cold — no speculative froth',
      ),
    ],
    lineage: publicLineage(0.45, 0.35, 0.2),
  },
  TSLA: {
    kind: 'public',
    ticker: 'TSLA',
    name: 'Tesla, Inc.',
    asOf: AS_OF,
    sector: 'Consumer Discretionary',
    score: 82.4,
    confidence: 0.64,
    direction: 'bearish',
    read: 'Narrative Breakdown',
    readPlain: 'Most of the price rests on things that have not happened yet.',
    rationale:
      "Tesla's valuation leans heavily on businesses that are still mostly promise — robotaxis, energy, and AI. Meanwhile the core car business is facing real price competition and thinner margins. When this much of the price depends on the future rather than the present, even small disappointments tend to move the stock hard.",
    factors: [
      factor(
        'Expectation Gap',
        'How far the stock price has run compared with what the fundamentals currently support.',
        71,
        'Wide — price far ahead of current results',
      ),
      factor(
        'Narrative Integrity',
        'Whether the growth story investors are paying for still holds together.',
        28,
        'Fragile — depends on unproven businesses',
      ),
      factor(
        'Narrative Heat',
        'How much hype and momentum is baked into the price right now.',
        84,
        'Very hot — sentiment-driven swings',
      ),
    ],
    lineage: publicLineage(0.45, 0.35, 0.2),
  },
  MSFT: {
    kind: 'public',
    ticker: 'MSFT',
    name: 'Microsoft Corporation',
    asOf: AS_OF,
    sector: 'Technology',
    score: 54.0,
    confidence: 0.79,
    direction: 'neutral',
    read: 'Fully Valued, Not Overheated',
    readPlain: 'Priced fairly for a business that keeps delivering — little margin for error, but no obvious stretch.',
    rationale:
      "Microsoft's price sits in a reasonable range for what the business actually produces. Cloud growth is durable, the AI products are starting to show up in revenue rather than just slide decks, and no single heroic assumption is holding the valuation up. It is fully valued — you are paying a fair price — but it is not running hot.",
    factors: [
      factor(
        'Expectation Gap',
        'How far the stock price has run compared with what the fundamentals currently support.',
        52,
        'Moderate — price slightly ahead of the numbers',
      ),
      factor(
        'Narrative Integrity',
        'Whether the growth story investors are paying for still holds together.',
        74,
        'Holding — cloud and AI revenue confirm it',
      ),
      factor(
        'Narrative Heat',
        'How much hype and momentum is baked into the price right now.',
        48,
        'Warm — some AI premium, not excessive',
      ),
    ],
    lineage: publicLineage(0.45, 0.35, 0.2),
  },
};

const PRIVATE_COMPANIES: Record<string, PrivateCompany> = {
  anthropic: {
    kind: 'private',
    id: 'anthropic',
    name: 'Anthropic, PBC',
    asOf: AS_OF,
    sector: 'AI Infrastructure',
    lifeStage: 'Late stage (Series C+)',
    confidence: 0.62,
    direction: 'bullish',
    read: 'Wide Range, Tilted Up',
    readPlain: 'The downside is real, but the upside case is much larger — an asymmetric bet.',
    rationale:
      "Anthropic is hard to pin down precisely, and the valuation range shows it — the optimistic case is more than triple the pessimistic one. We leaned on comparable companies rather than a cash-flow model, because the company is still spending heavily to grow and its near-term cash flows would understate the business. The bet here is not subtle: a real chance it disappoints, and a larger chance it ends up worth far more than today's mark.",
    valuation: { bear: 18_000_000_000, base: 32_000_000_000, bull: 58_000_000_000 },
    methods: [
      { method: 'Discounted Cash Flow', weight: 0.0, why: 'Set aside — too early for a cash-flow model to mean much.' },
      { method: 'Comparable Companies', weight: 0.7, why: 'Valued against similar AI-infrastructure companies.' },
      { method: 'Buyout (LBO) Model', weight: 0.3, why: 'Cross-checked against what a growth buyer could pay.' },
    ],
    lineage: privateLineage(0.0, 0.7, 0.3),
  },
  stripe: {
    kind: 'private',
    id: 'stripe',
    name: 'Stripe, Inc.',
    asOf: AS_OF,
    sector: 'Payments',
    lifeStage: 'Pre-IPO',
    confidence: 0.81,
    direction: 'bullish',
    read: 'Steady Footing',
    readPlain: 'A mature business with a tight, well-supported valuation range.',
    rationale:
      "Stripe is far enough along that the numbers behave. Payment volume is large, growing, and fairly predictable, so the valuation range is tighter than most private companies. We weighted the cash-flow model and the comparable-company analysis roughly evenly — and they agree, which is reassuring. This reads less like a bet and more like a hold.",
    valuation: { bear: 65_000_000_000, base: 95_000_000_000, bull: 130_000_000_000 },
    methods: [
      { method: 'Discounted Cash Flow', weight: 0.45, why: 'Cash flows are stable enough to model directly.' },
      { method: 'Comparable Companies', weight: 0.45, why: 'Checked against public payment networks.' },
      { method: 'Buyout (LBO) Model', weight: 0.1, why: 'Light cross-check — buyout math is not the main driver.' },
    ],
    lineage: privateLineage(0.45, 0.45, 0.1),
  },
  databricks: {
    kind: 'private',
    id: 'databricks',
    name: 'Databricks, Inc.',
    asOf: AS_OF,
    sector: 'Data & AI Infrastructure',
    lifeStage: 'Pre-IPO',
    confidence: 0.58,
    direction: 'bullish',
    read: 'Priced for Momentum',
    readPlain: 'Growing fast and priced for it — the open question is whether the pace holds.',
    rationale:
      "Databricks is growing quickly, and the valuation assumes that continues. We relied mostly on comparable companies, since the business reinvests everything into growth and a cash-flow model would understate it today. The range is wide on purpose: if growth holds, the current price looks cheap; if it slows, the premium unwinds quickly.",
    valuation: { bear: 30_000_000_000, base: 55_000_000_000, bull: 95_000_000_000 },
    methods: [
      { method: 'Discounted Cash Flow', weight: 0.1, why: 'Minimal weight — heavy reinvestment makes near-term cash flows misleading.' },
      { method: 'Comparable Companies', weight: 0.75, why: 'Valued against fast-growing data and cloud companies.' },
      { method: 'Buyout (LBO) Model', weight: 0.15, why: 'Light cross-check on buyer economics.' },
    ],
    lineage: privateLineage(0.1, 0.75, 0.15),
  },
};

export function getPublicCompany(ticker: string): PublicCompany | undefined {
  return PUBLIC_COMPANIES[ticker.toUpperCase()];
}

export function getPrivateCompany(id: string): PrivateCompany | undefined {
  return PRIVATE_COMPANIES[id.toLowerCase()];
}

export interface QuickPick {
  kind: 'public' | 'private';
  id: string;
  name: string;
  read: string;
  direction: Direction;
}

export const QUICK_PICKS: QuickPick[] = [
  ...Object.values(PUBLIC_COMPANIES).map(
    (c): QuickPick => ({ kind: 'public', id: c.ticker, name: c.name, read: c.read, direction: c.direction }),
  ),
  ...Object.values(PRIVATE_COMPANIES).map(
    (c): QuickPick => ({ kind: 'private', id: c.id, name: c.name, read: c.read, direction: c.direction }),
  ),
];

export function quickPickHref(p: QuickPick): string {
  return p.kind === 'public' ? `/public/${p.id}` : `/private/${p.id}`;
}

export function searchCompanies(query: string): QuickPick[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  return QUICK_PICKS.filter(
    (p) => p.id.toLowerCase().includes(q) || p.name.toLowerCase().includes(q),
  );
}
