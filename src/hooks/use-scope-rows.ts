import { useEffect, useMemo, useState } from "react";
import { getScope } from "@/api/scopes";
import type { Scope, ScopeKey } from "@/api/scopes";
import { scopeKeyFromText, scopeKeyText, type ScopeKeyText } from "@/utils/scope-key";

/**
 * A scope is a pure function of its key, so one read serves the session. Shared with nothing else:
 * `use-scope-windows` caches the *resolved window* of a scope, which answers a different question.
 */
const cache = new Map<ScopeKeyText, Promise<Scope>>();

function readCached(id: ScopeKey): Promise<Scope> {
  const text = scopeKeyText(id);
  const hit = cache.get(text);
  if (hit !== undefined) return hit;
  const pending = getScope(id);
  // A rejection must not be cached, or one transient failure makes a scope unreadable all session.
  cache.set(text, pending.catch((error: unknown) => { cache.delete(text); throw error; }));
  return pending;
}

/** Discards every cached row. Test-only; nothing in the app invalidates an immutable scope. */
export function clearScopeRowCache(): void {
  cache.clear();
}

/**
 * Reads each of `ids` back as its scope **row** — the calendar cell it names, as dates.
 *
 * The Plan View already resolves the same ids to `[start, end)` windows for its triage. This is
 * not that: a window is an instant pair, and which *week* a plan sits in is a question about
 * calendar cells, which the row answers in `start_date`/`end_date` without anyone having to decide
 * what instant a day begins at.
 *
 * A row that fails to read is simply **absent**, never fabricated — the caller treats a missing
 * row as "not known yet" and shows the task in its catch-all rather than filing it under a guess.
 */
export function useScopeRows(ids: readonly ScopeKey[]): ReadonlyMap<ScopeKeyText, Scope> {
  // The caller rebuilds its id list every render; the sorted canonical texts are what actually
  // changed. A key's text holds no newline, so one separates them.
  const key = useMemo(() => [...new Set(ids.map(scopeKeyText))].sort().join("\n"), [ids]);
  const [rows, setRows] = useState<ReadonlyMap<ScopeKeyText, Scope>>(new Map());

  useEffect(() => {
    let active = true;
    const wanted = key === "" ? [] : key.split("\n");
    const entries: Array<[ScopeKeyText, Scope]> = [];
    void Promise.all(
      wanted.map((text) => {
        const id = scopeKeyFromText(text);
        if (id === null) return Promise.resolve();
        return readCached(id).then(
          (scope) => { entries.push([text, scope]); },
          () => { /* absent, not fabricated */ },
        );
      }),
    ).then(() => {
      if (active) setRows(new Map(entries));
    });
    return () => { active = false; };
  }, [key]);

  return rows;
}
