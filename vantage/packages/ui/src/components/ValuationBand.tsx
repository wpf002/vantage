interface ValuationBandProps {
  bear: number;
  base: number;
  bull: number;
  currency?: string;
}

const fmt = (n: number, currency: string) => {
  if (Math.abs(n) >= 1e9) return `${currency}${(n / 1e9).toFixed(2)}B`;
  if (Math.abs(n) >= 1e6) return `${currency}${(n / 1e6).toFixed(1)}M`;
  return `${currency}${n.toLocaleString()}`;
};

/**
 * Bear / Base / Bull valuation band.
 * Editorial table style — hairline rules, mono numbers, eyebrow column heads.
 */
export function ValuationBand({ bear, base, bull, currency = '$' }: ValuationBandProps) {
  const range = bull - bear || 1;
  const basePct = ((base - bear) / range) * 100;

  return (
    <div>
      <p className="eyebrow mb-2">What it's worth</p>
      <p className="font-sans text-xs text-ink-700 mb-4 leading-snug max-w-measure">
        A range, not a single number — the cautious case, the most likely case, and the optimistic case.
      </p>
      <div className="grid grid-cols-3 gap-px bg-ink-100 border border-ink-100">
        <Cell label="Bear" value={fmt(bear, currency)} />
        <Cell label="Base" value={fmt(base, currency)} emphasis />
        <Cell label="Bull" value={fmt(bull, currency)} />
      </div>
      {/* Linear band visualization — hairline scale with mono tick at base.
          Tick position is data-driven (continuous), so inline positioning is
          the idiomatic React approach here. */}
      <div className="mt-6 relative h-px bg-ink-300">
        <div
          className="absolute -top-1 h-2 w-px bg-editorial"
          style={{ left: `${basePct}%` }}
          aria-hidden
        />
        <div
          className="absolute -bottom-6 font-mono text-xs text-editorial"
          style={{ left: `${basePct}%`, transform: 'translateX(-50%)' }}
        >
          {fmt(base, currency)}
        </div>
      </div>
    </div>
  );
}

function Cell({ label, value, emphasis }: { label: string; value: string; emphasis?: boolean }) {
  return (
    <div className="bg-cream px-5 py-6">
      <p className="eyebrow mb-2">{label}</p>
      <p className={`font-mono ${emphasis ? 'text-2xl text-ink-900' : 'text-lg text-ink-700'}`}>
        {value}
      </p>
    </div>
  );
}
