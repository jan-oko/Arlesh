import { useHotkeys } from "@/hooks/use-hotkeys";
import { STEPS_BINDINGS } from "@/utils/hotkeys/steps-bindings";
import type { StepsContext } from "@/utils/hotkeys/steps-bindings";

interface Options extends StepsContext {
  isInputActive: boolean;
}

/**
 * The Steps View's keyboard bindings. The bindings themselves live in the shared hotkey registry
 * (so the cheat-sheet renders the same table this dispatches from); this hook only supplies the
 * context and decides when the bindings are live.
 */
export function useKeyboardStepsView(options: Options): void {
  const { isInputActive, ...context } = options;
  useHotkeys(STEPS_BINDINGS, context, !isInputActive);
}
