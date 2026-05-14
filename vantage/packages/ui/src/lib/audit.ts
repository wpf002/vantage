// Static demo data for the Sources pages — the record of every read Vantage
// has produced, and the steps behind each one.

import type { AuditStep } from './companies';
import { getPublicCompany, getPrivateCompany } from './companies';

export interface AuditRecord {
  id: string;
  entity: string;
  entityHref: string | null; // link to the company page, when there is one
  what: string; // plain-English description of what was produced
  confidence: number;
  date: string;
  summary: string; // one line: what this record is
  steps: AuditStep[];
}

const D = '2026-05-14';

const RECORDS: Record<string, AuditRecord> = {
  a1: {
    id: 'a1',
    entity: 'NVIDIA Corporation',
    entityHref: '/public/NVDA',
    what: 'Public company score',
    confidence: 0.71,
    date: D,
    summary: "The score and verdict on NVIDIA's stock price versus its fundamentals.",
    steps: getPublicCompany('NVDA')?.lineage ?? [],
  },
  a2: {
    id: 'a2',
    entity: 'Anthropic, PBC',
    entityHref: '/private/anthropic',
    what: 'Private valuation',
    confidence: 0.62,
    date: D,
    summary: 'A valuation range for Anthropic, which has no public stock price.',
    steps: getPrivateCompany('anthropic')?.lineage ?? [],
  },
  a3: {
    id: 'a3',
    entity: 'NVIDIA Corporation',
    entityHref: '/public/NVDA',
    what: 'Portfolio group',
    confidence: 0.71,
    date: D,
    summary: 'Where NVIDIA would sit if it were added to the portfolio.',
    steps: [
      { step: 0, label: 'Public company score', op: 'public.score', weight: null, ts: D },
      { step: 1, label: 'Sorted into a portfolio group', op: 'platform.classification', weight: null, ts: D },
    ],
  },
  a4: {
    id: 'a4',
    entity: 'Costco Wholesale Corporation',
    entityHref: '/public/COST',
    what: 'Public company score',
    confidence: 0.84,
    date: D,
    summary: "The score and verdict on Costco's stock price versus its fundamentals.",
    steps: getPublicCompany('COST')?.lineage ?? [],
  },
  a5: {
    id: 'a5',
    entity: 'The portfolio',
    entityHref: '/portfolio',
    what: 'Scenario test',
    confidence: 0.92,
    date: D,
    summary: 'The five-year scenario test run across the whole portfolio.',
    steps: [
      { step: 0, label: 'Portfolio assembled from current reads', op: 'platform.portfolio', weight: null, ts: D },
      { step: 1, label: '10,000 simulated five-year futures', op: 'platform.simulation', weight: null, ts: D },
    ],
  },
};

export function listAuditRecords(): AuditRecord[] {
  return Object.values(RECORDS);
}

export function getAuditRecord(id: string): AuditRecord | undefined {
  return RECORDS[id];
}
