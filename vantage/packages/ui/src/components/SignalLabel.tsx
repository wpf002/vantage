import clsx from 'clsx';
import type { Direction } from '@/lib/companies';

interface SignalLabelProps {
  label: string;
  readPlain: string;
  score?: number;
  direction?: Direction;
  confidence?: number;
}

/**
 * The headline verdict element — "The Read". Eyebrow above, the verdict in
 * Playfair, a plain-English explanation, then score + confidence with captions
 * that say what each number means.
 *
 * Direction colors: bullish → editorial red, bearish → ink-700, neutral → ink-500.
 */
export function SignalLabel({ label, readPlain, score, direction = 'neutral', confidence }: SignalLabelProps) {
  return (
    <div className="border-l-2 border-editorial pl-6">
      <p className="eyebrow mb-2">The Read</p>
      <p
        className={clsx('font-display text-5xl tracking-editorial leading-[1.05]', {
          'text-editorial': direction === 'bullish',
          'text-ink-700': direction === 'bearish',
          'text-ink-500': direction === 'neutral',
        })}
      >
        {label}
      </p>
      <p className="font-serif text-lg text-ink-800 mt-3 max-w-measure leading-relaxed">{readPlain}</p>

      {(score !== undefined || confidence !== undefined) && (
        <div className="mt-6 flex flex-wrap gap-x-12 gap-y-4">
          {score !== undefined && (
            <Metric
              label="Score"
              value={score.toFixed(1)}
              help="0–100. How stretched the price looks versus the fundamentals — low is well-supported, high is running ahead."
            />
          )}
          {confidence !== undefined && (
            <Metric
              label="Confidence"
              value={`${(confidence * 100).toFixed(0)}%`}
              help="How much weight to put on this read, given how clean and consistent the underlying inputs were."
            />
          )}
        </div>
      )}
    </div>
  );
}

function Metric({ label, value, help }: { label: string; value: string; help: string }) {
  return (
    <div className="max-w-[16rem]">
      <div className="flex items-baseline gap-2">
        <span className="eyebrow">{label}</span>
        <span className="font-mono text-lg text-ink-900">{value}</span>
      </div>
      <p className="font-sans text-xs text-ink-700 mt-1 leading-snug">{help}</p>
    </div>
  );
}
