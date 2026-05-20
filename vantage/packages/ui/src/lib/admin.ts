/**
 * Admin gate for the /meta surface. Mirrors the API's ADMIN_EMAIL guard
 * (server-side env, never exposed to the client). Used both to hide the Meta
 * nav link and to notFound() the page itself for non-admins — the page should
 * not appear to exist rather than 403.
 */
export function isAdminEmail(email?: string | null): boolean {
  const admin = process.env.ADMIN_EMAIL;
  return !!admin && !!email && email.toLowerCase() === admin.toLowerCase();
}
