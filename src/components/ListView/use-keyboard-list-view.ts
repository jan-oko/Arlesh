import { useHotkeys } from "@/hooks/use-hotkeys";
import { LIST_BINDINGS } from "@/utils/hotkeys/list-bindings";
import type { ListContext } from "@/utils/hotkeys/list-bindings";

interface Options extends ListContext {
  isInputActive: boolean;
}

/**
 * List View's keyboard bindings. The bindings themselves live in the shared hotkey registry (so the
 * cheat-sheet renders the same table this dispatches from); this hook only supplies the context and
 * decides when the bindings are live.
 */
export function useKeyboardListView(options: Options): void {
  const { isInputActive, ...context } = options;
  useHotkeys(LIST_BINDINGS, context, !isInputActive);
}
