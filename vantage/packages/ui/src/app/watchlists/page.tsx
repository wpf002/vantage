import Link from 'next/link';
import type { Route } from 'next';
import { redirect } from 'next/navigation';
import { auth } from '@/lib/auth';
import { apiServerGet } from '@/lib/api-server';
import { relativeAge, type WatchlistsResponse } from '@/lib/watchlists';

/**
 * Phase 10 — watchlists index. "Yours" + system-curated, hairline-divided.
 */

export default async function WatchlistsPage() {
  const session = await auth();
  if (!session?.user?.id) {
    redirect('/signin?callbackUrl=/watchlists' as Route);
  }

  const data = await apiServerGet<WatchlistsResponse>('/v1/watchlists');

  return (
    <div className="grid grid-cols-12 gap-x-10 gap-y-10">
      <header className="col-span-12 border-b border-ink-100 pb-10">
        <h1 className="font-display text-5xl xl:text-6xl tracking-editorial leading-tight mb-4">
          Things You&apos;re Watching
        </h1>
        <p className="font-serif text-deck text-ink-800 max-w-measure">
          Track the names you care about. Get alerted when they move.
        </p>
      </header>

      {/* ── Yours ───────────────────────────────────────────────────── */}
      <section className="col-span-12">
        <div className="flex items-baseline justify-between mb-4">
          <p className="eyebrow">Yours</p>
          <Link
            href={'/watchlists/new' as Route}
            className="font-sans text-eyebrow uppercase tracking-wider text-editorial hover:text-editorial-dark"
          >
            New Watchlist →
          </Link>
        </div>
        {data.mine.length === 0 ? (
          <p className="font-serif italic text-ink-500 text-lg py-6">Nothing watched yet.</p>
        ) : (
          <table className="editorial-table">
            <thead>
              <tr>
                <th>Name</th>
                <th className="num">Items</th>
                <th className="num">Last Activity</th>
              </tr>
            </thead>
            <tbody>
              {data.mine.map((w) => (
                <tr key={w.id}>
                  <td className="font-serif text-ink-900">
                    <Link
                      href={`/watchlists/${w.id}` as Route}
                      className="hover:underline decoration-editorial underline-offset-4"
                    >
                      {w.name}
                    </Link>
                    {w.description && w.description !== w.name ? (
                      <span className="block font-serif italic text-ink-500 text-sm">
                        {w.description}
                      </span>
                    ) : null}
                  </td>
                  <td className="num">{w.itemCount}</td>
                  <td className="num text-ink-500">{relativeAge(w.lastActivityAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {/* ── System ──────────────────────────────────────────────────── */}
      <section className="col-span-12 pt-2">
        <p className="eyebrow mb-2">System</p>
        {data.system.length === 0 ? (
          <p className="font-serif italic text-ink-500">No curated lists yet.</p>
        ) : (
          <ul>
            {data.system.map((w) => (
              <li key={w.id} className="border-b border-ink-100 py-4">
                <Link href={`/watchlists/${w.id}` as Route} className="group block">
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="font-serif text-lg text-ink-900 group-hover:underline decoration-editorial underline-offset-4">
                      {w.name}
                    </span>
                    <span className="font-mono text-xs text-ink-500 whitespace-nowrap">
                      {w.itemCount} {w.itemCount === 1 ? 'name' : 'names'}
                    </span>
                  </div>
                  {w.description && w.description !== w.name ? (
                    <span className="font-serif text-sm text-ink-700">{w.description}</span>
                  ) : null}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
