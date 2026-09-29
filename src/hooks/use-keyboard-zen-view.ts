import { useHotkeys } from "@/hooks/use-hotkeys";
import { ZEN_BINDINGS } from "@/utils/hotkeys/zen-bindings";
import type { ZenContext } from "@/utils/hotkeys/zen-bindings";

interface Options extends ZenContext {
  isInputActive: boolean;
}

/**
 * The Zen View's keyboard bindings. The table lives in the shared registry, so the cheat-sheet
 * renders what this dispatches; this hook supplies the context and decides when the keys are live.
 */
export function useKeyboardZenView(options: Options): void {
  const { isInputActive, ...context } = options;
  useHotkeys(ZEN_BINDINGS, context, !isInputActive);
}
