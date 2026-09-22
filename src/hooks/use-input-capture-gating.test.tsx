import { describe, it, expect, vi, beforeEach } from "vitest";
import { render } from "@testing-library/react";
import { useKeyboardListView } from "@/components/ListView/use-keyboard-list-view";
import { useInputCapture, useIsInputCaptured } from "./use-input-capture";
import { useInputCaptureStore } from "@/stores/use-input-capture-store";
import { listKeyboardContext } from "@/test/keyboard-context";

// This exercises the **view** tables' gating, so the example chord has to be one that is still a
// view binding. Alt+F used to play that part and is now global; bare Escape took over, and it is a
// better example anyway — it is in the view table precisely because it needs the view's selection.

const onDeselect = vi.fn();
const onUndo = vi.fn();
const onRedo = vi.fn();

/** Bare Escape: a view binding that stayed a view binding, because it needs the view's selection. */
function fireEscape() {
  window.dispatchEvent(
    new KeyboardEvent("keydown", { key: "Escape", code: "Escape", bubbles: true, cancelable: true }),
  );
}

function fireCtrlZ(shiftKey = false) {
  window.dispatchEvent(
    new KeyboardEvent("keydown", { key: "z", code: "KeyZ", ctrlKey: true, shiftKey, bubbles: true, cancelable: true }),
  );
}

/** Stands in for any editor modal: it captures the keyboard purely by being mounted. */
function Modal() {
  useInputCapture();
  return <div />;
}

/**
 * A view whose hotkeys are gated by what is actually on screen. `modalState` is the state flag that
 * used to gate them directly; `modalRenders` is whether that flag actually puts a modal up.
 */
function View({ modalState, modalRenders }: { modalState: boolean; modalRenders: boolean }) {
  const isInputCaptured = useIsInputCaptured();
  useKeyboardListView(listKeyboardContext({
    isInputActive: isInputCaptured,
    onDeselect,
    onUndo,
    onRedo,
  }));
  return modalState && modalRenders ? <Modal /> : null;
}

beforeEach(() => {
  onDeselect.mockClear();
  onUndo.mockClear();
  onRedo.mockClear();
  useInputCaptureStore.setState({ captors: new Set<string>() });
});

describe("view hotkeys gated by the input-capture registry", () => {
  it("fires a binding when nothing is on screen", () => {
    render(<View modalState={false} modalRenders={false} />);
    fireEscape();
    expect(onDeselect).toHaveBeenCalledTimes(1);
  });

  it("suppresses a binding while a modal is mounted", () => {
    render(<View modalState={true} modalRenders={true} />);
    fireEscape();
    expect(onDeselect).not.toHaveBeenCalled();
  });

  // The original bug: a modal flag set while the modal renders nothing (a delete target missing from
  // a reloaded tree, an editor kind with no branch) left the view's hotkeys dead with nothing on
  // screen to clear the flag. Gating on the mount instead of the flag makes that unreachable.
  it("still fires when the modal flag is set but no modal renders", () => {
    render(<View modalState={true} modalRenders={false} />);
    fireEscape();
    expect(onDeselect).toHaveBeenCalledTimes(1);
  });

  // Ctrl+Z is the one binding a modal must never let through: inside a field it means the field
  // undo the browser already gives, and behind a modal it would reverse the board underneath it.
  it("reaches undo and redo when nothing is on screen", () => {
    render(<View modalState={false} modalRenders={false} />);
    fireCtrlZ();
    fireCtrlZ(true);
    expect(onUndo).toHaveBeenCalledTimes(1);
    expect(onRedo).toHaveBeenCalledTimes(1);
  });

  it("suppresses undo and redo while a modal is mounted", () => {
    render(<View modalState={true} modalRenders={true} />);
    fireCtrlZ();
    fireCtrlZ(true);
    expect(onUndo).not.toHaveBeenCalled();
    expect(onRedo).not.toHaveBeenCalled();
  });

  it("restores the binding once the modal unmounts", () => {
    const { rerender } = render(<View modalState={true} modalRenders={true} />);
    rerender(<View modalState={false} modalRenders={false} />);
    fireEscape();
    expect(onDeselect).toHaveBeenCalledTimes(1);
  });
});
