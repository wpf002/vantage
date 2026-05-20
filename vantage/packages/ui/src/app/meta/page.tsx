import { notFound } from 'next/navigation';
import { auth } from '@/lib/auth';
import { isAdminEmail } from '@/lib/admin';
import { apiServerGet } from '@/lib/api-server';
import { ReliabilityDiagram, type ReliabilityBin } from '@/components/ReliabilityDiagram';
import { BackfillButton } from './BackfillButton';

/**
 * /meta — meta-learning overview. Admin-only: non-admins get notFound() so the
 * surface doesn't appear to exist. Honest about thin data — every section that
 * lacks 50 resolved decisions says so rather than charting noise.
 */

const MEANINGFUL_THRESHOLD = 50;

interface SegmentStats {
  hitRate: number;
  brier: number;
  avgConfidence: number;
  calibrationGap: number;
  sampleSize: number;
}

interface LabelStats extends SegmentStats {
  meanForwardReturn90d: number;
}

interface CalibrationResponse {
  counts: { total: number; resolved: number };
  overall: SegmentStats;
  byClass: Record<string, SegmentStats>;
  bySector: Record<string, SegmentStats>;
  byClassAndSector: Record<string, SegmentStats>;
  byLabel: Record<string, LabelStats>;
  byMethod: Record<string, { confidenceCorrelation: number; sampleSize: number }>;
  reliability: { bins: ReliabilityBin[] };
  timeDecay: {
    hitRateAt30d: number;
    hitRateAt60d: number;
    hitRateAt90d: number;
    hitRateAt180d: number;
  };
}

