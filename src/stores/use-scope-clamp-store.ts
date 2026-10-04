import { create } from "zustand";
import type { ViolatingDescendant } from "@/api/tasks";

/** A Time Scope clamp-or-cancel prompt waiting for the user's answer. */
export interface ScopeClampRequest {
  /** The descendants the narrowed window would orphan. */
  conflicts: ViolatingDescendant[];
  /** `"type-id"` → originating flow title, for descendants materialized from a flow. */
  flowOrigins: Record<string, string>;
  /** Settles the prompt: `true` to clamp them and go on, `false` to cancel. */
  resolve: (proceed: boolean) => void;
}

/**
 * The one clamp-or-cancel prompt for Time Scopes (`docs/spec/time-scopes.md`, *Containment
 * invariants*): any view's editor or drag asks it before narrowing a window or reparenting, and one
 * prompt mounted at the root answers — so a save from the List View or the Plan View gets the same
 * prompt the Mindmap does, rather than waiting on a prompt nothing draws. Not persisted.
 */
interface ScopeClampStore {
  request: ScopeClampRequest | null;
  /** Opens the prompt, resolving `true` to clamp and proceed, `false` to cancel. */
  ask: (conflicts: ViolatingDescendant[], flowOrigins: Record<string, string>) => Promise<boolean>;
  /** Answers the open prompt. */
  answer: (proceed: boolean) => void;
}

export const useScopeClampStore = create<ScopeClampStore>()((set, get) => ({
  request: null,
  ask: (conflicts, flowOrigins) => new Promise<boolean>((resolve) => {
    // A prompt already open is cancelled rather than left hanging.
    get().request?.resolve(false);
    set({ request: { conflicts, flowOrigins, resolve } });
  }),
  answer: (proceed) => {
    get().request?.resolve(proceed);
    set({ request: null });
  },
}));
