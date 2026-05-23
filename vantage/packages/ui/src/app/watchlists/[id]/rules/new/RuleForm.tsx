'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import type { Route } from 'next';
import { PUBLIC_LABELS, ASSET_CLASSES, type AlertRuleType } from '@/lib/watchlists';

/**
 * Phase 10 — the alert rule form, written as a sentence the user fills in.
 * Builds { ruleType, config, channels } and hands it to the bound server
 * action. Conditional fields swap with the chosen rule type.
 */

const TIMEZONES = [
  'America/New_York',
  'America/Chicago',
  'America/Denver',
  'America/Los_Angeles',
  'Europe/London',
  'Europe/Paris',
  'Asia/Tokyo',
  'UTC',
];

const select =
  'bg-transparent border-0 border-b border-ink-900 focus:border-editorial focus:outline-none font-serif text-lg py-1 px-1 mx-1';

const RULE_LABEL: Record<AlertRuleType, string> = {
  label_change: 'Label Change',
  score_move: 'Score Move',
  classification_transition: 'Classification Change',
  morning_digest: 'Morning Digest',
};

const RULE_BULLETS: Record<AlertRuleType, string[]> = {
  label_change: [
    'Fires when an item moves to a new label — for example, into Narrative Breakdown.',
    'Watch one specific label, or any label change.',
  ],
  score_move: [
    "Fires when an item's score changes by at least your chosen number of points, versus its previous score.",
    'Set the threshold and whether to watch increases, decreases, or both.',
  ],
  classification_transition: [
    'Fires when an item moves to a different asset class — for example, Core to Tactical.',
    'Watch one target class, or any change.',
  ],
  morning_digest: [
    'Sends the Morning Read at the local time you choose.',
    'Email only — a daily web push would be too noisy.',
  ],
};

export function RuleForm({
  watchlistId,
  createAction,
}: {
  watchlistId: string;
  createAction: (input: {
    watchlistId: string;
    ruleType: AlertRuleType;
    config: Record<string, unknown>;
    channels: { web: boolean; email: boolean };
  }) => Promise<{ ok: boolean; error?: string }>;
}) {
  const router = useRouter();
  const [ruleType, setRuleType] = useState<AlertRuleType>('label_change');
  const [targetLabel, setTargetLabel] = useState<string>('');
  const [targetClass, setTargetClass] = useState<string>('');
  const [thresholdPoints, setThresholdPoints] = useState('5');
  const [direction, setDirection] = useState<'up' | 'down' | 'either'>('either');
  const [sendTime, setSendTime] = useState('07:00');
  const [timezone, setTimezone] = useState('America/New_York');
  const [web, setWeb] = useState(true);
  const [email, setEmail] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function buildConfig(): Record<string, unknown> {
    switch (ruleType) {
      case 'label_change':
        return { targetLabel: targetLabel || null };
      case 'score_move':
        return { thresholdPoints: Number(thresholdPoints), direction };
      case 'classification_transition':
        return { targetClass: targetClass || null };
      case 'morning_digest': {
        const hour = Number(sendTime.split(':')[0] ?? '7');
        return { localTimezone: timezone, sendHour: hour };
      }
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const res = await createAction({
      watchlistId,
      ruleType,
      config: buildConfig(),
      channels: { web, email },
    });
    if (res.ok) {
      router.push(`/watchlists/${watchlistId}` as Route);
    } else {
      setError(res.error ?? 'Could not save the rule.');
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="col-span-12 lg:col-span-9 space-y-10">
      <div>
        <p className="eyebrow mb-3">{RULE_LABEL[ruleType]}</p>
        <ul className="font-serif text-ink-700 leading-relaxed list-disc pl-5 space-y-1">
          {RULE_BULLETS[ruleType].map((b) => (
            <li key={b}>{b}</li>
          ))}
        </ul>
      </div>

      <p className="font-serif text-2xl leading-relaxed text-ink-900">
        Alert me when{' '}
        <span className="text-ink-700">any item in this watchlist</span> experiences
        <select
          className={select}
          value={ruleType}
          onChange={(e) => setRuleType(e.target.value as AlertRuleType)}
        >
          <option value="label_change">a label change</option>
          <option value="score_move">a score move</option>
          <option value="classification_transition">a classification change</option>
          <option value="morning_digest">a daily digest</option>
        </select>
        {ruleType === 'label_change' ? (
          <>
            {' '}to
            <select className={select} value={targetLabel} onChange={(e) => setTargetLabel(e.target.value)}>
              <option value="">any label</option>
              {PUBLIC_LABELS.map((l) => (
                <option key={l.value} value={l.value}>
                  {l.display}
                </option>
              ))}
            </select>
          </>
        ) : null}
        {ruleType === 'score_move' ? (
          <>
            {' '}of
            <input
              type="number"
              min={1}
              max={100}
              value={thresholdPoints}
              onChange={(e) => setThresholdPoints(e.target.value)}
              className="font-mono text-lg w-16 bg-transparent border-0 border-b border-ink-900 focus:border-editorial focus:outline-none mx-1 text-center"
            />
            points or more
            <select
              className={select}
              value={direction}
              onChange={(e) => setDirection(e.target.value as 'up' | 'down' | 'either')}
            >
              <option value="up">up</option>
              <option value="down">down</option>
              <option value="either">in either direction</option>
            </select>
          </>
        ) : null}
        {ruleType === 'classification_transition' ? (
          <>
            {' '}to
            <select className={select} value={targetClass} onChange={(e) => setTargetClass(e.target.value)}>
              <option value="">any class</option>
              {ASSET_CLASSES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </>
        ) : null}
        {ruleType === 'morning_digest' ? (
          <>
            {' '}delivered at
            <input
              type="time"
              value={sendTime}
              onChange={(e) => setSendTime(e.target.value)}
              className="font-mono text-lg bg-transparent border-0 border-b border-ink-900 focus:border-editorial focus:outline-none mx-1"
            />
            in
            <select className={select} value={timezone} onChange={(e) => setTimezone(e.target.value)}>
              {TIMEZONES.map((tz) => (
                <option key={tz} value={tz}>
                  {tz}
                </option>
              ))}
            </select>
          </>
        ) : null}
        .
      </p>

      <div>
        <p className="eyebrow mb-3">Notify me via</p>
        <label className="font-serif text-lg mr-8 cursor-pointer">
          <input
            type="checkbox"
            checked={web}
            onChange={(e) => setWeb(e.target.checked)}
            className="mr-2 accent-editorial"
          />
          Web push
        </label>
        <label className="font-serif text-lg cursor-pointer">
          <input
            type="checkbox"
            checked={email}
            onChange={(e) => setEmail(e.target.checked)}
            className="mr-2 accent-editorial"
          />
          Email
        </label>
      </div>

      {error ? <p className="font-serif italic text-editorial">{error}</p> : null}

      <button
        type="submit"
        disabled={busy || (!web && !email)}
        className="font-display text-2xl text-editorial border-b-2 border-editorial hover:text-editorial-dark hover:border-editorial-dark disabled:text-ink-300 disabled:border-ink-300"
      >
        Save Rule →
      </button>
    </form>
  );
}
