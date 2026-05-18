import Link from 'next/link';
import type { Route } from 'next';
import { notFound } from 'next/navigation';
import { apiServerGet, apiServerGetNullable } from '@/lib/api-server';
import { formatDate } from '@/lib/format';
import { RelatedReadsList } from './RelatedReadsList';

interface SignalShape {
  signalId: string;
  entity: string;
  companyName: string | null;
  signalType: string;
  direction: 'bullish' | 'neutral' | 'bearish';
  magnitude: number;
  confidence: number;
  sourceVersion: string;
  rationale: string;
  timestamp: string;
}

interface LineageStep {
  step: number;
  op: string;
  inputs: unknown;
  output: unknown;
  weight: number | null;
  timestamp: string;
}

interface AuditDetail {
  signal: SignalShape;
  lineage: LineageStep[];
}

const SIGNAL_TYPE_LABELS: Record<string, string> = {
  'public.score': 'Public Score',
  'private.blended_valuation': 'Private Valuation',
  'platform.classification': 'Classification',
  'platform.portfolio_construction': 'Portfolio Built',
  'platform.simulation_outcome': 'Simulation Run',
};

const OP_LABELS: Record<string, { group: string; label: string }> = {
  'public.egs': { group: 'EGS', label: 'Expectation Gap' },
  'public.nis': { group: 'NIS', label: 'Narrative Integrity' },
  'public.nhs': { group: 'NHS', label: 'Narrative Heat' },
  'public.score': { group: 'Public', label: 'Score Blend' },
  'private.dcf': { group: 'Private', label: 'Discounted Cash Flow' },
  'private.comps': { group: 'Private', label: 'Comparable Companies' },
  'private.lbo': { group: 'Private', label: 'Buyout Model' },
  'private.ml_adjustment': { group: 'Private', label: 'ML Adjustment' },
  'private.blended_valuation': { group: 'Private', label: 'Blended Valuation' },
  'platform.classification': { group: 'Platform', label: 'Classification' },
  'platform.classification.rules': { group: 'Platform', label: 'Asset Class Rules' },
  'platform.simulation.monte_carlo': { group: 'Sim', label: 'Monte Carlo' },
  'platform.simulation.scenario_tree': { group: 'Sim', label: 'Scenario Tree' },
  'platform.simulation.regime_switching': { group: 'Sim', label: 'Regime Switching' },
};

function humanizeSignalType(t: string): string {
  return SIGNAL_TYPE_LABELS[t] ?? t;
}

function displayOp(op: string): { group: string; label: string } {
  return OP_LABELS[op] ?? { group: 'Platform', label: op };
}

function titleCase(direction: string): string {
  if (!direction) return direction;
  return direction.charAt(0).toUpperCase() + direction.slice(1);
}

// Entity slugs like "databricks" or "general-motors" should display in Title
// Case; uppercase tickers like "AAPL" pass through unchanged.
function displayEntity(entity: string): string {
  if (entity === entity.toUpperCase() && entity.length <= 5) return entity;
  return entity
    .split(/[-_]+/)
    .map((w) => (w ? w.charAt(0).toUpperCase() + w.slice(1) : w))
    .join(' ');
}

/**
 * Converts a key like "shareWeight" or "price_confirmation" into Title Case
 * suitable for the audit chain tables. Identifiers that already contain
 * spaces or are all-caps acronyms are passed through unchanged.
 */
const ACRONYMS = new Set([
  'WACC', 'FCF', 'EV', 'IRR', 'DCF', 'LBO', 'EBITDA', 'EBIT', 'LTM', 'NTM',
  'NPV', 'CAGR', 'TAM', 'SAM', 'SOM', 'ARR', 'MRR', 'COGS', 'SG&A', 'API',
  'ID', 'USD', 'UUID', 'P&L', 'YOY', 'QOQ',
]);

function humanizeKey(key: string): string {
  if (key.includes(' ')) return key;
  if (key === key.toUpperCase() && key.length <= 5) return key;
  const withSpaces = key
    .replace(/[_\-]+/g, ' ')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2');
  return withSpaces
    .split(' ')
    .filter(Boolean)
    .map((w) => {
      const upper = w.toUpperCase();
      if (ACRONYMS.has(upper)) return upper;
      if (w === upper && w.length <= 4) return w;
      return w[0]!.toUpperCase() + w.slice(1);
    })
    .join(' ');
}

const ASSET_CLASS_LABELS: Record<string, string> = {
  CORE: 'Core',
  HIGH_ASYMMETRY: 'High Asymmetry',
  TACTICAL: 'Tactical',
  AVOID: 'Avoid',
};

