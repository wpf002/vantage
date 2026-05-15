import { notFound, redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import Link from 'next/link';
import type { Route } from 'next';
import { auth } from '@/lib/auth';
import { apiServerGetNullable, apiServerPost, apiServerDelete } from '@/lib/api-server';
import type { PortfolioDetail } from '@/lib/portfolios';
import { PortfolioDetailView } from '@/components/PortfolioDetail';
import { ConfirmSubmitButton } from '@/components/ConfirmSubmitButton';
import { formatDate } from '@/lib/format';

interface PageProps {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string; renamed?: string }>;
}

export default async function PortfolioByIdPage({ params, searchParams }: PageProps) {
  const { id } = await params;
  const { error, renamed } = await searchParams;
  const session = await auth();
  const userId = session?.user?.id ?? null;

  const portfolio = await apiServerGetNullable<PortfolioDetail>(`/v1/portfolios/${id}`);
  if (!portfolio) notFound();

  const isOwner = userId !== null && portfolio.ownerUserId === userId;

  // Server actions — only valid when the viewer owns the portfolio.
  async function renameAction(formData: FormData) {
    'use server';
    const name = String(formData.get('name') ?? '').trim();
    if (!name) {
      redirect(`/portfolios/${id}?error=${encodeURIComponent('Name cannot be empty')}` as Route);
    }
    try {
      await apiServerPost(`/v1/portfolios/${id}/rename`, { name });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'unknown error';
      const match = msg.match(/"message":"([^"]+)"/);
      const reason = match ? match[1] : msg;
      redirect(`/portfolios/${id}?error=${encodeURIComponent(reason)}` as Route);
    }
    revalidatePath(`/portfolios/${id}`);
    redirect(`/portfolios/${id}?renamed=1` as Route);
  }

  async function deleteAction() {
    'use server';
    await apiServerDelete(`/v1/portfolios/${id}`);
    redirect('/portfolios' as Route);
  }

  return (
    <div className="grid grid-cols-12 gap-x-10 gap-y-12">
      <header className="col-span-12 border-b border-ink-100 pb-10">
        <p className="eyebrow mb-3">Personal Portfolio</p>
        <h1 className="font-display text-5xl tracking-editorial">{portfolio.name}</h1>
        <p className="font-mono text-eyebrow uppercase text-ink-900 tracking-wider mt-6">
          Built {formatDate(portfolio.asOf)}
        </p>
      </header>

      {error ? (
        <div className="col-span-12">
          <p className="font-serif italic text-editorial">{error}</p>
        </div>
      ) : null}
      {renamed ? (
        <div className="col-span-12">
          <p className="font-serif italic text-editorial">Renamed.</p>
        </div>
      ) : null}

      <div className="col-span-12">
        <PortfolioDetailView portfolio={portfolio} />
      </div>

      {isOwner ? (
        <section className="col-span-12 border-t border-ink-100 pt-10 space-y-10">
          <div>
            <p className="eyebrow mb-3">Owner Controls</p>
            <Link
              href={`/portfolios/${id}/rebalance` as Route}
              className="font-display text-base text-editorial border-b-2 border-editorial hover:text-editorial-dark hover:border-editorial-dark"
            >
              Rebalance &rarr;
            </Link>
          </div>

          <div className="max-w-measure">
            <p className="eyebrow mb-2">Rename</p>
            <p className="font-sans text-xs text-ink-700 mb-4 leading-snug">
              Change the display name. The portfolio id and history stay the same.
            </p>
            <form action={renameAction} className="flex items-end gap-4">
              <div className="flex-1">
                <label htmlFor="name" className="eyebrow block mb-2">
                  Name
                </label>
                <input
                  id="name"
                  name="name"
                  type="text"
                  required
                  maxLength={120}
                  defaultValue={portfolio.name}
                  className="block w-full bg-transparent border-0 border-b border-ink-300 focus:border-editorial focus:outline-none font-serif text-lg py-2 px-0"
                />
              </div>
              <button
                type="submit"
                className="font-display text-base text-editorial border-b-2 border-editorial hover:text-editorial-dark hover:border-editorial-dark whitespace-nowrap"
              >
                Save &rarr;
              </button>
            </form>
          </div>

          <div>
            <form action={deleteAction}>
              <ConfirmSubmitButton
                label="Delete →"
                confirmLabel="Click again to permanently delete →"
                className="font-display text-base text-editorial border-b-2 border-editorial hover:text-editorial-dark hover:border-editorial-dark"
              />
            </form>
          </div>
        </section>
      ) : null}
    </div>
  );
}
