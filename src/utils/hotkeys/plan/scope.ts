import type { Binding } from "@/utils/hotkeys/chord";

/** What walking from one scope to the next acts on. */
export interface PlanScopeContext {
  onStepScope: (direction: 1 | -1) => void;
  /** Fills the parent scope, or says out loud why there is none. */
  onUpScope: () => void;
}

/**
 * `[` and `]` step the scope being filled.
 *
 * The bracket pair is free in every table and reads as "back one / on one" without competing with
 * the arrows, which the two panes already use. Walking scopes is the outer loop of a planning pass
 * and moving the selection is the inner one, so the two deliberately do not share an axis.
 */
export const PLAN_SCOPE_BINDINGS: readonly Binding<PlanScopeContext>[] = [
  {
    id: "planView.previousScope", section: "planView", chord: { code: "BracketLeft" },
    labelKey: "planStepScope", run: (c) => c.onStepScope(-1),
  },
  {
    id: "planView.nextScope", section: "planView", chord: { code: "BracketRight" },
    labelKey: "planStepScope", run: (c) => c.onStepScope(1),
  },
  // `\` is the third key of the cluster on a US layout, and was free in every table. Up is the
  // one step off the bracket axis — a different rung rather than the next cell — so it gets the
  // neighbouring key rather than a modifier on either bracket.
  {
    id: "planView.upScope", section: "planView", chord: { code: "Backslash" },
    labelKey: "planUpScope", run: (c) => c.onUpScope(),
  },
];
