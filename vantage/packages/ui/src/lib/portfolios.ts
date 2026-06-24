/**
 * Portfolio data shapes shared by every UI route that renders one. Wire-
 * compatible with the API responses from packages/api/src/db/portfolioStore.ts.
 */

export interface PortfolioAllocation {
  id: string;
  entity: string;
  name: string;
  sector: string;
  sleeve: 'core' | 'growth' | 'defensive' | 'tactical' | 'none';
  weight: number;
  assetClass: 'CORE' | 'HIGH_ASYMMETRY' | 'TACTICAL' | 'AVOID';
  ticker: string | null;
  marketType: 'public' | 'private' | null;
}

export interface PortfolioDetail {
  id: string;
  name: string;
  kind: 'system' | 'personal' | 'published';
  slug: string | null;
  description: string | null;
  publishedAt: string | null;
  ownerUserId: string | null;
  ownerEmail: string | null;
  ownerName: string | null;
  constraints: {
    maxAssetWeight: number;
    maxSectorWeight: number;
    minCrossSectorCount: number;
    sleeveTargets: {
      core: number;
      growth: number;
      defensive: number;
      tactical: number;
    };
  };
  sleeveWeights: Record<string, number>;
  cashWeight: number;
  warnings: string[];
  asOf: string;
  allocations: PortfolioAllocation[];
}

export interface PortfolioListItem {
  id: string;
  name: string;
  kind: 'system' | 'personal' | 'published';
  slug: string | null;
  description: string | null;
  asOf: string;
  publishedAt: string | null;
  ownerEmail: string | null;
  ownerName: string | null;
  cashWeight: number;
  sleeveWeights: Record<string, number>;
}

export const SLEEVE_LABELS: Record<'core' | 'growth' | 'defensive' | 'tactical', string> = {
  core: 'Core',
  growth: 'Growth',
  defensive: 'Defensive',
  tactical: 'Tactical',
};

export const SECTOR_LABELS: Record<string, string> = {
  technology: 'Technology',
  healthcare: 'Healthcare',
  financials: 'Financials',
  consumer_discretionary: 'Consumer Discretionary',
  consumer_staples: 'Consumer Staples',
  industrials: 'Industrials',
  energy: 'Energy',
  materials: 'Materials',
  utilities: 'Utilities',
  real_estate: 'Real Estate',
  communication_services: 'Communication Services',
  other: 'Other',
};

export function sleeveLabel(s: string): string {
  return (SLEEVE_LABELS as Record<string, string>)[s] ?? s;
}

export function sectorLabel(s: string): string {
  return SECTOR_LABELS[s] ?? s;
}

export function formatPercent(n: number, digits = 1): string {
  return `${(n * 100).toFixed(digits)}%`;
}
