'use client';

import { useRouter } from 'next/navigation';
import type { Route } from 'next';
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
} from 'recharts';

/**
 * Editorial score-history chart. Custom-styled — no default Recharts palette.
 * Ink hairline axes, IBM Plex Mono labels, ONE editorial-red primary trace
 * (the Public Score) with the three components in descending ink shades.
 * Clicking any point jumps to that read's audit chain.
 */

const INK_100 = '#9DA1A8';
const INK_300 = '#B6B9C1';
const INK_500 = '#7B7F89';
const INK_700 = '#4A4D55';
const INK_900 = '#15161A';
const CREAM_50 = '#FBFAF7';
const EDITORIAL = '#A8201A';

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

export interface HistoryPoint {
  asOf: string;
  score: number;
  label: string;
  confidence: number;
  egs: number | null;
  nis: number | null;
  nhs: number | null;
  signalId: string | null;
}

const TRACES: Array<{ key: keyof HistoryPoint; name: string; color: string; width: number }> = [
  { key: 'score', name: 'Public Score', color: EDITORIAL, width: 1.5 },
  { key: 'egs', name: 'EGS', color: INK_700, width: 1 },
  { key: 'nis', name: 'NIS', color: INK_500, width: 1 },
  { key: 'nhs', name: 'NHS', color: INK_300, width: 1 },
];

const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/**
 * Adaptive axis tick. Year-only ticks read as "2026 2026 2026" when the data
 * only spans days — so scale the granularity to the actual span: day/month
 * for short windows, year for multi-year history.
 */
function fmtTick(iso: string, spanDays: number): string {
  const [y, m, d] = iso.slice(0, 10).split('-');
  if (spanDays <= 45) return `${Number(m)}/${Number(d)}`;
  if (spanDays <= 800) return `${MON[Number(m) - 1]} '${y!.slice(2)}`;
  return y!;
}

interface TooltipProps {
  active?: boolean;
  payload?: Array<{ payload: HistoryPoint }>;
  label?: string;
}

function ChartTooltip({ active, payload, label }: TooltipProps) {
  if (!active || !payload || payload.length === 0) return null;
  const p = payload[0]!.payload;
  const row = (name: string, v: number | null) =>
    v == null ? null : (
      <div key={name} className="flex justify-between gap-6">
        <span>{name}</span>
        <span>{v.toFixed(0)}</span>
      </div>
    );
  return (
    <div
      style={{
        background: CREAM_50,
        border: `1px solid ${INK_100}`,
        fontFamily: 'var(--font-mono)',
        fontSize: 11,
        padding: '8px 10px',
        color: INK_900,
      }}
    >
      <div style={{ marginBottom: 4 }}>{label}</div>
      {row('Public Score', p.score)}
      {row('EGS', p.egs)}
      {row('NIS', p.nis)}
      {row('NHS', p.nhs)}
      <div style={{ marginTop: 4, color: EDITORIAL, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
        {LABEL_DISPLAY[p.label] ?? p.label}
      </div>
    </div>
  );
}

export function ScoreHistoryChart({ data }: { data: HistoryPoint[] }) {
  const router = useRouter();

  // Span of the actual data (not the requested range) drives tick granularity
  // and whether to show point dots — a 3-point series needs visible markers.
  const spanDays =
    data.length > 1
      ? (new Date(data[data.length - 1]!.asOf).getTime() - new Date(data[0]!.asOf).getTime()) /
        86_400_000
      : 0;
  const sparse = data.length <= 14;

  return (
    <div className="w-full h-[420px]">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart
          data={data}
          margin={{ top: 16, right: 24, bottom: 24, left: 8 }}
          onClick={(e) => {
            const point = (e?.activePayload?.[0]?.payload ?? null) as HistoryPoint | null;
            if (point?.signalId) router.push(`/audit/${point.signalId}` as Route);
          }}
        >
          <CartesianGrid stroke={INK_100} strokeOpacity={0.3} vertical={false} />
          <XAxis
            dataKey="asOf"
            stroke={INK_900}
            tickLine={false}
            axisLine={{ stroke: INK_900, strokeWidth: 1 }}
            tick={{ fontFamily: 'var(--font-mono)', fontSize: 11, fill: INK_500 }}
            tickFormatter={(v: string) => fmtTick(v, spanDays)}
            minTickGap={48}
          />
          <YAxis
            domain={[0, 100]}
            stroke={INK_900}
            tickLine={false}
            axisLine={{ stroke: INK_900, strokeWidth: 1 }}
            tick={{ fontFamily: 'var(--font-mono)', fontSize: 11, fill: INK_500 }}
          />
          <Tooltip content={<ChartTooltip />} cursor={{ stroke: INK_300, strokeWidth: 1 }} />
          <Legend
            verticalAlign="bottom"
            height={28}
            iconType="plainline"
            wrapperStyle={{
              fontFamily: 'var(--font-sans)',
              fontSize: 11,
              textTransform: 'uppercase',
              letterSpacing: '0.12em',
              color: INK_700,
            }}
          />
          {TRACES.map((t) => (
            <Line
              key={t.key as string}
              type="monotone"
              dataKey={t.key as string}
              name={t.name}
              stroke={t.color}
              strokeWidth={t.width}
              dot={sparse ? { r: 2.5, fill: t.color, stroke: t.color } : false}
              activeDot={{ r: 3, fill: t.color, stroke: t.color, cursor: 'pointer' }}
              connectNulls
              isAnimationActive={false}
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
