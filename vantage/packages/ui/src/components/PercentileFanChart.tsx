'use client';

import {
  ResponsiveContainer,
  ComposedChart,
  Area,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
} from 'recharts';

/**
 * Editorial percentile fan.
 *
 * Custom styling — no default Recharts palette. Ink hairlines for axes, cream
 * fills for the bands, ONE editorial-red trace for the median. IBM Plex Mono
 * (mapped via Tailwind's `--font-mono`) for every label and tick.
 */

export interface FanPoint {
  year: number;
  p05: number;
  p25: number;
  p50: number;
  p75: number;
  p95: number;
}

const INK_100 = '#9DA1A8';
const INK_300 = '#B6B9C1';
const INK_500 = '#7B7F89';
const INK_900 = '#15161A';
const CREAM_200 = '#EAE4D8';
const CREAM_50 = '#FBFAF7';
const EDITORIAL = '#A8201A';

interface ChartRow {
  year: number;
  p50: number;
  // Stacked band thicknesses — Recharts stacks Area bottom-up, so each row
  // contributes the segment between two percentile lines. baseline is the
  // floor (worst-case p05) so the bands draw from there.
  baseline: number;
  band05to25: number; // p05 → p25
  band25to50: number; // p25 → p50
  band50to75: number; // p50 → p75
  band75to95: number; // p75 → p95
}

function toChartRows(fan: FanPoint[]): ChartRow[] {
  return fan.map((f) => ({
    year: f.year,
    p50: f.p50 * 100,
    baseline: f.p05 * 100,
    band05to25: (f.p25 - f.p05) * 100,
    band25to50: (f.p50 - f.p25) * 100,
    band50to75: (f.p75 - f.p50) * 100,
    band75to95: (f.p95 - f.p75) * 100,
  }));
}

function fmtPercent(v: number): string {
  const sign = v >= 0 ? '+' : '';
  return `${sign}${v.toFixed(1)}%`;
}

export function PercentileFanChart({ fan }: { fan: FanPoint[] }) {
  const data = toChartRows(fan);

  return (
    <div className="w-full h-[420px]">
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart
          data={data}
          margin={{ top: 16, right: 24, bottom: 24, left: 24 }}
          stackOffset="none"
        >
          <CartesianGrid stroke={INK_100} strokeOpacity={0.3} vertical={false} />
          <XAxis
            dataKey="year"
            stroke={INK_900}
            tickLine={false}
            axisLine={{ stroke: INK_900, strokeWidth: 1 }}
            tick={{ fontFamily: 'var(--font-mono)', fontSize: 11, fill: INK_500 }}
            label={{
              value: 'YEARS',
              position: 'insideBottom',
              offset: -8,
              style: {
                fontFamily: 'var(--font-mono)',
                fontSize: 10,
                letterSpacing: '0.12em',
                fill: INK_900,
              },
            }}
          />
          <YAxis
            stroke={INK_900}
            tickLine={false}
            axisLine={{ stroke: INK_900, strokeWidth: 1 }}
            tick={{ fontFamily: 'var(--font-mono)', fontSize: 11, fill: INK_500 }}
            tickFormatter={(v: number) => `${v.toFixed(0)}%`}
          />
          <Tooltip
            cursor={{ stroke: INK_300, strokeWidth: 1 }}
            contentStyle={{
              background: CREAM_50,
              border: `1px solid ${INK_100}`,
              borderRadius: 0,
              fontFamily: 'var(--font-mono)',
              fontSize: 11,
            }}
            labelFormatter={(label: number) => `YEAR ${label}`}
            formatter={(value: number, name: string) => {
              const labelMap: Record<string, string> = {
                baseline: 'p05',
                band05to25: '+ to p25',
                band25to50: '+ to p50',
                band50to75: '+ to p75',
                band75to95: '+ to p95',
                p50: 'Median',
              };
              return [fmtPercent(value), labelMap[name] ?? name];
            }}
          />

          {/* Invisible baseline so the stacked bands start at p05. */}
          <Area
            type="monotone"
            dataKey="baseline"
            stackId="fan"
            stroke="none"
            fill="none"
            fillOpacity={0}
            isAnimationActive={false}
          />
          <Area
            type="monotone"
            dataKey="band05to25"
            stackId="fan"
            stroke="none"
            fill={CREAM_200}
            fillOpacity={0.6}
            isAnimationActive={false}
          />
          <Area
            type="monotone"
            dataKey="band25to50"
            stackId="fan"
            stroke="none"
            fill={CREAM_200}
            fillOpacity={0.85}
            isAnimationActive={false}
          />
          <Area
            type="monotone"
            dataKey="band50to75"
            stackId="fan"
            stroke="none"
            fill={CREAM_200}
            fillOpacity={0.85}
            isAnimationActive={false}
          />
          <Area
            type="monotone"
            dataKey="band75to95"
            stackId="fan"
            stroke="none"
            fill={CREAM_200}
            fillOpacity={0.6}
            isAnimationActive={false}
          />

          {/* Median trace — the only editorial-red line in the chart. */}
          <Line
            type="monotone"
            dataKey="p50"
            stroke={EDITORIAL}
            strokeWidth={1.5}
            dot={false}
            activeDot={{ r: 3, fill: EDITORIAL, stroke: EDITORIAL }}
            isAnimationActive={false}
          />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
