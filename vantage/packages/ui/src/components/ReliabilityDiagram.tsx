'use client';

import {
  ResponsiveContainer,
  ComposedChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
} from 'recharts';

/**
 * Reliability diagram — predicted confidence (x) vs. realized accuracy (y).
 *
 * Perfect calibration is the diagonal y = x, drawn as an ink-300 hairline.
 * The actual trace is the one editorial-red line; bins below the meaningful
 * sample threshold are dimmed to ink-300 and annotated "(low sample)" so a
 * sparse decision log never looks more confident than it is.
 */

const INK_100 = '#9DA1A8';
const INK_300 = '#B6B9C1';
const INK_500 = '#7B7F89';
const INK_900 = '#15161A';
const CREAM_50 = '#FBFAF7';
const EDITORIAL = '#A8201A';

// Mirror of MEANINGFUL_THRESHOLD in @vantage/shared. Hardcoded so the UI
// bundle doesn't pull the shared package.
const MEANINGFUL_THRESHOLD = 50;

export interface ReliabilityBin {
  confidenceBin: number;
  expectedAccuracy: number;
  actualAccuracy: number;
  sampleSize: number;
}

interface Row {
  confidenceBin: number;
  expectedAccuracy: number;
  actual: number | null; // null for empty bins so the line skips them
  sampleSize: number;
}

function ActualDot(props: any) {
  const { cx, cy, payload } = props;
  if (cx === undefined || cy === undefined || payload?.actual === null) return null;
  const low = payload.sampleSize < MEANINGFUL_THRESHOLD;
  return (
    <g>
      <circle
        cx={cx}
        cy={cy}
        r={3.5}
        fill={low ? INK_300 : EDITORIAL}
        fillOpacity={low ? 0.5 : 1}
        stroke={low ? INK_300 : EDITORIAL}
      />
      {low ? (
        <text
          x={cx + 6}
          y={cy - 6}
          fill={INK_500}
          fontSize={9}
          fontStyle="italic"
          fontFamily="var(--font-mono)"
        >
          (low sample)
        </text>
      ) : null}
    </g>
  );
}

export function ReliabilityDiagram({ bins }: { bins: ReliabilityBin[] }) {
  const data: Row[] = bins.map((b) => ({
    confidenceBin: b.confidenceBin,
    expectedAccuracy: b.expectedAccuracy,
    actual: b.sampleSize > 0 ? b.actualAccuracy : null,
    sampleSize: b.sampleSize,
  }));

  return (
    <div className="w-full h-[420px]">
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={data} margin={{ top: 16, right: 32, bottom: 28, left: 24 }}>
          <CartesianGrid stroke={INK_100} strokeOpacity={0.3} />
          <XAxis
            dataKey="confidenceBin"
            type="number"
            domain={[0, 1]}
            ticks={[0, 0.25, 0.5, 0.75, 1]}
            stroke={INK_900}
            tickLine={false}
            axisLine={{ stroke: INK_900, strokeWidth: 1 }}
            tick={{ fontFamily: 'var(--font-mono)', fontSize: 11, fill: INK_500 }}
            tickFormatter={(v: number) => `${(v * 100).toFixed(0)}%`}
            label={{
              value: 'PREDICTED CONFIDENCE',
              position: 'insideBottom',
              offset: -12,
              style: {
                fontFamily: 'var(--font-mono)',
                fontSize: 10,
                letterSpacing: '0.12em',
                fill: INK_900,
              },
            }}
          />
          <YAxis
            type="number"
            domain={[0, 1]}
            ticks={[0, 0.25, 0.5, 0.75, 1]}
            stroke={INK_900}
            tickLine={false}
            axisLine={{ stroke: INK_900, strokeWidth: 1 }}
            tick={{ fontFamily: 'var(--font-mono)', fontSize: 11, fill: INK_500 }}
            tickFormatter={(v: number) => `${(v * 100).toFixed(0)}%`}
            label={{
              value: 'ACTUAL ACCURACY',
              angle: -90,
              position: 'insideLeft',
              offset: 8,
              style: {
                fontFamily: 'var(--font-mono)',
                fontSize: 10,
                letterSpacing: '0.12em',
                fill: INK_900,
                textAnchor: 'middle',
              },
            }}
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
            labelFormatter={(v: number) => `Confidence ${(v * 100).toFixed(0)}%`}
            formatter={(value: number, name: string) => {
              if (value === null || value === undefined) return ['—', name];
              const label = name === 'expectedAccuracy' ? 'Perfect' : 'Actual';
              return [`${(value * 100).toFixed(0)}%`, label];
            }}
          />

          {/* Perfect-calibration diagonal — ink-300 hairline. */}
          <Line
            type="linear"
            dataKey="expectedAccuracy"
            stroke={INK_300}
            strokeWidth={1}
            dot={false}
            activeDot={false}
            isAnimationActive={false}
          />
          {/* Actual trace — editorial red, dimmed on low-sample bins. */}
          <Line
            type="linear"
            dataKey="actual"
            stroke={EDITORIAL}
            strokeWidth={1.5}
            connectNulls
            dot={<ActualDot />}
            activeDot={false}
            isAnimationActive={false}
          />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
