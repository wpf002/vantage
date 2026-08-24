import { redirect } from 'next/navigation';
import type { Route } from 'next';
import Link from 'next/link';
import { CredentialsError, resetPassword } from '@/lib/credentials';

/**
 * /reset-password?token=T&email=E — set a new password via a reset link.
 *
 * Token and email come from the URL. The form collects the new password,
 * then the server action validates and applies the reset.
 */

interface PageProps {
  searchParams: Promise<{ token?: string; email?: string; error?: string }>;
}

export default async function ResetPasswordPage({ searchParams }: PageProps) {
  const { token, email, error } = await searchParams;

  // Missing token/email — show a helpful error rather than a broken form.
  if (!token || !email) {
    return (
      <div className="min-h-full flex flex-col justify-center -my-10 lg:-my-12">
        <div className="grid grid-cols-12 gap-x-10 gap-y-10 py-10 lg:py-12">
          <header className="col-span-12 lg:col-span-8 border-b border-ink-100 pb-10">
            <p className="eyebrow mb-3">Password Reset</p>
            <h1 className="font-display text-5xl tracking-editorial">Invalid Reset Link</h1>
          </header>
          <section className="col-span-12 lg:col-span-8 space-y-6">
            <p className="font-serif text-deck text-ink-800 max-w-measure leading-relaxed">
              This reset link is missing required parameters. Please request a new one.
            </p>
            <p className="font-sans text-sm">
              <Link href={'/forgot-password' as Route} className="text-editorial hover:underline">
                Request a new reset link
              </Link>
            </p>
          </section>
        </div>
      </div>
    );
  }

  async function submitReset(formData: FormData) {
    'use server';
    const t = String(formData.get('token') ?? '');
    const e = String(formData.get('email') ?? '');
    const newPassword = String(formData.get('password') ?? '');

    try {
      await resetPassword(e, t, newPassword);
    } catch (err) {
      if (err instanceof CredentialsError) {
        const qs = new URLSearchParams({ token: t, email: e, error: err.message });
        redirect(`/reset-password?${qs.toString()}` as Route);
      }
      throw err;
    }

    redirect('/' as Route);
  }

  return (
    <div className="min-h-full flex flex-col justify-center -my-10 lg:-my-12">
      <div className="grid grid-cols-12 gap-x-10 gap-y-10 py-10 lg:py-12">
        <header className="col-span-12 lg:col-span-8 border-b border-ink-100 pb-10">
          <p className="eyebrow mb-3">Password Reset</p>
          <h1 className="font-display text-5xl tracking-editorial">Set a New Password</h1>
        </header>

        <section className="col-span-12 lg:col-span-8 space-y-8">
          {error && (
            <p className="font-serif italic text-editorial">{error}</p>
          )}

          <form action={submitReset} className="space-y-8 max-w-measure">
            <input type="hidden" name="token" value={token} />
            <input type="hidden" name="email" value={email} />

            <div>
              <label htmlFor="password" className="eyebrow block mb-3">
                New Password
              </label>
              <input
                id="password"
                name="password"
                type="password"
                required
                minLength={8}
                autoFocus
                autoComplete="new-password"
                className="block w-full bg-transparent border-0 border-b border-ink-300 focus:border-editorial focus:outline-none font-serif text-2xl py-3 px-0"
              />
              <p className="font-sans text-xs text-ink-500 mt-2">At least 8 characters.</p>
            </div>

            <button
              type="submit"
              className="font-display text-xl text-editorial border-b-2 border-editorial hover:text-editorial-dark hover:border-editorial-dark transition-colors"
            >
              Set New Password →
            </button>
          </form>
        </section>
      </div>
    </div>
  );
}
