import { pgTable, text, timestamp, uuid, integer, primaryKey, index } from 'drizzle-orm/pg-core';

/**
 * NextAuth / Drizzle adapter tables — duplicated from the api package.
 *
 *   Source of truth: packages/api/src/db/schema.ts
 *
 * The duplication is intentional. The UI's Auth.js DrizzleAdapter needs a
 * direct Drizzle connection to read/write these four tables, but importing
 * @vantage/api from a Next.js client/server bundle drags in Fastify, BullMQ,
 * and the rest of the API surface — which Next refuses to ship. Keeping the
 * adapter-required tables co-located here means the UI bundle stays clean.
 *
 * If you add a column on either side, mirror it on the other. The schema
 * shape MUST match what `@auth/drizzle-adapter` expects.
 */

export const users = pgTable(
  'users',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    email: text('email').notNull().unique(),
    emailVerified: timestamp('email_verified', { withTimezone: true }),
    name: text('name'),
    image: text('image'),
    // Mirrors packages/api/src/db/schema.ts. Credentials auth — bcrypt hash.
    passwordHash: text('password_hash'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    emailIdx: index('users_email_idx').on(t.email),
  }),
);

export const accounts = pgTable(
  'accounts',
  {
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    type: text('type').notNull(),
    provider: text('provider').notNull(),
    providerAccountId: text('provider_account_id').notNull(),
    refresh_token: text('refresh_token'),
    access_token: text('access_token'),
    expires_at: integer('expires_at'),
    token_type: text('token_type'),
    scope: text('scope'),
    id_token: text('id_token'),
    session_state: text('session_state'),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.provider, t.providerAccountId] }),
  }),
);

export const sessions = pgTable(
  'sessions',
  {
    sessionToken: text('session_token').primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    expires: timestamp('expires', { withTimezone: true }).notNull(),
  },
  (t) => ({
    userIdx: index('sessions_user_idx').on(t.userId),
    expiresIdx: index('sessions_expires_idx').on(t.expires),
  }),
);

export const verificationTokens = pgTable(
  'verification_tokens',
  {
    identifier: text('identifier').notNull(),
    token: text('token').notNull(),
    expires: timestamp('expires', { withTimezone: true }).notNull(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.identifier, t.token] }),
  }),
);
