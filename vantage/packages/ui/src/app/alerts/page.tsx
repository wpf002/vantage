import Link from 'next/link';
import type { Route } from 'next';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { auth } from '@/lib/auth';
import { apiServerGet, apiServerPost } from '@/lib/api-server';
import {
  labelDisplay,
  relativeAge,
  type AlertEventsResponse,
  type AlertEvent,
} from '@/lib/watchlists';

/**
 * Phase 10 — the notifications inbox. Everything Vantage has flagged, newest
 * first, cursor-paginated.
 */

/** Human description of an event from its rule type + payload. */
function whatFired(ev: AlertEvent): string {
  const p = ev.payload;
  switch (ev.ruleType) {
    case 'label_change':
      return `Moved to ${labelDisplay(String(p.toLabel ?? ''))}`;
    case 'score_move': {
      const delta = typeof p.delta === 'number' ? p.delta : 0;
      const to = typeof p.to === 'number' ? p.to : null;
      return `Score ${delta > 0 ? '+' : ''}${delta.toFixed(1)}${to !== null ? ` → ${to.toFixed(0)}` : ''}`;
    }
    case 'classification_transition':
      return `Reclassified ${String(p.fromClass ?? '')} → ${String(p.toClass ?? '')}`;
    case 'morning_digest':
      return 'Morning Read delivered';
    default:
      return p.test ? 'Test dispatch' : 'Activity';
  }
}

export default async function AlertsPage({
  searchParams,
}: {
  searchParams: Promise<{ cursor?: string }>;
}) {
  const session = await auth();
  if (!session?.user?.id) {
    redirect('/signin?callbackUrl=/alerts' as Route);
  }
  const { cursor } = await searchParams;

  const qs = new URLSearchParams({ limit: '50' });
  if (cursor) qs.set('cursor', cursor);
  const data = await apiServerGet<AlertEventsResponse>(`/v1/alerts/events?${qs.toString()}`);

  async function markAllRead() {
    'use server';
    await apiServerPost('/v1/alerts/events/acknowledge-all', {});
    revalidatePath('/alerts');
  }

  return (
    <div className="grid grid-cols-12 gap-x-10 gap-y-8">
      <header className="col-span-12 border-b border-ink-100 pb-8">
        <div className="flex items-start justify-between">
          <div>
            <h1 className="font-display text-5xl tracking-editorial mb-4">Recent Activity</h1>
            <p className="font-serif text-deck text-ink-800 max-w-measure">
              Everything Vantage has flagged for you, newest first.
            </p>
          </div>
          {data.events.length > 0 ? (
            <form action={markAllRead}>
              <button
                type="submit"
                className="font-sans text-eyebrow uppercase tracking-wider text-editorial hover:text-editorial-dark"
              >
                Mark All Read
              </button>
            </form>
          ) : null}
        </div>
      </header>

      <section className="col-span-12 min-w-0">
        {data.events.length === 0 ? (
          <p className="font-serif italic text-ink-500 text-lg py-12">
            Quiet so far. Add an alert rule to a watchlist and they&apos;ll show up here.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="editorial-table">
              <thead>
                <tr>
                  <th className="num">When</th>
                  <th>Entity</th>
                  <th>What</th>
                  <th>Watchlist</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {data.events.map((ev) => (
                  <tr key={ev.id}>
                    <td className="num text-ink-500 whitespace-nowrap">{relativeAge(ev.dispatchedAt)}</td>
                    <td className="font-serif text-ink-900">
                      <Link
                        href={`/public/${ev.entity}` as Route}
                        className="hover:underline decoration-editorial"
                      >
                        {ev.entity}
                      </Link>
                    </td>
                    <td className="eyebrow normal-case text-ink-700">{whatFired(ev)}</td>
                    <td className="font-sans text-xs uppercase tracking-wider text-ink-500">
                      {ev.watchlistId ? (
                        <Link
                          href={`/watchlists/${ev.watchlistId}` as Route}
                          className="hover:text-editorial"
                        >
                          {ev.watchlistName ?? 'Watchlist'}
                        </Link>
                      ) : (
                        '—'
                      )}
                    </td>
                    <td>
                      {!ev.acknowledgedAt ? (
                        <span className="inline-block w-2 h-2 rounded-full bg-editorial" title="Unread" />
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            {data.nextCursor ? (
              <div className="mt-8">
                <Link
                  href={`/alerts?cursor=${encodeURIComponent(data.nextCursor)}` as Route}
                  className="font-sans text-eyebrow uppercase tracking-wider text-editorial hover:text-editorial-dark"
                >
                  Older →
                </Link>
              </div>
            ) : null}
          </div>
        )}
      </section>
    </div>
  );
}
