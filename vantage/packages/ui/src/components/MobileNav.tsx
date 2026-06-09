'use client';

import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { usePathname } from 'next/navigation';
import clsx from 'clsx';

/**
 * Mobile navigation shell. The SideNav is a fixed-width column that's great on
 * tablet/desktop but eats ~40% of a phone screen. This makes it a slide-in
 * drawer below `md` while staying a persistent sidebar at `md+`.
 *
 * Split into three pieces sharing one context so the hamburger (in the server
 * <Header/>) and the drawer (wrapping the server <SideNav/>) can talk:
 *   - MobileNavProvider — owns open state; wraps the whole shell.
 *   - MobileNavToggle   — hamburger button, mobile only.
 *   - MobileNavDrawer   — renders the nav: off-canvas drawer on mobile, static
 *                         sidebar on md+. Server <SideNav/> is passed as children.
 */

const MobileNavContext = createContext<{ open: boolean; setOpen: (v: boolean) => void }>({
  open: false,
  setOpen: () => {},
});

export function MobileNavProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  // Close the drawer on any route change so tapping a link dismisses it.
  useEffect(() => {
    setOpen(false);
  }, [pathname]);
  return (
    <MobileNavContext.Provider value={{ open, setOpen }}>{children}</MobileNavContext.Provider>
  );
}

export function MobileNavToggle() {
  const { open, setOpen } = useContext(MobileNavContext);
  return (
    <button
      type="button"
      aria-label="Open navigation"
      aria-expanded={open}
      onClick={() => setOpen(true)}
      className="md:hidden -ml-1 p-1 text-ink-900 hover:text-editorial"
    >
      <svg width="22" height="22" viewBox="0 0 22 22" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true">
        <line x1="3" y1="6" x2="19" y2="6" />
        <line x1="3" y1="11" x2="19" y2="11" />
        <line x1="3" y1="16" x2="19" y2="16" />
      </svg>
    </button>
  );
}

export function MobileNavDrawer({ children }: { children: ReactNode }) {
  const { open, setOpen } = useContext(MobileNavContext);
  return (
    <>
      {/* Backdrop — mobile only, when open */}
      <div
        onClick={() => setOpen(false)}
        aria-hidden="true"
        className={clsx(
          'md:hidden fixed inset-0 z-30 bg-ink-900/40 transition-opacity duration-200',
          open ? 'opacity-100' : 'pointer-events-none opacity-0',
        )}
      />
      <aside
        className={clsx(
          'bg-cream-200 overflow-y-auto px-3 py-5 flex flex-col gap-1',
          // Mobile: off-canvas drawer that slides in from the left.
          'fixed inset-y-0 left-0 z-40 w-64 transition-transform duration-200',
          open ? 'translate-x-0 shadow-2xl' : '-translate-x-full',
          // md+: static, in-flow sidebar (its original behavior).
          'md:static md:z-auto md:w-40 xl:w-44 md:flex-shrink-0 md:h-full md:translate-x-0 md:shadow-none',
        )}
      >
        {/* Close affordance — mobile only */}
        <button
          type="button"
          aria-label="Close navigation"
          onClick={() => setOpen(false)}
          className="md:hidden self-end -mt-1 mb-1 p-1 text-ink-500 hover:text-editorial"
        >
          <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true">
            <line x1="5" y1="5" x2="15" y2="15" />
            <line x1="15" y1="5" x2="5" y2="15" />
          </svg>
        </button>
        {children}
      </aside>
    </>
  );
}
