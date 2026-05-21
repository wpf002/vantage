import { auth } from '@/lib/auth';
import { SideNavLink } from './SideNavLink';

/**
 * Persistent left navigation panel. Page links only — brand and account
 * strip live in the top <Header />.
 *
 * Takes the full height of its parent flex row (which itself sits below
 * the fixed-height header), so the panel is always flush with the header
 * above and scrolls internally if its content overflows.
 */

const NAV = [
  { href: '/', label: 'Home' },
  { href: '/portfolios', label: 'Portfolios' },
  { href: '/classifications', label: 'Classifications' },
  { href: '/screener', label: 'Stock Screener' },
  { href: '/board', label: 'Daily Updates' },
  { href: '/simulation', label: 'Simulations' },
  { href: '/audit', label: 'Audit' },
  { href: '/meta', label: 'Meta' },
] as const;

export async function SideNav() {
  const session = await auth();
  const signedIn = !!session?.user?.id;

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
      {NAV.map((item) => (
        <SideNavLink key={item.href} href={item.href} label={item.label} />
      ))}
      {signedIn ? <SideNavLink href="/settings" label="Settings" /> : null}
    </aside>
  );
}
