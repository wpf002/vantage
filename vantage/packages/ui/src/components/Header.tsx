import Link from 'next/link';
import type { Route } from 'next';
import { auth, signOut } from '@/lib/auth';

/**
 * Compact top header — single row, brand on the left, account strip
 * inline on the right. Sticky so it stays pinned.
 *
 * Page navigation lives in the left sidebar.
 */

function truncate(s: string, n: number): string {
  return s.length <= n ? s : s.slice(0, n - 1) + '…';
}

export async function Header() {
  const session = await auth();
  const user = session?.user ?? null;

  async function signOutAction() {
    'use server';
    await signOut({ redirectTo: '/' });
  }

  return (
    <header className="sticky top-0 z-20 bg-cream border-b border-ink-100">
      <div className="flex items-baseline justify-between gap-6 px-6 lg:px-8 py-3">
        {/* Brand */}
        <div className="flex items-baseline gap-3">
          <Link
            href="/"
            className="font-display text-2xl tracking-editorial text-ink-900 border-b-2 border-editorial inline-block leading-none pb-0.5"
          >
            Vantage
          </Link>
          <p className="eyebrow text-ink-700">Financial Intelligence</p>
        </div>

        {/* Account strip */}
        <div className="flex items-baseline gap-3 text-xs font-mono text-ink-900">
          {user ? (
            <>
              <span title={user.email ?? undefined}>{truncate(user.email ?? '', 32)}</span>
              <span aria-hidden="true" className="text-ink-300">·</span>
              <form action={signOutAction} className="inline">
                <button
                  type="submit"
                  className="font-sans uppercase tracking-wider hover:text-editorial"
                >
                  Sign Out
                </button>
              </form>
            </>
          ) : (
            <Link
              href={'/signin' as Route}
              className="font-sans uppercase tracking-wider text-editorial hover:text-editorial-dark"
            >
              Sign In
            </Link>
          )}
        </div>
      </div>
    </header>
  );
}
