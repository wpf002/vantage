import { notFound } from 'next/navigation';
import { apiServerGetNullable } from '@/lib/api-server';
import type { PortfolioDetail } from '@/lib/portfolios';
import { PortfolioDetailView } from '@/components/PortfolioDetail';
import { formatDate } from '@/lib/format';

interface PageProps {
  params: Promise<{ slug: string }>;
}

export default async function PublishedPortfolioPage({ params }: PageProps) {
  const { slug } = await params;
  const portfolio = await apiServerGetNullable<PortfolioDetail>(
    `/v1/portfolios/published/${encodeURIComponent(slug)}`,
  );
  if (!portfolio) notFound();

  return (
    <div className="grid grid-cols-12 gap-x-10 gap-y-12">
      <header className="col-span-12 border-b border-ink-100 pb-10">
        <p className="eyebrow mb-3">Published portfolio</p>
        <h1 className="font-display text-5xl tracking-editorial">{portfolio.name}</h1>
        <p className="font-mono text-eyebrow uppercase text-ink-700 tracking-wider mt-6">
          By {portfolio.ownerName ?? portfolio.ownerEmail ?? 'anonymous'}
          {portfolio.publishedAt ? <> · Published {formatDate(portfolio.publishedAt)}</> : null}
        </p>
        {portfolio.description ? (
          <p className="font-serif italic text-deck text-ink-700 max-w-measure mt-6">
            {portfolio.description}
          </p>
        ) : null}
      </header>

      <div className="col-span-12">
        <PortfolioDetailView portfolio={portfolio} />
      </div>
    </div>
  );
}
