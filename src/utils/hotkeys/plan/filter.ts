import type { Binding } from "@/utils/hotkeys/chord";

/** What the filter menu binding acts on. */
export interface PlanFilterContext {
  onToggleFilter: () => void;
}

export const PLAN_FILTER_BINDINGS: readonly Binding<PlanFilterContext>[] = [
  {
    id: "planView.toggleFilter", section: "planView", chord: { code: "KeyF", alt: true },
    labelKey: "toggleFilter", run: (c) => c.onToggleFilter(),
  },
];
