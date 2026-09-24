import { useEffect, useMemo, useState } from "react";
import { resolveScope } from "@/api/scopes";
import type { ScopeKey } from "@/api/scopes";
import { scopeKeyFromText, scopeKeyText, type ScopeKeyText } from "@/utils/scope-key";
import type { ScopeInterval } from "@/utils/scope-interval";
import type { ScopeWindows } from "@/utils/plan-triage";

/**
 * A scope is a pure function of its key, so a resolved window can be cached for the life of the
 * session and shared by every task that references that scope. A planning pass reads a few dozen
 * distinct scopes across a whole board, and re-resolving them on every step through the calendar
 * would be the same answer fetched again.
 */
const cache = new Map<ScopeKeyText, Promise<ScopeInterval>>();

function resolveCached(id: ScopeKey): Promise<ScopeInterval> {
  const text = scopeKeyText(id);
  const hit = cache.get(text);
  if (hit !== undefined) return hit;
  const pending = resolveScope(id).then((resolved) => ({ start: resolved.start, end: resolved.end }));
  // A rejection must not be cached: a scope that could not be resolved once — a transient IPC
  // failure — would otherwise stay unreadable for the rest of the session.
  cache.set(text, pending.catch((error: unknown) => { cache.delete(text); throw error; }));
  return pending;
}

/** Discards every cached window. Test-only; nothing in the app invalidates an immutable scope. */
export function clearScopeWindowCache(): void {
  cache.clear();
}

/**
 * Resolves each of `ids` to its `[start, end)` window, as the backend resolves it.
 *
 * The backend stays the authority on what a scope's window *is* — bands, week starts and the
 * exact-scope endpoints all live there — and this only carries the answers forward so the Plan
 * View's partition can stay pure and synchronous.
 *
 * A scope that fails to resolve is simply **absent** from the result rather than fabricated: every
 * reader treats a missing window as "not known yet", which leaves the task out of both panes
 * instead of putting it in the wrong one.
 */
export function useScopeWindows(ids: readonly ScopeKey[]): ScopeWindows {
  // The caller rebuilds its id list every render; the sorted canonical texts are what actually
  // changed, so the effect below re-runs when the *set* does and not when the array identity does.
  // A key's text holds no newline, so one separates them.
  const key = useMemo(() => [...new Set(ids.map(scopeKeyText))].sort().join("\n"), [ids]);
  const [windows, setWindows] = useState<ScopeWindows>(new Map());

  useEffect(() => {
    let active = true;
    const wanted = key === "" ? [] : key.split("\n");
    const entries: Array<[ScopeKeyText, ScopeInterval]> = [];
    void Promise.all(
      wanted.map(async (text) => {
        const id = scopeKeyFromText(text);
        if (id === null) return;
        try {
          entries.push([text, await resolveCached(id)]);
        } catch {
          // Left out on purpose — see the doc comment.
        }
      }),
    ).then(() => {
      if (active) setWindows(new Map(entries));
    });
    return () => {
      active = false;
    };
  }, [key]);

  return windows;
}
