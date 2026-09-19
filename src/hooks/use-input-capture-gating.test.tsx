import { describe, it, expect, vi, beforeEach } from "vitest";
import { render } from "@testing-library/react";
import { useKeyboardListView } from "@/components/ListView/use-keyboard-list-view";
import { useInputCapture, useIsInputCaptured } from "./use-input-capture";
import { useInputCaptureStore } from "@/stores/use-input-capture-store";

const onToggleFilter = vi.fn();

function fireAltF() {
  window.dispatchEvent(
    new KeyboardEvent("keydown", { key: "f", code: "KeyF", altKey: true, bubbles: true, cancelable: true }),
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
  useKeyboardListView({
    isInputActive: isInputCaptured,
    selectedTaskId: "task-1",
    selectedCommitmentId: null,
    selectedRowId: "task-1",
    isSelectedBlocked: false,
    onNavigate: vi.fn(),
    onCycleStatus: vi.fn(),
    onOpenEditor: vi.fn(),
    onStartRename: vi.fn(),
    onDeselect: vi.fn(),
    onToggleFilter,
    onSetStatusMode: vi.fn(),
    onOpenSearch: vi.fn(),
    subtreeRootId: null,
    onExitSubtree: vi.fn(),
    onExitToRoot: vi.fn(),
    onToggleBacklog: vi.fn(),
    onCycleAgentic: vi.fn(),
    onMarkKept: vi.fn(),
    onMarkBroken: vi.fn(),
  });
  return modalState && modalRenders ? <Modal /> : null;
}

beforeEach(() => {
  onToggleFilter.mockClear();
  useInputCaptureStore.setState({ captors: new Set<string>() });
});

describe("view hotkeys gated by the input-capture registry", () => {
  it("fires a binding when nothing is on screen", () => {
    render(<View modalState={false} modalRenders={false} />);
    fireAltF();
    expect(onToggleFilter).toHaveBeenCalledTimes(1);
  });

  it("suppresses a binding while a modal is mounted", () => {
    render(<View modalState={true} modalRenders={true} />);
    fireAltF();
    expect(onToggleFilter).not.toHaveBeenCalled();
  });

  // The original bug: a modal flag set while the modal renders nothing (a delete target missing from
  // a reloaded tree, an editor kind with no branch) left the view's hotkeys dead with nothing on
  // screen to clear the flag. Gating on the mount instead of the flag makes that unreachable.
  it("still fires when the modal flag is set but no modal renders", () => {
    render(<View modalState={true} modalRenders={false} />);
    fireAltF();
    expect(onToggleFilter).toHaveBeenCalledTimes(1);
  });

  it("restores the binding once the modal unmounts", () => {
    const { rerender } = render(<View modalState={true} modalRenders={true} />);
    rerender(<View modalState={false} modalRenders={false} />);
    fireAltF();
    expect(onToggleFilter).toHaveBeenCalledTimes(1);
  });
});
