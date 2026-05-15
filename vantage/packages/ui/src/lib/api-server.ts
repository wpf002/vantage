import { cookies } from 'next/headers';

/**
 * Server-only API helpers that forward the incoming session cookie from the
 * UI's request context to the API gateway. Use these in server components
 * and server actions for any /v1/portfolios route that requires auth.
 */

const BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

async function cookieHeader(): Promise<string> {
  const c = await cookies();
  return c
    .getAll()
    .map((ck) => `${ck.name}=${ck.value}`)
    .join('; ');
}

export async function apiServerGet<T>(path: string): Promise<T> {
  const ck = await cookieHeader();
  const resp = await fetch(`${BASE}${path}`, {
    headers: ck ? { cookie: ck } : {},
    cache: 'no-store',
  });
  if (!resp.ok) {
    const detail = await resp.text();
    throw new Error(`API ${resp.status}: ${detail}`);
  }
  return resp.json() as Promise<T>;
}

/**
 * GET that returns null on 404 — for "fetch if exists" patterns where the
 * caller prefers to render an empty state rather than throw.
 */
export async function apiServerGetNullable<T>(path: string): Promise<T | null> {
  const ck = await cookieHeader();
  const resp = await fetch(`${BASE}${path}`, {
    headers: ck ? { cookie: ck } : {},
    cache: 'no-store',
  });
  if (resp.status === 404) return null;
  if (!resp.ok) {
    const detail = await resp.text();
    throw new Error(`API ${resp.status}: ${detail}`);
  }
  return resp.json() as Promise<T>;
}

export async function apiServerPost<T>(path: string, body?: unknown): Promise<T> {
  const ck = await cookieHeader();
  // Only attach a content-type when there's a body — Fastify rejects empty
  // bodies on requests declared as application/json. Bodyless POSTs (e.g.
  // /rebalance, /unpublish) shouldn't carry the header at all.
  const headers: Record<string, string> = {};
  if (body !== undefined) headers['content-type'] = 'application/json';
  if (ck) headers.cookie = ck;
  const resp = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
    cache: 'no-store',
  });
  if (!resp.ok) {
    const detail = await resp.text();
    throw new Error(`API ${resp.status}: ${detail}`);
  }
  return resp.json() as Promise<T>;
}

export async function apiServerDelete<T>(path: string): Promise<T> {
  const ck = await cookieHeader();
  const resp = await fetch(`${BASE}${path}`, {
    method: 'DELETE',
    headers: ck ? { cookie: ck } : {},
    cache: 'no-store',
  });
  if (!resp.ok) {
    const detail = await resp.text();
    throw new Error(`API ${resp.status}: ${detail}`);
  }
  return resp.json() as Promise<T>;
}
