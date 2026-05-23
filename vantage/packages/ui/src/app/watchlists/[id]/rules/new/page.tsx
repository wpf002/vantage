import type { Route } from 'next';
import { redirect } from 'next/navigation';
import { auth } from '@/lib/auth';
import { apiServerGetNullable, apiServerPost } from '@/lib/api-server';
import type { AlertRuleType, WatchlistDetail } from '@/lib/watchlists';
import { RuleForm } from './RuleForm';

/**
 * Phase 10 — create an alert rule for a watchlist. The form reads as a
 * sentence (see RuleForm); this server component owns auth + the submit action.
 */

export default async function NewRulePage({ params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  const { id } = await params;
  if (!session?.user?.id) {
    redirect(`/signin?callbackUrl=/watchlists/${id}/rules/new` as Route);
  }

  const wl = await apiServerGetNullable<WatchlistDetail>(`/v1/watchlists/${id}`);
  if (!wl || wl.kind === 'system' || wl.ownerUserId !== session.user.id) {
    return (
      <div className="max-w-measure">
        <p className="eyebrow mb-3">Alert Rule</p>
        <p className="font-serif italic text-ink-500 text-lg">
          You can only add rules to your own watchlists.
        </p>
      </div>
    );
  }

  async function createRuleAction(input: {
    watchlistId: string;
    ruleType: AlertRuleType;
    config: Record<string, unknown>;
    channels: { web: boolean; email: boolean };
  }): Promise<{ ok: boolean; error?: string }> {
    'use server';
    try {
      await apiServerPost('/v1/alerts/rules', input);
      return { ok: true };
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'unknown error';
      return { ok: false, error: msg };
    }
  }

  return (
    <div className="grid grid-cols-12 gap-x-10 gap-y-10">
      <header className="col-span-12 border-b border-ink-100 pb-8">
        <h1 className="font-display text-5xl tracking-editorial">Write a Rule</h1>
      </header>
      <RuleForm watchlistId={id} createAction={createRuleAction} />
    </div>
  );
}
