import { redirect } from 'next/navigation';
import type { Route } from 'next';
import { eq } from 'drizzle-orm';
import { auth, signOut } from '@/lib/auth';
import { db, authSchema } from '@/lib/db';
import { formatDate } from '@/lib/format';

export default async function AccountPage() {
  const session = await auth();
  if (!session?.user?.id) {
    redirect('/signin?callbackUrl=/account' as Route);
  }

  const rows = await db
    .select({
      email: authSchema.users.email,
      name: authSchema.users.name,
      createdAt: authSchema.users.createdAt,
      lastSeenAt: authSchema.users.lastSeenAt,
    })
    .from(authSchema.users)
    .where(eq(authSchema.users.id, session.user.id))
    .limit(1);
  const u = rows[0];

  async function signOutAction() {
    'use server';
    await signOut({ redirectTo: '/' });
  }

  return (
    <div className="grid grid-cols-12 gap-x-10 gap-y-10">
      <header className="col-span-12 lg:col-span-8 border-b border-ink-100 pb-10">
        <p className="eyebrow mb-3">Account</p>
        <h1 className="font-display text-5xl tracking-editorial">Your Account</h1>
      </header>

      <section className="col-span-12 lg:col-span-8">
        <table className="editorial-table">
          <tbody>
            <tr>
              <td className="eyebrow w-1/3">Email</td>
              <td className="font-serif text-right">{u?.email ?? session.user.email}</td>
            </tr>
            <tr>
              <td className="eyebrow w-1/3">Account Created</td>
              <td className="num">{u ? formatDate(u.createdAt) : '—'}</td>
            </tr>
            <tr>
              <td className="eyebrow w-1/3">Last Signed In</td>
              <td className="num">{u ? formatDate(u.lastSeenAt) : '—'}</td>
            </tr>
          </tbody>
        </table>
      </section>

      <section className="col-span-12 lg:col-span-8">
        <form action={signOutAction}>
          <button
            type="submit"
            className="font-display text-xl text-editorial border-b-2 border-editorial hover:text-editorial-dark hover:border-editorial-dark transition-colors"
          >
            Sign Out &rarr;
          </button>
        </form>
      </section>
    </div>
  );
}
