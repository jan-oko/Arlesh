import { create } from "zustand";
import type { DescendantPlans, PlanClampTarget } from "@/api/tasks";

/** A clamp-or-cancel prompt waiting for the user's answer. */
export interface PlanClampRequest {
  /** The Tasks a new Plan above them would leave outside, nearest first. */
  conflicts: PlanClampTarget[];
  /** Settles the prompt: clamp them, clear their Plans, or `null` to cancel. */
  resolve: (choice: DescendantPlans | null) => void;
}

/**
 * The one clamp-or-cancel prompt for Plans (`docs/spec/time-scopes.md`, *Plan inheritance*): any
 * writer of a Plan — the editor, the `P` quick picker, the Plan View — asks it before narrowing or
 * moving a Plan that Tasks below hold their own Plans inside, and one prompt mounted at the root
 * answers. Not persisted.
 */
interface PlanClampStore {
  request: PlanClampRequest | null;
  /** Opens the prompt on `conflicts`, resolving with the user's choice, or `null` on cancel. */
  ask: (conflicts: PlanClampTarget[]) => Promise<DescendantPlans | null>;
  /** Answers the open prompt. */
  answer: (choice: DescendantPlans | null) => void;
}

export const usePlanClampStore = create<PlanClampStore>()((set, get) => ({
  request: null,
  ask: (conflicts) => new Promise<DescendantPlans | null>((resolve) => {
    // A prompt already open is cancelled rather than left hanging.
    get().request?.resolve(null);
    set({ request: { conflicts, resolve } });
  }),
  answer: (choice) => {
    get().request?.resolve(choice);
    set({ request: null });
  },
}));
