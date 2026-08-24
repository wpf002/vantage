import { redirect } from 'next/navigation';
import type { Route } from 'next';
import Link from 'next/link';
import { requestPasswordReset } from '@/lib/credentials';
import { sendPasswordResetEmail } from '@/lib/reset-email';

/**
 * /forgot-password — request a password reset link.
 *
 * Always shows "check your inbox" after submit regardless of whether the
 * email is registered, so the form can't be used to enumerate accounts.
 */

export default async function ForgotPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ sent?: string }>;
}) {
  const { sent } = await searchParams;

  async function submitForgot(formData: FormData) {
    'use server';
    const email = String(formData.get('email') ?? '').trim().toLowerCase();
    try {
      const token = await requestPasswordReset(email);
      if (token) {
        await sendPasswordResetEmail(email, token);
      }
    } catch {
      // Swallow all errors — same response regardless.
    }
    redirect('/forgot-password?sent=1' as Route);
  }

  if (sent) {
    return (
      <div className="min-h-full flex flex-col justify-center -my-10 lg:-my-12">
        <div className="grid grid-cols-12 gap-x-10 gap-y-10 py-10 lg:py-12">
          <header className="col-span-12 lg:col-span-8 border-b border-ink-100 pb-10">
            <p className="eyebrow mb-3">Password Reset</p>
            <h1 className="font-display text-5xl tracking-editorial">Check Your Inbox</h1>
          </header>
          <section className="col-span-12 lg:col-span-8 space-y-6">
            <p className="font-serif text-deck text-ink-800 max-w-measure leading-relaxed">
              If that email is registered, a reset link is on its way. The link expires in one hour.
            </p>
            <p className="font-sans text-sm text-ink-700">
              <Link href={'/signin' as Route} className="text-editorial hover:underline">
                Back to sign in
              </Link>
            </p>
          </section>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-full flex flex-col justify-center -my-10 lg:-my-12">
      <div className="grid grid-cols-12 gap-x-10 gap-y-10 py-10 lg:py-12">
        <header className="col-span-12 lg:col-span-8 border-b border-ink-100 pb-10">
          <p className="eyebrow mb-3">Password Reset</p>
          <h1 className="font-display text-5xl tracking-editorial">Forgot Your Password?</h1>
        </header>

        <section className="col-span-12 lg:col-span-8 space-y-8">
          <p className="font-serif text-deck text-ink-800 max-w-measure leading-relaxed">
            Enter your email address and we&apos;ll send you a link to reset your password.
          </p>

          <form action={submitForgot} className="space-y-8 max-w-measure">
            <div>
              <label htmlFor="email" className="eyebrow block mb-3">
                Email Address
              </label>
              <input
                id="email"
                name="email"
                type="email"
                required
                autoFocus
                autoComplete="email"
                className="block w-full bg-transparent border-0 border-b border-ink-300 focus:border-editorial focus:outline-none font-serif text-2xl py-3 px-0"
              />
            </div>

            <button
              type="submit"
              className="font-display text-xl text-editorial border-b-2 border-editorial hover:text-editorial-dark hover:border-editorial-dark transition-colors"
            >
              Send Reset Link →
            </button>
          </form>

          <p className="font-sans text-sm text-ink-700">
            <Link href={'/signin' as Route} className="text-editorial hover:underline">
              Back to sign in
            </Link>
          </p>
        </section>
      </div>
    </div>
  );
}
