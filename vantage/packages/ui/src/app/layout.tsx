import type { Metadata } from 'next';
import { Playfair_Display, Source_Serif_4, Inter, IBM_Plex_Mono } from 'next/font/google';
import { Header } from '@/components/Header';
import { SideNav } from '@/components/SideNav';
import { MobileNavProvider, MobileNavDrawer } from '@/components/MobileNav';
import { ServiceWorkerRegistration } from '@/components/ServiceWorkerRegistration';
import '@/styles/globals.css';

const display = Playfair_Display({
  subsets: ['latin'],
  variable: '--font-display',
  display: 'swap',
});

const serif = Source_Serif_4({
  subsets: ['latin'],
  variable: '--font-serif',
  display: 'swap',
});

const sans = Inter({
  subsets: ['latin'],
  variable: '--font-sans',
  display: 'swap',
});

const mono = IBM_Plex_Mono({
  subsets: ['latin'],
  weight: ['400', '500'],
  variable: '--font-mono',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'Vantage',
  description:
    'Financial intelligence for public and private companies. Scoring, classification, portfolio construction, and simulation with full audit lineage.',
};

/**
 * App shell. The viewport is split into three regions with explicit heights:
 *
 *   ┌─────────────────────────────────────┐
 *   │ Header (fixed height, never scrolls)│
 *   ├─────────┬───────────────────────────┤
 *   │ SideNav │ Main (scrolls vertically) │
 *   │ (full   │                           │
 *   │  height)│                           │
 *   └─────────┴───────────────────────────┘
 *
 * Header has a known height; the flex row below it fills the rest of the
 * viewport so the sidebar always sits flush under the header — no gap, no
 * sticky-offset math.
 */
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="en"
      className={`${display.variable} ${serif.variable} ${sans.variable} ${mono.variable}`}
    >
      <body className="h-screen overflow-hidden flex flex-col">
        <ServiceWorkerRegistration />
        <MobileNavProvider>
          <Header />
          <div className="flex flex-1 min-h-0">
            <MobileNavDrawer>
              <SideNav />
            </MobileNavDrawer>
            <main className="flex-1 min-w-0 overflow-y-auto overflow-x-hidden px-6 py-10 lg:px-12 lg:py-12">
              {children}
            </main>
          </div>
        </MobileNavProvider>
      </body>
    </html>
  );
}
