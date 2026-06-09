import { auth } from '@/lib/auth';
import { apiServerGetNullable } from '@/lib/api-server';
import { SideNavLink } from './SideNavLink';

/**
 * Left navigation links — brand and account strip live in the top <Header />.
 *
 * Renders just the link list; the surrounding container (a static sidebar on
 * md+, a slide-in drawer on mobile) is provided by <MobileNavDrawer/> in the
 * layout. Kept a server component so it can fetch the unread-alert badge.
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
    <>
      {NAV_BEFORE_ALERTS.map((item) => (
        <SideNavLink key={item.href} href={item.href} label={item.label} />
      ))}
      {signedIn ? <SideNavLink href="/alerts" label="Alerts" badge={unread} /> : null}
      {NAV_AFTER_ALERTS.map((item) => (
        <SideNavLink key={item.href} href={item.href} label={item.label} />
      ))}
      {signedIn ? <SideNavLink href="/settings" label="Settings" /> : null}
    </>
  );
}
