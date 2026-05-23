import Link from 'next/link';
import type { Route } from 'next';
import { redirect } from 'next/navigation';
import { auth } from '@/lib/auth';
import { PushControls } from './PushControls';

/**
 * Phase 10 — notification settings. Browser push enable/disable + test, and a
 * read-only view of the email alerts go to.
 */

export default async function NotificationSettingsPage() {
  const session = await auth();
  if (!session?.user?.id) {
    redirect('/signin?callbackUrl=/settings/notifications' as Route);
  }

  return (
    <div className="grid grid-cols-12 gap-x-10 gap-y-12">
      <header className="col-span-12 border-b border-ink-100 pb-8">
        <p className="eyebrow mb-3">Settings · Notifications</p>
        <h1 className="font-display text-5xl tracking-editorial">How You Hear From Us</h1>
      </header>

      <section className="col-span-12 lg:col-span-7 space-y-12">
        <div>
          <p className="eyebrow mb-4">Browser Notifications</p>
          <PushControls />
        </div>

        <div className="border-t border-ink-100 pt-10">
          <p className="eyebrow mb-4">Email Notifications</p>
          <p className="font-serif text-lg text-ink-900">
            We&apos;ll send alerts to{' '}
            <span className="font-mono text-base">{session.user.email}</span>.
          </p>
          <p className="font-serif text-ink-700 mt-1">
            Update it on the{' '}
            <Link href={'/settings' as Route} className="text-editorial hover:underline">
              Account page
            </Link>
            .
          </p>
        </div>
      </section>
    </div>
  );
}
