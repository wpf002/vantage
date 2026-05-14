import type { Metadata } from 'next';
import { Playfair_Display, Source_Serif_4, Inter, IBM_Plex_Mono } from 'next/font/google';
import { Header } from '@/components/Header';
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
    'Sector-agnostic financial intelligence. Private and public scoring, classification, portfolio construction, simulation — with full audit lineage.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="en"
      className={`${display.variable} ${serif.variable} ${sans.variable} ${mono.variable}`}
    >
      <body>
        <Header />
        <main className="mx-auto max-w-page px-6 py-12">{children}</main>
        <footer className="mx-auto max-w-page px-6 py-12 border-t border-ink-100 mt-24" />
      </body>
    </html>
  );
}
