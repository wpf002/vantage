'use server';

import { auth } from '@/lib/auth';
import { isAdminEmail } from '@/lib/admin';
import { apiServerPost } from '@/lib/api-server';

/**
 * Trigger the outcome backfill out-of-band. Re-checks admin server-side (a
 * server action is a public endpoint) before enqueuing. Returns the job id so
 * the caller can show a confirmation.
 */
export async function triggerBackfill(): Promise<{ jobId: string | null }> {
  const session = await auth();
  if (!isAdminEmail(session?.user?.email)) {
    throw new Error('forbidden');
  }
  const res = await apiServerPost<{ jobId: string | null; status: string }>('/v1/meta/backfill');
  return { jobId: res.jobId };
}
