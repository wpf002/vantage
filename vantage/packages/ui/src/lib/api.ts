const BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const resp = await fetch(`${BASE}${path}`, {
    ...init,
    headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) },
    cache: 'no-store',
  });
  if (!resp.ok) {
    const detail = await resp.text();
    throw new Error(`API ${resp.status}: ${detail}`);
  }
  return resp.json();
}

export const apiPost = <T,>(path: string, body: unknown) =>
  api<T>(path, { method: 'POST', body: JSON.stringify(body) });

export const apiGet = <T,>(path: string) => api<T>(path);
