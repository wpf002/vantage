import NextAuth from 'next-auth';
import type { NextAuthConfig, NextAuthResult } from 'next-auth';
import { DrizzleAdapter } from '@auth/drizzle-adapter';
import { db, authSchema } from './db';

/**
 * NextAuth v5 — session-reader only.
 *
 * Phase 5.1: the platform uses email + password credentials, which NextAuth
 * v5 can't drive on top of database sessions (its Credentials provider
 * forces JWT). So we hand-roll credential auth in `lib/credentials.ts` — it
 * writes directly into the same `sessions` table that the DrizzleAdapter
 * owns, and sets a cookie with the same name NextAuth would.
 *
 * NextAuth still does three useful things here:
 *   1. `auth()` reads our cookie + sessions table on every server render
 *   2. `signOut()` clears the cookie + deletes the session row
 *   3. The catch-all /api/auth route satisfies CSRF expectations for any
 *      future OAuth provider we plug in
 *
 * `providers: []` is the documented escape hatch — NextAuth doesn't require
 * a provider when the only consumer is `auth()`. Adding OAuth (Google,
 * GitHub, ...) later is a one-line addition.
 */

export const authConfig: NextAuthConfig = {
  adapter: DrizzleAdapter(db, {
    usersTable: authSchema.users,
    accountsTable: authSchema.accounts,
    sessionsTable: authSchema.sessions,
    verificationTokensTable: authSchema.verificationTokens,
  }),
  session: { strategy: 'database' },
  // Behind Railway's HTTPS proxy, Auth.js's default cookie name becomes
  // `__Secure-authjs.session-token`, but the hand-rolled startSession() in
  // credentials.ts writes `authjs.session-token`. Pinning the name here keeps
  // both sides in sync across dev (HTTP) and prod (HTTPS).
  cookies: {
    sessionToken: {
      name: 'authjs.session-token',
      options: {
        httpOnly: true,
        sameSite: 'lax',
        path: '/',
        secure: process.env.NODE_ENV === 'production',
      },
    },
  },
  // Required when Next.js sits behind a reverse proxy (Railway, Vercel, etc.)
  // so Auth.js trusts the X-Forwarded-Host header.
  trustHost: true,
  pages: {
    signIn: '/signin',
    error: '/signin/error',
  },
  providers: [],
  callbacks: {
    async session({ session, user }) {
      if (session.user && user) {
        session.user.id = user.id;
      }
      return session;
    },
  },
};

// Explicit annotations sidestep TS2742 / TS2883 — NextAuth v5's inferred
// return types reference private files inside the next-auth package that
// TypeScript can't reach through pnpm's hoisted module layout.
const nextAuth = NextAuth(authConfig);
export const handlers: NextAuthResult['handlers'] = nextAuth.handlers;
export const auth: NextAuthResult['auth'] = nextAuth.auth;
export const signIn: NextAuthResult['signIn'] = nextAuth.signIn;
export const signOut: NextAuthResult['signOut'] = nextAuth.signOut;
