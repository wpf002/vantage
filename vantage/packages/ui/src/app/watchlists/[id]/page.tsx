import Link from 'next/link';
import type { Route } from 'next';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { auth } from '@/lib/auth';
import {
  apiServerGet,
  apiServerGetNullable,
  apiServerPost,
  apiServerPatch,
  apiServerDelete,
} from '@/lib/api-server';
import { ConfirmSubmitButton } from '@/components/ConfirmSubmitButton';
import { type AlertRule, type WatchlistDetail } from '@/lib/watchlists';
import { AddItemSearch } from './AddItemSearch';
import { WatchlistItemsTable } from './WatchlistItemsTable';

/**
 * Phase 10 — watchlist detail. Items table + alert-rule right rail. System
 * watchlists are read-only; owned ones expose rename / delete / add / remove
 * and rule management.
 */

export default async function WatchlistDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string; renamed?: string }>;
}) {
  const session = await auth();
  const { id } = await params;
  if (!session?.user?.id) {
    redirect(`/signin?callbackUrl=/watchlists/${id}` as Route);
  }
  const { error, renamed } = await searchParams;

  const wl = await apiServerGetNullable<WatchlistDetail>(`/v1/watchlists/${id}`);
  if (!wl) {
    return (
      <div className="max-w-measure">
        <p className="eyebrow mb-3">Watchlist</p>
        <p className="font-serif italic text-ink-500 text-lg">This watchlist doesn&apos;t exist.</p>
      </div>
    );
  }
  const isOwner = wl.kind === 'personal' && wl.ownerUserId === session.user.id;

  const allRules = await apiServerGet<AlertRule[]>('/v1/alerts/rules');
  const rules = allRules.filter((r) => r.watchlistId === id);

  // ── Server actions ──────────────────────────────────────────────────
  async function addItemAction(entity: string) {
    'use server';
    await apiServerPost(`/v1/watchlists/${id}/items`, { entity });
    revalidatePath(`/watchlists/${id}`);
  }

  async function removeItemAction(entity: string) {
    'use server';
    await apiServerDelete(`/v1/watchlists/${id}/items/${encodeURIComponent(entity)}`);
    revalidatePath(`/watchlists/${id}`);
  }

  async function renameAction(formData: FormData) {
    'use server';
    const name = String(formData.get('name') ?? '').trim();
    if (!name) redirect(`/watchlists/${id}?error=${encodeURIComponent('Name cannot be empty')}` as Route);
    try {
      await apiServerPatch(`/v1/watchlists/${id}`, { name });
    } catch (err) {
      if (err instanceof Error && err.message.includes('NEXT_REDIRECT')) throw err;
      const msg = err instanceof Error ? err.message : 'unknown error';
      redirect(`/watchlists/${id}?error=${encodeURIComponent(msg)}` as Route);
    }
    redirect(`/watchlists/${id}?renamed=1` as Route);
  }

  async function deleteAction() {
    'use server';
    await apiServerDelete(`/v1/watchlists/${id}`);
    redirect('/watchlists' as Route);
  }

  async function toggleRuleAction(formData: FormData) {
    'use server';
    const ruleId = String(formData.get('ruleId') ?? '');
    const active = String(formData.get('active') ?? '') === 'true';
    await apiServerPatch(`/v1/alerts/rules/${ruleId}`, { active });
    revalidatePath(`/watchlists/${id}`);
  }

  async function deleteRuleAction(formData: FormData) {
    'use server';
    const ruleId = String(formData.get('ruleId') ?? '');
    await apiServerDelete(`/v1/alerts/rules/${ruleId}`);
    revalidatePath(`/watchlists/${id}`);
  }

  return (
    <div className="grid grid-cols-12 gap-x-10 gap-y-10">
      <header className="col-span-12 pb-2">
        <h1 className="font-display text-5xl tracking-editorial">{wl.name}</h1>
        {wl.description && wl.description !== wl.name ? (
          <p className="font-serif italic text-ink-700 mt-3">{wl.description}</p>
        ) : null}
        {isOwner ? (
          <div className="mt-5 max-w-sm">
            <form id="rename-form" action={renameAction}>
              <label htmlFor="name" className="eyebrow block mb-1">
                Rename
              </label>
              <input
                id="name"
                name="name"
                type="text"
                required
                maxLength={120}
                defaultValue={wl.name}
                className="block w-full bg-transparent border-0 border-b border-ink-300 focus:border-editorial focus:outline-none font-serif text-lg py-1 px-0"
              />
            </form>
            <div className="flex items-center gap-5 mt-3">
              <button
                type="submit"
                form="rename-form"
                className="font-sans text-eyebrow uppercase tracking-wider text-editorial hover:text-editorial-dark"
              >
                Save →
              </button>
              <span className="h-4 w-px bg-ink-100" aria-hidden />
              <form action={deleteAction}>
                <ConfirmSubmitButton
                  label="Delete →"
                  confirmLabel="Click again to delete →"
                  className="font-sans text-eyebrow uppercase tracking-wider text-editorial hover:text-editorial-dark"
                />
              </form>
            </div>
          </div>
        ) : null}
        {error ? <p className="font-serif italic text-editorial mt-3">{error}</p> : null}
        {renamed ? <p className="font-serif italic text-ink-500 mt-3">Renamed.</p> : null}
      </header>

      {/* ── Items ──────────────────────────────────────────────────── */}
      <section className="col-span-12 lg:col-span-8 min-w-0">
        {isOwner ? (
          <div className="mb-8">
            <AddItemSearch addAction={addItemAction} />
          </div>
        ) : null}

        {wl.items.length === 0 ? (
          <p className="font-serif italic text-ink-500 text-lg py-6">
            No items yet.{isOwner ? ' Search above to add one.' : ''}
          </p>
        ) : (
          <WatchlistItemsTable
            items={wl.items}
            isOwner={isOwner}
            removeAction={isOwner ? removeItemAction : undefined}
          />
        )}
      </section>

      {/* ── Alert rules rail ───────────────────────────────────────── */}
      <aside className="col-span-12 border-t border-ink-100 pt-8 lg:col-span-4 lg:border-l lg:pl-10 lg:border-t-0 lg:pt-0 self-start lg:sticky lg:top-12">
        <p className="eyebrow mb-4">Alert Rules</p>
        {rules.length === 0 ? (
          <p className="font-serif italic text-ink-500 text-sm mb-6">No rules on this watchlist yet.</p>
        ) : (
          <ul className="space-y-5 mb-6">
            {rules.map((r) => (
              <li key={r.id} className="border-b border-ink-100 pb-4">
                <p className="eyebrow mb-1">{r.ruleType.replace(/_/g, ' ')}</p>
                <p className="font-serif text-ink-900 text-sm mb-2">{r.summary}</p>
                <div className="flex items-center gap-4">
                  {isOwner ? (
                    <>
                      <form action={toggleRuleAction}>
                        <input type="hidden" name="ruleId" value={r.id} />
                        <input type="hidden" name="active" value={(!r.active).toString()} />
                        <button
                          type="submit"
                          className="font-sans text-eyebrow uppercase tracking-wider text-ink-700 hover:text-editorial"
                        >
                          {r.active ? 'Active' : 'Paused'}
                        </button>
                      </form>
                      <span className="h-3.5 w-px bg-ink-300" aria-hidden />
                      <form action={deleteRuleAction}>
                        <input type="hidden" name="ruleId" value={r.id} />
                        <button
                          type="submit"
                          className="font-sans text-eyebrow uppercase tracking-wider text-editorial hover:text-editorial-dark"
                        >
                          Delete
                        </button>
                      </form>
                    </>
                  ) : (
                    <span className="font-sans text-eyebrow uppercase tracking-wider text-ink-500">
                      {r.active ? 'Active' : 'Paused'}
                    </span>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
        {isOwner ? (
          <Link
            href={`/watchlists/${id}/rules/new` as Route}
            className="inline-block mt-2 font-sans text-eyebrow uppercase tracking-wider text-editorial hover:text-editorial-dark"
          >
            Add a Rule →
          </Link>
        ) : null}
      </aside>
    </div>
  );
}
