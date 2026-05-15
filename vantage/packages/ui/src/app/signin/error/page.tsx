import Link from 'next/link';
import type { Route } from 'next';

export default function SignInErrorPage() {
  return (
    <div className="grid grid-cols-12 gap-x-10 gap-y-10">
      <header className="col-span-12 lg:col-span-8 border-b border-ink-100 pb-10">
        <p className="eyebrow mb-3">Sign In</p>
        <h1 className="font-display text-5xl tracking-editorial">Something Went Wrong</h1>
        <p className="font-serif text-deck text-ink-700 max-w-measure mt-6">
          Your session may have expired, or the request was malformed. Sign in again to continue.
        </p>
      </header>

      <section className="col-span-12">
        <Link
          href={'/signin' as Route}
          className="font-display text-xl text-editorial border-b-2 border-editorial hover:text-editorial-dark hover:border-editorial-dark transition-colors"
        >
          Back to Sign In →
        </Link>
      </section>
    </div>
  );
}