interface TuningSuggestion {
  severity: 'info' | 'consider' | 'recommend';
  segment: string;
  sampleSize: number;
  finding: string;
  action: string | null;
  metrics: Record<string, number>;
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

const CLASS_DISPLAY: Record<string, string> = {
  CORE: 'Core',
  HIGH_ASYMMETRY: 'High Asymmetry',
  TACTICAL: 'Tactical',
  AVOID: 'Avoid',
};

function pct(x: number): string {
  return `${(x * 100).toFixed(0)}%`;
}

function signedPct(x: number): string {
  const sign = x >= 0 ? '+' : '';
  return `${sign}${(x * 100).toFixed(1)}%`;
}

function titleizeSector(s: string): string {
  return s
    .split('_')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

export default async function MetaPage() {
  const session = await auth();
  if (!isAdminEmail(session?.user?.email)) notFound();

  let data: CalibrationResponse | null = null;
  let suggestions: TuningSuggestion[] = [];
  let fetchError: string | null = null;
  try {
    [data, suggestions] = await Promise.all([
      apiServerGet<CalibrationResponse>('/v1/meta/calibration'),
      apiServerGet<TuningSuggestion[]>('/v1/meta/suggestions'),
    ]);
  } catch (err) {
    fetchError = err instanceof Error ? err.message : 'unknown error';
  }

  return (
    <div className="max-w-page">
      <header className="border-b border-ink-100 pb-10 mb-10">
        <p className="eyebrow mb-3">Meta-Learning</p>
        <h1 className="font-display text-5xl tracking-editorial mb-6">How Vantage Is Doing</h1>
        <p className="font-serif text-deck text-ink-700 max-w-measure leading-snug">
          Calibration analysis grounded in realized outcomes. The longer the decision log runs,
          the sharper this gets. Where samples are thin, it says so.
        </p>
      </header>

      {fetchError || !data ? (
        <p className="font-serif italic text-editorial">
          Unable to load calibration. {fetchError}
        </p>
      ) : (
        <>
          <MetricsRow data={data} />

          <SegmentSection
            title="Calibration By Asset Class"
            stats={data.byClass}
            resolved={data.counts.resolved}
            display={CLASS_DISPLAY}
            firstColLabel="Class"
          />

          <SegmentSection
            title="Calibration By Sector"
            stats={data.bySector}
            resolved={data.counts.resolved}
            displayFn={titleizeSector}
            firstColLabel="Sector"
          />

          <LabelSection labels={data.byLabel} resolved={data.counts.resolved} />

          <section className="mb-14">
            <h2 className="font-display text-2xl tracking-editorial mb-6">Reliability Diagram</h2>
            {data.overall.sampleSize === 0 ? (
              <Insufficient resolved={data.counts.resolved} />
            ) : (
              <>
                <ReliabilityDiagram bins={data.reliability.bins} />
                <p className="font-serif italic text-sm text-ink-500 mt-3">
                  The diagonal is perfect calibration. Dimmed points sit below {MEANINGFUL_THRESHOLD}{' '}
                  samples — read them as provisional.
                </p>
              </>
            )}
          </section>

          <SuggestionsSection suggestions={suggestions} />

          <div className="border-t border-ink-100 pt-8 mt-4">
            <BackfillButton />
          </div>
        </>
      )}
    </div>
  );
}

function MetricsRow({ data }: { data: CalibrationResponse }) {
  const { total, resolved } = data.counts;
  const resolvedPct = total === 0 ? 0 : resolved / total;
  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-8 mb-14">
      <Metric value={String(total)} caption="Decisions logged" />
      <Metric value={String(resolved)} caption={`${pct(resolvedPct)} of total resolved`} />
      <Metric
        value={data.overall.sampleSize >= MEANINGFUL_THRESHOLD ? pct(data.overall.hitRate) : '—'}
        caption={
          data.overall.sampleSize >= MEANINGFUL_THRESHOLD
            ? 'Overall hit rate, of decisions resolved'
            : `${data.overall.sampleSize} scored — need ${MEANINGFUL_THRESHOLD}`
        }
      />
      <Metric
        value={
          data.overall.sampleSize >= MEANINGFUL_THRESHOLD ? data.overall.brier.toFixed(3) : '—'
        }
        caption="Brier score · 0.0 = perfect • 0.25 = coin flip"
      />
    </div>
  );
}

function Metric({ value, caption }: { value: string; caption: string }) {
  return (
    <div>
      <div className="font-mono text-4xl text-ink-900 tabular-nums">{value}</div>
      <div className="font-serif italic text-sm text-ink-500 mt-2 leading-snug">{caption}</div>
    </div>
  );
}

function Insufficient({ resolved }: { resolved: number }) {
  return (
    <p className="font-serif italic text-ink-500">
      Insufficient sample — {resolved} resolved {resolved === 1 ? 'decision' : 'decisions'}, need at
      least {MEANINGFUL_THRESHOLD} for meaningful calibration.
    </p>
  );
}

function SegmentSection({
  title,
  stats,
  resolved,
  display,
  displayFn,
  firstColLabel,
}: {
  title: string;
  stats: Record<string, SegmentStats>;
  resolved: number;
  display?: Record<string, string>;
  displayFn?: (key: string) => string;
  firstColLabel: string;
}) {
  const entries = Object.entries(stats);
  return (
    <section className="mb-14">
      <h2 className="font-display text-2xl tracking-editorial mb-6">{title}</h2>
      {entries.length === 0 ? (
        <Insufficient resolved={resolved} />
      ) : (
        <table className="editorial-table">
          <thead>
            <tr>
              <th>{firstColLabel}</th>
              <th className="num">Sample Size</th>
              <th className="num">Hit Rate</th>
              <th className="num">Avg Confidence</th>
              <th className="num">Calibration Gap</th>
            </tr>
          </thead>
          <tbody>
            {entries.map(([key, s]) => {
              const label = display?.[key] ?? displayFn?.(key) ?? key;
              const thin = s.sampleSize < MEANINGFUL_THRESHOLD;
              const gapRed = !thin && s.calibrationGap > 0.15;
              return (
                <tr key={key}>
                  <td className="font-serif text-ink-900">{label}</td>
                  <td className="num">{s.sampleSize}</td>
                  {thin ? (
                    <td className="num font-serif italic text-ink-500" colSpan={3}>
                      — {s.sampleSize} samples
                    </td>
                  ) : (
                    <>
                      <td className="num">{pct(s.hitRate)}</td>
                      <td className="num">{s.avgConfidence.toFixed(2)}</td>
                      <td className={`num ${gapRed ? 'text-editorial' : ''}`}>
                        {s.calibrationGap >= 0 ? '+' : ''}
                        {s.calibrationGap.toFixed(2)}
                      </td>
                    </>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </section>
  );
}

function LabelSection({
  labels,
  resolved,
}: {
  labels: Record<string, LabelStats>;
  resolved: number;
}) {
  const entries = Object.entries(labels);
  return (
    <section className="mb-14">
      <h2 className="font-display text-2xl tracking-editorial mb-6">
        Public Labels: Forward Returns
      </h2>
      {entries.length === 0 ? (
        <Insufficient resolved={resolved} />
      ) : (
        <table className="editorial-table">
          <thead>
            <tr>
              <th>Label</th>
              <th className="num">Sample Size</th>
              <th className="num">90d Forward Return</th>
              <th className="num">Hit Rate</th>
            </tr>
          </thead>
          <tbody>
            {entries.map(([key, s]) => {
              const thin = s.sampleSize < MEANINGFUL_THRESHOLD;
              return (
                <tr key={key}>
                  <td className="font-serif text-ink-900">{LABEL_DISPLAY[key] ?? key}</td>
                  <td className="num">{s.sampleSize}</td>
                  {thin ? (
                    <td className="num font-serif italic text-ink-500" colSpan={2}>
                      — {s.sampleSize} samples
                    </td>
                  ) : (
                    <>
                      <td className="num">{signedPct(s.meanForwardReturn90d)}</td>
                      <td className="num">{pct(s.hitRate)}</td>
                    </>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </section>
  );
}

const SEVERITY_META: Record<TuningSuggestion['severity'], { label: string; cls: string }> = {
  recommend: { label: 'Recommend', cls: 'text-editorial' },
  consider: { label: 'Consider', cls: 'text-ink-700' },
  info: { label: 'Info', cls: 'text-ink-500' },
};

function SuggestionsSection({ suggestions }: { suggestions: TuningSuggestion[] }) {
  return (
    <section className="mb-14">
      <h2 className="font-display text-2xl tracking-editorial mb-6">Suggestions</h2>
      {suggestions.length === 0 ? (
        <p className="font-serif italic text-ink-500">
          No suggestions yet — every segment is either well-calibrated or below the sample
          threshold. This sharpens as the log fills.
        </p>
      ) : (
        <div>
          {suggestions.map((s, i) => {
            const sev = SEVERITY_META[s.severity];
            return (
              <div key={`${s.segment}-${i}`} className="border-t border-ink-100 py-6 first:border-t-0">
                <p className={`font-sans text-eyebrow uppercase tracking-wider mb-2 ${sev.cls}`}>
                  {sev.label}
                </p>
                <h3 className="font-display text-xl tracking-editorial mb-2">{s.segment}</h3>
                <p className="font-serif text-ink-700 leading-snug max-w-measure">{s.finding}</p>
                {s.action ? (
                  <p className="font-serif italic text-ink-900 mt-2 max-w-measure">
                    Action: {s.action}
                  </p>
                ) : null}
                <p className="font-mono text-eyebrow uppercase tracking-wider text-ink-500 mt-3">
                  {s.sampleSize} samples
                </p>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
