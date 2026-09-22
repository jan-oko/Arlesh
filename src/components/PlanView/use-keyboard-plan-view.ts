import { useHotkeys } from "@/hooks/use-hotkeys";
import { PLAN_BINDINGS } from "@/utils/hotkeys/plan-bindings";
import type { PlanContext } from "@/utils/hotkeys/plan-bindings";

interface Options extends PlanContext {
  isInputActive: boolean;
}

/**
 * The Plan View's keyboard bindings. The bindings themselves live in the shared hotkey registry (so
 * the cheat-sheet renders the same table this dispatches from); this hook only supplies the context
 * and decides when the bindings are live.
 */
export function useKeyboardPlanView(options: Options): void {
  const { isInputActive, ...context } = options;
  useHotkeys(PLAN_BINDINGS, context, !isInputActive);
}
