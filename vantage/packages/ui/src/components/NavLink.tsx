'use client';

import Link from 'next/link';
import type { Route } from 'next';
import { usePathname } from 'next/navigation';
import clsx from 'clsx';

/**
 * Client-side nav link that highlights itself when its href matches the
 * current path. Used inside <Header /> (a server component) so the rest of
 * the header can do its `await auth()` work without dragging a client tree
 * down with it.
 */
export function NavLink({ href, label }: { href: string; label: string }) {
  const pathname = usePathname();
  const isActive = href === '/' ? pathname === '/' : pathname.startsWith(href);
  return (
    <Link
      href={href as Route}
      className={clsx('hover:text-editorial', isActive && 'text-editorial')}
    >
      {label}
    </Link>
  );
}
