'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import clsx from 'clsx';

const NAV = [
  { href: '/', label: 'Home' },
  { href: '/portfolio', label: 'Portfolio' },
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
          <nav className="flex gap-8 text-sm font-sans">
            {NAV.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className={clsx(
                  'hover:text-editorial',
                  isActive(item.href) && 'text-editorial',
                )}
              >
                {item.label}
              </Link>
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
