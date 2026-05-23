'use client';

import { useState, useRef } from 'react';
import { apiGet } from '@/lib/api';

/**
 * Phase 10 — add-item search box. Autocompletes against /v1/search; selecting a
 * result (or typing a ticker) submits the bound server action with the entity.
 */

interface SearchMatch {
  type: string;
  id: string;
  name: string;
  ticker: string | null;
}
type SearchResponse =
  | { kind: 'exact'; match: SearchMatch }
  | { kind: 'name_matches'; matches: SearchMatch[] }
  | { kind: 'public_unknown'; suggestion: { ticker: string; name: string } }
  | { kind: 'no_match' };

export function AddItemSearch({
  addAction,
}: {
  addAction: (entity: string) => Promise<void>;
}) {
  const [query, setQuery] = useState('');
  const [matches, setMatches] = useState<SearchMatch[]>([]);
  const [busy, setBusy] = useState(false);
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  function onChange(v: string) {
    setQuery(v);
    if (debounce.current) clearTimeout(debounce.current);
    if (v.trim().length < 1) {
      setMatches([]);
      return;
    }
    debounce.current = setTimeout(async () => {
      try {
        const res = await apiGet<SearchResponse>(`/v1/search?q=${encodeURIComponent(v.trim())}`);
        if (res.kind === 'name_matches') setMatches(res.matches.slice(0, 8));
        else if (res.kind === 'exact') setMatches([res.match]);
        else if (res.kind === 'public_unknown')
          setMatches([
            { type: 'public', id: res.suggestion.ticker, name: res.suggestion.name, ticker: res.suggestion.ticker },
          ]);
        else setMatches([]);
      } catch {
        setMatches([]);
      }
    }, 200);
  }

  async function add(entity: string) {
    setBusy(true);
    try {
      await addAction(entity.toUpperCase());
      setQuery('');
      setMatches([]);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="relative">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (query.trim()) void add(query.trim());
        }}
        className="flex border-b-2 border-ink-900 pb-2"
      >
        <input
          type="text"
          value={query}
          onChange={(e) => onChange(e.target.value)}
          placeholder="Add a ticker or company…"
          disabled={busy}
          className="flex-1 min-w-0 bg-transparent font-sans text-lg placeholder:text-ink-300 focus:outline-none"
        />
        <button
          type="submit"
          disabled={busy || !query.trim()}
          className="font-sans text-sm uppercase tracking-wider text-ink-900 hover:text-editorial disabled:text-ink-300"
        >
          Add →
        </button>
      </form>
      {matches.length > 0 ? (
        <ul className="absolute z-10 left-0 right-0 bg-cream-50 border border-ink-100 mt-1 shadow-sm">
          {matches.map((m) => (
            <li key={`${m.type}-${m.id}`}>
              <button
                type="button"
                onClick={() => void add(m.ticker ?? m.id)}
                className="w-full text-left px-3 py-2 hover:bg-cream-200 flex items-baseline justify-between gap-3"
              >
                <span className="font-serif text-ink-900">{m.name}</span>
                <span className="font-mono text-xs text-ink-500 uppercase">{m.ticker ?? m.id}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
