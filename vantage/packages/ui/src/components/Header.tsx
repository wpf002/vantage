'use client';

import Link from 'next/link';
import type { Route } from 'next';
import { usePathname } from 'next/navigation';
import clsx from 'clsx';

const NAV = [
  { href: '/', label: 'Home' },
  { href: '/portfolio', label: 'Portfolio' },
  { href: '/classifications', label: 'Classifications' },
  { href: '/simulation', label: 'Scenarios' },
  { href: '/audit', label: 'Sources' },
] as const;

export function Header() {
  const pathname = usePathname();

  const isActive = (href: string) =>
    href === '/' ? pathname === '/' : pathname.startsWith(href);

  return (
    <header className="border-b border-ink-100">
      <div className="mx-auto max-w-page px-6 pt-10 pb-6">
        <div className="flex items-baseline justify-between">
          <Link
            href="/"
            className="font-display text-4xl tracking-editorial text-ink border-b-2 border-editorial"
          >
            Vantage
          </Link>
          <nav className="flex items-baseline text-sm font-sans">
            {NAV.map((item, i) => (
              <span key={item.href} className="flex items-baseline">
                {i > 0 && (
                  <span aria-hidden="true" className="px-3 text-ink-300">
                    ·
                  </span>
                )}
                <Link
                  href={item.href as Route}
                  className={clsx(
                    'hover:text-editorial',
                    isActive(item.href) && 'text-editorial',
                  )}
                >
                  {item.label}
                </Link>
              </span>
            ))}
          </nav>
        </div>
        <Link href="/" className="eyebrow block mt-3">
          Financial Intelligence
        </Link>
      </div>
    </header>
  );
}
