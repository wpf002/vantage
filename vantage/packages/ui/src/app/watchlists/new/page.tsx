import type { Route } from 'next';
import { redirect } from 'next/navigation';
import { auth } from '@/lib/auth';
import { apiServerPost } from '@/lib/api-server';

/**
 * Phase 10 — create a new personal watchlist.
 */

export default async function NewWatchlistPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const session = await auth();
  if (!session?.user?.id) {
    redirect('/signin?callbackUrl=/watchlists/new' as Route);
  }
  const { error } = await searchParams;

  async function createAction(formData: FormData) {
    'use server';
    const name = String(formData.get('name') ?? '').trim();
    if (!name) redirect('/watchlists/new?error=Name is required' as Route);
    const description = String(formData.get('description') ?? '').trim();
    try {
      const result = await apiServerPost<{ watchlistId: string }>('/v1/watchlists', {
        name,
        description: description || undefined,
      });
      redirect(`/watchlists/${result.watchlistId}` as Route);
    } catch (err) {
      if (err instanceof Error && err.message.includes('NEXT_REDIRECT')) throw err;
      const msg = err instanceof Error ? err.message : 'unknown error';
      redirect(`/watchlists/new?error=${encodeURIComponent(msg)}` as Route);
    }
  }

  return (
    <div className="grid grid-cols-12 gap-x-10 gap-y-10">
      <header className="col-span-12 border-b border-ink-100 pb-10">
        <p className="eyebrow mb-3">New Watchlist</p>
        <h1 className="font-display text-5xl tracking-editorial">Start a Watchlist</h1>
      </header>

      {error ? (
        <div className="col-span-12">
          <p className="font-serif italic text-editorial">{error}</p>
        </div>
      ) : null}

      <form action={createAction} className="col-span-12 lg:col-span-8 space-y-12">
        <div>
          <label htmlFor="name" className="eyebrow block mb-3">
            Name
          </label>
          <input
            id="name"
            name="name"
            type="text"
            required
            autoFocus
            maxLength={120}
            className="block w-full bg-transparent border-0 border-b border-ink-300 focus:border-editorial focus:outline-none font-serif text-2xl py-3 px-0"
          />
        </div>
        <div>
          <label htmlFor="description" className="eyebrow block mb-3">
            Description <span className="text-ink-300 normal-case">(optional)</span>
          </label>
          <textarea
            id="description"
            name="description"
            rows={3}
            maxLength={500}
            className="block w-full bg-transparent border border-ink-300 focus:border-editorial focus:outline-none font-serif text-lg p-3"
          />
        </div>
        <button
          type="submit"
          className="font-display text-2xl text-editorial border-b-2 border-editorial hover:text-editorial-dark hover:border-editorial-dark"
        >
          Create →
        </button>
      </form>
    </div>
  );
}
