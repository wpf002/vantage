'use client';

import Link from 'next/link';
import type { Route } from 'next';
import { usePathname } from 'next/navigation';
import clsx from 'clsx';

/**
 * Sidebar nav row.
 *
 * Active row: filled cream-50 pill with a hairline border — sits raised
 * against the cream-200 panel so "you are here" reads instantly. Inactive
 * rows hover to a softer cream-50 fill.
 */
export function SideNavLink({
  href,
  label,
  badge,
}: {
  href: string;
  label: string;
  badge?: number;
}) {
  const pathname = usePathname();
  const isActive = href === '/' ? pathname === '/' : pathname.startsWith(href);
  return (
    <Link
      href={href as Route}
      className={clsx(
        'flex items-center justify-between px-3 py-2 rounded text-sm font-sans transition-colors',
        isActive
          ? 'bg-cream-50 text-editorial border border-ink-100 shadow-sm font-medium'
          : 'text-ink-900 border border-transparent hover:bg-cream-50 hover:text-editorial',
      )}
    >
      <span>{label}</span>
      {badge && badge > 0 ? (
        <span className="font-mono text-[10px] leading-none px-1.5 py-1 rounded-full bg-editorial text-cream-50">
          {badge > 99 ? '99+' : badge}
        </span>
      ) : null}
    </Link>
  );
}
