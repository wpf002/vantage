import { redirect } from 'next/navigation';
import type { Route } from 'next';
import { eq } from 'drizzle-orm';
import { auth } from '@/lib/auth';
import { db, authSchema } from '@/lib/db';
import { formatDate } from '@/lib/format';

export default async function SettingsPage() {
  const session = await auth();
  if (!session?.user?.id) {
    redirect('/signin?callbackUrl=/settings' as Route);
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

  return (
    <div className="grid grid-cols-12 gap-x-10 gap-y-10">
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
    </div>
  );
}
