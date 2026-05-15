/**
 * Format a date as MM/DD/YY. Accepts an ISO string (date or full timestamp),
 * a date-ish string, or a Date. Date-only strings are formatted verbatim to
 * avoid timezone shifting.
 */
export function formatDate(input: string | Date): string {
  if (typeof input === 'string') {
    const m = input.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (m) return `${m[2]}/${m[3]}/${m[1]!.slice(2)}`;
  }
  const d = input instanceof Date ? input : new Date(input);
  if (Number.isNaN(d.getTime())) return String(input);
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  const yy = String(d.getFullYear()).slice(-2);
  return `${mm}/${dd}/${yy}`;
}
