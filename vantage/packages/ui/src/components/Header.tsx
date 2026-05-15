import Link from 'next/link';
import type { Route } from 'next';
import { auth, signOut } from '@/lib/auth';
import { NavLink } from './NavLink';

/**
 * Editorial site header — server component so it can read the NextAuth
 * session at render time. Active-state highlighting is delegated to the
 * <NavLink /> client subcomponent.
 *
 * The "Account" link only renders when signed in. The trailing block
 * collapses to a sign-in link otherwise.
 */

const NAV = [
  { href: '/', label: 'Home' },
  { href: '/portfolios', label: 'Portfolios' },
  { href: '/classifications', label: 'Classifications' },
  { href: '/simulation', label: 'Scenarios' },
  { href: '/audit', label: 'Sources' },
] as const;

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
    <header className="border-b border-ink-100">
      <div className="mx-auto max-w-page px-6 pt-6 pb-6">
        {/* Top-right account strip */}
        <div className="flex items-baseline justify-end gap-3 text-xs font-mono text-ink-900 mb-6">
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
            <Link href={'/signin' as Route} className="eyebrow hover:text-editorial">
              Sign In
            </Link>
          )}
        </div>

        {/* Main row — logo + page nav */}
        <div className="flex items-baseline justify-between gap-6">
          <Link
            href="/"
            className="font-display text-4xl tracking-editorial text-ink border-b-2 border-editorial"
          >
            Vantage
          </Link>

          <nav className="flex items-baseline text-sm font-sans flex-wrap justify-end">
            {NAV.map((item, i) => (
              <span key={item.href} className="flex items-baseline">
                {i > 0 && (
                  <span aria-hidden="true" className="px-3 text-ink-300">
                    ·
                  </span>
                )}
                <NavLink href={item.href} label={item.label} />
              </span>
            ))}
            {user ? (
              <>
                <span aria-hidden="true" className="px-3 text-ink-300">·</span>
                <NavLink href="/account" label="Account" />
              </>
            ) : null}
          </nav>
        </div>
        <Link href="/" className="eyebrow block mt-3">
          Financial Intelligence
        </Link>
      </div>
    </header>
  );
}