// String leaves in audit tables often carry domain identifiers (signal-type
// keys, asset-class enums). Render them in the same friendly form used
// elsewhere in the app instead of dumping the raw value.
function humanizeStringLeaf(s: string): string {
  if (SIGNAL_TYPE_LABELS[s]) return SIGNAL_TYPE_LABELS[s]!;
  if (ASSET_CLASS_LABELS[s]) return ASSET_CLASS_LABELS[s]!;
  return s;
}

function shortTs(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const date = formatDate(iso);
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${date} ${hh}:${mm}`;
}

function entityHref(entity: string, signalType: string): string {
  const uuidShape = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!uuidShape.test(entity)) return `/public/${entity}`;
  // Simulation and portfolio-construction signals carry portfolio UUIDs, not
  // company UUIDs — route them to the portfolio page.
  if (signalType === 'platform.simulation_outcome' || signalType === 'platform.portfolio_construction') {
    return `/portfolios/${entity}`;
  }
  return `/private/${entity}`;
}

export default async function AuditDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const detail = await apiServerGetNullable<AuditDetail>(`/v1/audit/${id}`);
  if (!detail) notFound();

  // Sibling signals for the right rail. Best-effort — failures fall through.
  // Don't slice — the list component owns its own pagination.
  let related: SignalShape[] = [];
  try {
    const all = await apiServerGet<SignalShape[]>(
      `/v1/audit/by-entity/${encodeURIComponent(detail.signal.entity)}`,
    );
    related = all.filter((s) => s.signalId !== detail.signal.signalId);
  } catch {
    related = [];
  }

  const s = detail.signal;
  const title = `${humanizeSignalType(s.signalType)} — ${s.companyName ?? displayEntity(s.entity)}`;

  return (
    <article className="grid grid-cols-12 gap-x-10 gap-y-10">
      <header className="col-span-12 border-b border-ink-100 pb-10">
        <h1 className="font-display text-5xl tracking-editorial leading-tight">{title}</h1>
        <div className="mt-6 overflow-x-auto">
          <p className="font-mono text-eyebrow uppercase text-ink-900 tracking-wider whitespace-nowrap">
            Run On {shortTs(s.timestamp)} · {s.sourceVersion} · {titleCase(s.direction)} ·
            Confidence {(s.confidence * 100).toFixed(0)}% · Magnitude{' '}
            {(s.magnitude * 100).toFixed(0)}%
          </p>
        </div>
        <div className="mt-5">
          <Link
            href={'/audit' as Route}
            className="font-display text-base text-editorial border-b-2 border-editorial hover:text-editorial-dark hover:border-editorial-dark"
          >
            Audit Chain &rarr;
          </Link>
        </div>
      </header>

      <section className="col-span-12 lg:col-span-8 space-y-12">
        <div>
          <p className="eyebrow mb-3">Rationale</p>
          <p className="font-serif text-base text-ink-800 max-w-measure leading-relaxed">
            {s.rationale || 'No rationale recorded for this signal.'}
          </p>
          <hr className="mt-6" />
        </div>

        <div>
          <p className="eyebrow mb-3">How We Got Here</p>
          <p className="font-sans text-xs text-ink-700 mb-8 leading-snug max-w-measure">
            Every transform that produced this signal, in order. Inputs and outputs are the
            actual values handed to and produced by each operation — nothing here is a black
            box.
          </p>

          {detail.lineage.length === 0 ? (
            <p className="font-serif italic text-ink-700">No transform chain recorded.</p>
          ) : (
            <div>
              {detail.lineage.map((step) => (
                <LineageStepBlock key={step.step} step={step} />
              ))}
            </div>
          )}
          <hr className="mt-2" />
        </div>
      </section>

      <aside className="col-span-12 lg:col-span-4 lg:border-l lg:border-ink-100 lg:pl-10 space-y-10">
        <div>
          <p className="eyebrow mb-3">Entity</p>
          <hr className="mb-5" />
          <Link
            href={entityHref(s.entity, s.signalType) as Route}
            className="font-display text-xl tracking-tight text-editorial border-b border-editorial hover:text-editorial-dark hover:border-editorial-dark"
          >
            {s.companyName ?? displayEntity(s.entity)} &rarr;
          </Link>
          {s.companyName ? (
            <p className="font-mono text-xs text-ink-500 mt-2">{s.entity}</p>
          ) : null}
        </div>

        <div>
          <hr className="border-ink-100 mb-6" />
          <p className="eyebrow mb-3">Related Reads</p>
          <RelatedReadsList signals={related} />
        </div>
      </aside>
    </article>
  );
}

// ─── Per-step block ──────────────────────────────────────────────────────

function LineageStepBlock({ step }: { step: LineageStep }) {
  const { group, label } = displayOp(step.op);

  return (
    <div className="border-t border-ink-100 py-8">
      <div className="flex items-baseline justify-between gap-6 mb-4">
        <p className="font-sans text-eyebrow uppercase tracking-wider text-ink-900">
          {group} · {label}
        </p>
        <p className="font-mono text-eyebrow uppercase tracking-wider text-ink-500 whitespace-nowrap">
          Step {String(step.step + 1).padStart(2, '0')} · {shortTs(step.timestamp)}
        </p>
      </div>

      {step.weight !== null ? (
        <p className="font-mono text-eyebrow uppercase tracking-wider text-editorial mb-5">
          Weight {(step.weight * 100).toFixed(0)}%
        </p>
      ) : null}

      <div className="grid grid-cols-1 md:grid-cols-2 md:divide-x md:divide-ink-100 gap-y-6">
        <div className="md:pr-10">
          <KvBlock title="Inputs" value={step.inputs} />
        </div>
        <div className="md:pl-10">
          <KvBlock title="Output" value={step.output} />
        </div>
      </div>
    </div>
  );
}

function KvBlock({ title, value }: { title: string; value: unknown }) {
  const isEmpty =
    value === null ||
    value === undefined ||
    (typeof value === 'object' &&
      ((Array.isArray(value) && value.length === 0) ||
        (!Array.isArray(value) && Object.keys(value as Record<string, unknown>).length === 0)));

  return (
    <div>
      <p className="font-sans text-eyebrow uppercase tracking-wider text-ink-500 mb-2">
        {title}
      </p>
      <hr className="mb-3" />
      {isEmpty ? (
        <p className="font-serif italic text-xs text-ink-500">empty</p>
      ) : (
        <ValueRenderer value={value} depth={0} />
      )}
    </div>
  );
}

// ─── Recursive value renderer (replaces the JSON dump) ───────────────────

function ValueRenderer({ value, depth }: { value: unknown; depth: number }) {
  if (value === null) return <span className="font-mono text-xs text-ink-500">null</span>;
  if (value === undefined) return <span className="font-mono text-xs text-ink-500">—</span>;

  if (typeof value === 'object') {
    const entries = Array.isArray(value)
      ? value.map((v, i) => [String(i + 1), v] as const)
      : (Object.entries(value as Record<string, unknown>) as Array<readonly [string, unknown]>);

    if (entries.length === 0) {
      return <span className="font-serif italic text-xs text-ink-500">empty</span>;
    }

    return (
      <div className="divide-y divide-ink-100/60">
        {entries.map(([k, v]) => {
          const childIsObject = v !== null && typeof v === 'object';
          const keyLabel = Array.isArray(value) ? k : humanizeKey(k);
          return (
            <div key={k} className="flex items-baseline gap-4 py-1.5">
              <div className="font-sans text-xs text-ink-700 w-2/5 shrink-0">{keyLabel}</div>
              <div className="flex-1 min-w-0 break-words">
                {childIsObject ? (
                  <div className={depth === 0 ? 'pl-3 border-l border-ink-100' : ''}>
                    <ValueRenderer value={v} depth={depth + 1} />
                  </div>
                ) : (
                  <span className="font-mono text-xs text-ink-900">{formatLeaf(v)}</span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    );
  }

  return <span className="font-mono text-xs text-ink-900">{formatLeaf(value)}</span>;
}

function formatLeaf(v: unknown): string {
  if (v === null) return 'null';
  if (v === undefined) return '—';
  if (typeof v === 'number') {
    if (Number.isInteger(v)) return v.toLocaleString();
    const abs = Math.abs(v);
    // Currency-shaped magnitudes — compact $1.23B / $4.5M form
    if (abs >= 1e9) return `${v < 0 ? '-' : ''}$${(abs / 1e9).toFixed(2)}B`;
    if (abs >= 1e6) return `${v < 0 ? '-' : ''}$${(abs / 1e6).toFixed(2)}M`;
    if (abs >= 1000) return v.toLocaleString(undefined, { maximumFractionDigits: 2 });
    if (abs < 0.01 && v !== 0) return v.toExponential(2);
    return v.toFixed(4);
  }
  if (typeof v === 'string') return humanizeStringLeaf(v);
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  try {
    return String(v);
  } catch {
    return '—';
  }
}
