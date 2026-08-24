import { redirect } from 'next/navigation';
import type { Route } from 'next';
import Link from 'next/link';
import {
  CredentialsError,
  createAccountWithPassword,
  signInWithPassword,
} from '@/lib/credentials';
import { auth } from '@/lib/auth';

/**
 * Sign-in / Create Account.
 *
 * Single page, two modes — toggled via the `mode` query param. Both submit
 * to the same server action; the action branches on `mode` and dispatches
 * to credentials.ts which writes a session row and sets the cookie.
 *
 * Already-signed-in users get bounced to `callbackUrl` (or /) so refreshing
 * /signin while logged in does the right thing.
 */

interface PageProps {
  searchParams: Promise<{ mode?: string; callbackUrl?: string; error?: string }>;
}

export default async function SignInPage({ searchParams }: PageProps) {
  const { mode, callbackUrl, error } = await searchParams;
  const isCreate = mode === 'create';

  const session = await auth();
  if (session?.user?.id) {
    redirect((callbackUrl ?? '/') as Route);
  }

  async function submitCredentials(formData: FormData) {
    'use server';
    const submittedMode = String(formData.get('mode') ?? 'signin');
    const email = String(formData.get('email') ?? '');
    const password = String(formData.get('password') ?? '');
    const redirectTo = String(formData.get('callbackUrl') ?? '/');

    try {
      if (submittedMode === 'create') {
        await createAccountWithPassword(email, password);
      } else {
        await signInWithPassword(email, password);
      }
    } catch (err) {
      // CredentialsError is the only expected throw — everything else is a
      // server bug and should crash the action so it lands in the error
      // boundary rather than silently silently misreporting "wrong password".
      if (err instanceof CredentialsError) {
        const qs = new URLSearchParams({
          mode: submittedMode,
          error: err.message,
        });
        if (redirectTo && redirectTo !== '/') qs.set('callbackUrl', redirectTo);
        redirect(`/signin?${qs.toString()}` as Route);
      }
      throw err;
    }

    redirect(redirectTo as Route);
  }

  const otherMode = isCreate ? 'signin' : 'create';
  const otherModeHref =
    `/signin?mode=${otherMode}${callbackUrl ? `&callbackUrl=${encodeURIComponent(callbackUrl)}` : ''}` as Route;

  return (
    <div className="min-h-full flex flex-col justify-center -my-10 lg:-my-12">
      <div className="grid grid-cols-12 gap-x-10 gap-y-10 py-10 lg:py-12">
      <header className="col-span-12 lg:col-span-8 border-b border-ink-100 pb-10">
        <p className="eyebrow mb-3">{isCreate ? 'Create Account' : 'Sign In'}</p>
        <h1 className="font-display text-5xl tracking-editorial">
          {isCreate ? 'Create Your Vantage Account' : 'Welcome to Vantage'}
        </h1>
      </header>

      <section className="col-span-12 lg:col-span-8">
        {error ? (
          <p className="font-serif italic text-editorial mb-6">{error}</p>
        ) : null}

        <form action={submitCredentials} className="space-y-8 max-w-measure">
          <input type="hidden" name="mode" value={isCreate ? 'create' : 'signin'} />
          <input type="hidden" name="callbackUrl" value={callbackUrl ?? '/'} />

          <div>
            <label htmlFor="email" className="eyebrow block mb-3">
              Email Address
            </label>
            <input
              id="email"
              name="email"
              type="email"
              required
              autoComplete="email"
              autoFocus
              className="block w-full bg-transparent border-0 border-b border-ink-300 focus:border-editorial focus:outline-none font-serif text-2xl py-3 px-0"
            />
          </div>

          <div>
            <label htmlFor="password" className="eyebrow block mb-3">
              Password
            </label>
            <input
              id="password"
              name="password"
              type="password"
              required
              minLength={8}
              autoComplete={isCreate ? 'new-password' : 'current-password'}
              className="block w-full bg-transparent border-0 border-b border-ink-300 focus:border-editorial focus:outline-none font-serif text-2xl py-3 px-0"
            />
            {isCreate ? (
              <p className="font-sans text-xs text-ink-500 mt-2">At least 8 characters.</p>
            ) : null}
          </div>

          <button
            type="submit"
            className="font-display text-xl text-editorial border-b-2 border-editorial hover:text-editorial-dark hover:border-editorial-dark transition-colors"
          >
            {isCreate ? 'Create Account →' : 'Sign In →'}
          </button>
        </form>

        <div className="font-sans text-sm text-ink-700 mt-12 space-y-3">
          <p>
            {isCreate ? 'Already have an account? ' : 'New to Vantage? '}
            <Link href={otherModeHref} className="text-editorial hover:underline">
              {isCreate ? 'Sign in' : 'Create an account'}
            </Link>
          </p>
          {!isCreate && (
            <p>
              <Link href={'/forgot-password' as Route} className="text-ink-500 hover:text-editorial hover:underline">
                Forgot your password?
              </Link>
            </p>
          )}
          {process.env.NEXT_PUBLIC_DEMO_EMAIL && !isCreate && (
            <p className="pt-4 border-t border-ink-100">
              <span className="text-ink-500">Demo account: </span>
              <span className="font-mono text-ink-700">{process.env.NEXT_PUBLIC_DEMO_EMAIL}</span>
              {process.env.NEXT_PUBLIC_DEMO_PASSWORD && (
                <> / <span className="font-mono text-ink-700">{process.env.NEXT_PUBLIC_DEMO_PASSWORD}</span></>
              )}
            </p>
          )}
        </div>
      </section>

      </div>
    </div>
  );
}
