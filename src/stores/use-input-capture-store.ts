import { create } from "zustand";

interface InputCaptureStore {
  /** One token per modal or inline editor currently mounted. */
  captors: ReadonlySet<string>;
  acquire: (token: string) => void;
  release: (token: string) => void;
}

/**
 * Which modals and inline editors are on screen right now.
 *
 * View-level hotkeys must not fire while the user is in a modal or renaming a node. Deriving that
 * from per-view state flags (`editorModal !== null`, `editingNodeId !== null`, …) made the claim
 * independent of the UI it described: a flag could stay set while its modal rendered nothing —
 * a delete target missing from a reloaded tree, an editor kind with no branch — and the view's
 * hotkeys stayed dead with nothing on screen left to clear them.
 *
 * A token registered on mount and dropped on unmount cannot disagree with what is rendered, so a
 * captor that stops rendering releases itself.
 */
export const useInputCaptureStore = create<InputCaptureStore>()((set) => ({
  captors: new Set<string>(),
  acquire: (token) =>
    set((state) => {
      if (state.captors.has(token)) return state;
      const captors = new Set(state.captors);
      captors.add(token);
      return { captors };
    }),
  release: (token) =>
    set((state) => {
      if (!state.captors.has(token)) return state;
      const captors = new Set(state.captors);
      captors.delete(token);
      return { captors };
    }),
}));
