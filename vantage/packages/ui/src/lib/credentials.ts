import { randomBytes } from 'crypto';
import { cookies } from 'next/headers';
import { eq } from 'drizzle-orm';
import bcrypt from 'bcryptjs';
import { db, authSchema } from './db';

/**
 * Hand-rolled credentials auth.
 *
 * NextAuth v5's Credentials provider can't coexist with database-backed
 * sessions — it forces JWT. We want revocable, server-side sessions for the
 * whole platform, so this module bypasses NextAuth's provider machinery and
 * writes directly into the `sessions` table that the DrizzleAdapter already
 * owns. The cookie name + table shape stay identical, so `auth()` still
 * reads the session through NextAuth, and the API gateway's session
 * middleware works without changes.
 *
 * Surface:
 *   - createAccountWithPassword(email, password) → starts a session
 *   - signInWithPassword(email, password)        → starts a session
 *   - destroyCurrentSession()                    → invalidates + clears cookie
 */

const SESSION_COOKIE_NAME = 'authjs.session-token';
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const BCRYPT_COST = 10;
const PASSWORD_MIN = 8;

export class CredentialsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CredentialsError';
  }
}

function validateEmail(raw: string): string {
  const email = raw.trim().toLowerCase();
  // Permissive — rely on the email link / actual login attempt to surface
  // typos rather than reject anything unusual at this layer.
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new CredentialsError('That email address doesn’t look right.');
  }
  return email;
}

function validatePassword(raw: string): string {
  if (typeof raw !== 'string' || raw.length < PASSWORD_MIN) {
    throw new CredentialsError(`Password must be at least ${PASSWORD_MIN} characters.`);
  }
  if (raw.length > 200) {
    throw new CredentialsError('Password is too long.');
  }
  return raw;
}

async function startSession(userId: string): Promise<void> {
  const token = randomBytes(32).toString('hex');
  const expires = new Date(Date.now() + SESSION_TTL_MS);
  await db.insert(authSchema.sessions).values({
    sessionToken: token,
    userId,
    expires,
  });
  const c = await cookies();
  c.set(SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    expires,
    secure: process.env.NODE_ENV === 'production',
  });
}

export async function createAccountWithPassword(
  emailRaw: string,
  passwordRaw: string,
): Promise<{ userId: string }> {
  const email = validateEmail(emailRaw);
  const password = validatePassword(passwordRaw);

  const existing = await db
    .select({ id: authSchema.users.id })
    .from(authSchema.users)
    .where(eq(authSchema.users.email, email))
    .limit(1);
  if (existing.length > 0) {
    throw new CredentialsError('An account with that email already exists. Sign in instead.');
  }

  const passwordHash = await bcrypt.hash(password, BCRYPT_COST);
  const [row] = await db
    .insert(authSchema.users)
    .values({ email, passwordHash })
    .returning({ id: authSchema.users.id });
  const userId = row!.id;

  await startSession(userId);
  return { userId };
}

export async function signInWithPassword(
  emailRaw: string,
  passwordRaw: string,
): Promise<{ userId: string }> {
  const email = validateEmail(emailRaw);
  if (typeof passwordRaw !== 'string' || passwordRaw.length === 0) {
    throw new CredentialsError('Wrong email or password.');
  }

  const rows = await db
    .select({ id: authSchema.users.id, passwordHash: authSchema.users.passwordHash })
    .from(authSchema.users)
    .where(eq(authSchema.users.email, email))
    .limit(1);

  // Constant-ish failure path — same error regardless of whether the email
  // exists or the hash mismatched, so the form can't be used to enumerate
  // accounts. We still spend a bcrypt cycle on a dummy hash to keep the
  // timing roughly consistent.
  if (rows.length === 0 || !rows[0]!.passwordHash) {
    await bcrypt.compare(passwordRaw, '$2a$10$invalidsaltinvalidsaltinvalidsaltinvalidsa');
    throw new CredentialsError('Wrong email or password.');
  }

  const ok = await bcrypt.compare(passwordRaw, rows[0]!.passwordHash);
  if (!ok) throw new CredentialsError('Wrong email or password.');

  const userId = rows[0]!.id;
  // Refresh last-seen so /settings stays accurate after a fresh sign-in.
  await db
    .update(authSchema.users)
    .set({ lastSeenAt: new Date() })
    .where(eq(authSchema.users.id, userId));

  await startSession(userId);
  return { userId };
}

export async function destroyCurrentSession(): Promise<void> {
  const c = await cookies();
  const token = c.get(SESSION_COOKIE_NAME)?.value;
  if (token) {
    await db.delete(authSchema.sessions).where(eq(authSchema.sessions.sessionToken, token));
    c.delete(SESSION_COOKIE_NAME);
  }
}

// ── Password reset ─────────────────────────────────────────────────────────

const RESET_TTL_MS = 60 * 60 * 1000; // 1 hour

/**
 * Issue a password-reset token for the given email and return it.
 * Silently succeeds even if no account exists (no enumeration).
 * Returns the token so the caller can email it.
 */
export async function requestPasswordReset(emailRaw: string): Promise<string | null> {
  const email = validateEmail(emailRaw);

  const rows = await db
    .select({ id: authSchema.users.id })
    .from(authSchema.users)
    .where(eq(authSchema.users.email, email))
    .limit(1);

  // No account — return null silently; caller shows the same "check your inbox"
  // message regardless so we don't reveal whether the email is registered.
  if (rows.length === 0) return null;

  // Invalidate any existing token for this email, then insert a fresh one.
  await db
    .delete(authSchema.verificationTokens)
    .where(eq(authSchema.verificationTokens.identifier, email));

  const token = randomBytes(32).toString('hex');
  const expires = new Date(Date.now() + RESET_TTL_MS);
  await db.insert(authSchema.verificationTokens).values({ identifier: email, token, expires });

  return token;
}

/**
 * Validate a reset token and update the user's password.
 * Starts a session on success. Throws CredentialsError on invalid/expired token.
 */
export async function resetPassword(
  emailRaw: string,
  token: string,
  newPasswordRaw: string,
): Promise<void> {
  const email = validateEmail(emailRaw);
  const newPassword = validatePassword(newPasswordRaw);

  const rows = await db
    .select()
    .from(authSchema.verificationTokens)
    .where(eq(authSchema.verificationTokens.identifier, email))
    .limit(1);

  const row = rows[0];
  if (!row || row.token !== token || row.expires < new Date()) {
    throw new CredentialsError('This reset link is invalid or has expired. Request a new one.');
  }

  // Hash the new password and update the user.
  const passwordHash = await bcrypt.hash(newPassword, BCRYPT_COST);
  const updated = await db
    .update(authSchema.users)
    .set({ passwordHash })
    .where(eq(authSchema.users.email, email))
    .returning({ id: authSchema.users.id });

  if (updated.length === 0) {
    throw new CredentialsError('Account not found.');
  }

  // Consume the token (one-time use).
  await db
    .delete(authSchema.verificationTokens)
    .where(eq(authSchema.verificationTokens.identifier, email));

  await startSession(updated[0]!.id);
}
