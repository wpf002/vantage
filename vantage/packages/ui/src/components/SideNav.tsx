import { auth } from '@/lib/auth';
import { apiServerGetNullable } from '@/lib/api-server';
import { SideNavLink } from './SideNavLink';

/**
 * Persistent left navigation panel. Page links only — brand and account
 * strip live in the top <Header />.
 *
 * Takes the full height of its parent flex row (which itself sits below
 * the fixed-height header), so the panel is always flush with the header
 * above and scrolls internally if its content overflows.
 */

// Discovery tools first, then the personal pair (Watchlists + Alerts, which
// carries an unread badge), then portfolio/analysis tools.
const NAV_BEFORE_ALERTS = [
  { href: '/', label: 'Home' },
  { href: '/screener', label: 'Stock Screener' },
  { href: '/board', label: 'Daily Updates' },
  { href: '/classifications', label: 'Classifications' },
  { href: '/watchlists', label: 'Watchlists' },
] as const;

const NAV_AFTER_ALERTS = [
  { href: '/portfolios', label: 'Portfolios' },
  { href: '/simulation', label: 'Simulations' },
  { href: '/audit', label: 'Audit' },
  { href: '/meta', label: 'Track Record' },
] as const;

export async function SideNav() {
  const session = await auth();
  const signedIn = !!session?.user?.id;

  // Unread alert count for the badge — server-side, signed-in only.
  let unread = 0;
  if (signedIn) {
    const res = await apiServerGetNullable<{ count: number }>('/v1/alerts/unread-count');
    unread = res?.count ?? 0;
  }

  return (
    <aside
      className="
        bg-cream-200
        w-40 xl:w-44 flex-shrink-0
        h-full overflow-y-auto
        px-3 py-5
        flex flex-col gap-1
      "
    >
      {NAV_BEFORE_ALERTS.map((item) => (
        <SideNavLink key={item.href} href={item.href} label={item.label} />
      ))}
      {signedIn ? <SideNavLink href="/alerts" label="Alerts" badge={unread} /> : null}
      {NAV_AFTER_ALERTS.map((item) => (
        <SideNavLink key={item.href} href={item.href} label={item.label} />
      ))}
      {signedIn ? <SideNavLink href="/settings" label="Settings" /> : null}
    </aside>
  );
}
