/**
 * The Plan View's "fill the parent scope", offered to system back.
 *
 * The scope being filled is local state of the view that shows it, so back cannot reach it; the
 * view registers its Up here while it can go up, and withdraws it when it cannot or unmounts.
 */
let scopeUp: (() => void) | null = null;

/** Offers `up` to system back. Returns the withdrawal. */
export function registerScopeUp(up: () => void): () => void {
  scopeUp = up;
  return () => {
    if (scopeUp === up) scopeUp = null;
  };
}

/** Goes up a scope if one is on offer; answers whether it did. */
export function goUpScope(): boolean {
  if (scopeUp === null) return false;
  scopeUp();
  return true;
}
