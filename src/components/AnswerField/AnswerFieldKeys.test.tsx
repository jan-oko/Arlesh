import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, renderHook, screen, waitFor } from "@testing-library/react";
import type { MindmapNode } from "@/utils/tree-layout";
import AnswerField from "./AnswerField";
import ReviewAnswer from "./ReviewAnswer";
import { answerActions } from "@/test/answer-actions";
import { storedRowId } from "@/test/stored-id";
import { useAgentActivityStore } from "@/stores/use-agent-activity-store";
import { useHotkeys } from "@/hooks/use-hotkeys";
import { useJumpToWaiting } from "@/hooks/use-jump-to-waiting";
import type { Binding } from "@/utils/hotkeys/chord";
import { FIELD_HOME, nextWaitingField } from "@/utils/answer-focus";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { dir: () => "ltr" } }),
}));

function question(n: number): MindmapNode {
  return {
    id: `expectation-${n}`, rowId: storedRowId(n), kind: "expectation", title: `Question ${n}`, status: "pending", position: n, tagIds: [], children: [],
    agentWaiting: { note: null, question: true, answer: null },
  };
}

function review(n: number): MindmapNode {
  return {
    id: `expectation-${n}`, rowId: storedRowId(n), kind: "expectation", title: `Review ${n}`, status: "pending", position: n, tagIds: [], children: [],
    agentWaiting: { note: null, question: true, answer: null, review: { links: [], hand_tests: [] } },
  };
}

const altDown = { key: "ArrowDown", code: "ArrowDown", altKey: true };
const altUp = { key: "ArrowUp", code: "ArrowUp", altKey: true };
const escape = { key: "Escape", code: "Escape" };

/** A question, a review and a question, in the order shown. */
function Fields({ actions = answerActions() }) {
  return (
    <div>
      <AnswerField question={question(1)} staged={false} actions={actions} />
      <ReviewAnswer review={review(2)} staged={false} actions={actions} />
      <AnswerField question={question(3)} staged={false} actions={actions} />
    </div>
  );
}

const fields = () => screen.getAllByRole("textbox");

beforeEach(() => {
  useAgentActivityStore.setState({ stagedWaitIds: [] });
});

describe("between answer fields: Alt+Down and Alt+Up", () => {
  it("move to the next and the previous field, question and review alike, in the order shown", () => {
    render(<Fields />);
    const [first, second, third] = fields();
    first?.focus();
    fireEvent.keyDown(first as HTMLElement, altDown);
    expect(second).toHaveFocus();
    fireEvent.keyDown(second as HTMLElement, altDown);
    expect(third).toHaveFocus();
    fireEvent.keyDown(third as HTMLElement, altUp);
    expect(second).toHaveFocus();
  });

  it("do nothing at the last or the first field: there is no wrap", () => {
    render(<Fields />);
    const [first, , third] = fields();
    third?.focus();
    fireEvent.keyDown(third as HTMLElement, altDown);
    expect(third).toHaveFocus();
    first?.focus();
    fireEvent.keyDown(first as HTMLElement, altUp);
    expect(first).toHaveFocus();
  });


  it("take precedence over a global binding on the same chord", () => {
    const fired = vi.fn();
    const bindings: readonly Binding<{ run: () => void }>[] = [
      { id: "test.reorder", section: "global", chord: { code: "ArrowDown", alt: true }, labelKey: "filterCloseMenu", run: (ctx) => ctx.run() },
    ];
    function Host() {
      useHotkeys(bindings, { run: fired }, true);
      return <Fields />;
    }
    render(<Host />);
    fields()[0]?.focus();
    fireEvent.keyDown(fields()[0] as HTMLElement, altDown);
    expect(fields()[1]).toHaveFocus();
    expect(fired).not.toHaveBeenCalled();
  });
});

describe("out of an answer field: Escape", () => {
  it("leaves the field and gives the keyboard back to the view, so Ctrl+Z reaches the board", () => {
    const undo = vi.fn();
    const bindings: readonly Binding<{ undo: () => void }>[] = [
      { id: "test.undo", section: "global", chord: { code: "KeyZ", ctrl: true }, labelKey: "filterCloseMenu", run: (ctx) => ctx.undo() },
    ];
    function Host() {
      useHotkeys(bindings, { undo }, true);
      return <Fields />;
    }
    render(<Host />);
    const note = fields()[1] as HTMLElement;
    note.focus();
    // In the field the view's keys stand aside: the browser's own undo answers.
    fireEvent.keyDown(note, { key: "z", code: "KeyZ", ctrlKey: true });
    expect(undo).not.toHaveBeenCalled();

    fireEvent.keyDown(note, escape);
    expect(note).not.toHaveFocus();
    fireEvent.keyDown(document.body, { key: "z", code: "KeyZ", ctrlKey: true });
    expect(undo).toHaveBeenCalledTimes(1);
  });

  it("does not unstage, stage, clear or send anything", () => {
    const actions = answerActions();
    render(<Fields actions={actions} />);
    const first = fields()[0] as HTMLElement;
    fireEvent.change(first, { target: { value: "blue" } });
    first.focus();
    fireEvent.keyDown(first, escape);
    expect(first).toHaveValue("blue");
    expect(actions.stage).not.toHaveBeenCalled();
    expect(actions.unstage).not.toHaveBeenCalled();
    expect(actions.send).not.toHaveBeenCalled();
  });

  it("inside an editor modal returns to the modal, so the first Escape leaves the field and the second closes it", () => {
    const onKeyDown = vi.fn();
    render(
      <div {...{ [FIELD_HOME]: "" }} tabIndex={-1} data-testid="modal" onKeyDown={(event) => { if (event.key === "Escape") onKeyDown(); }}>
        <Fields />
      </div>,
    );
    const first = fields()[0] as HTMLElement;
    first.focus();
    fireEvent.keyDown(first, escape);
    expect(onKeyDown).not.toHaveBeenCalled();
    expect(screen.getByTestId("modal")).toHaveFocus();
    fireEvent.keyDown(screen.getByTestId("modal"), escape);
    expect(onKeyDown).toHaveBeenCalledTimes(1);
  });
});

describe("into an answer field: the jump to the next waiting answer", () => {
  function task(id: string): MindmapNode {
    return { id, kind: "task", title: id, status: "todo", position: 0, tagIds: [], children: [] } as MindmapNode;
  }

  /** Three Tasks' answer groups: the second is staged. */
  function Board({ staged = [2] }: { staged?: number[] }) {
    const actions = answerActions();
    return (
      <div>
        {[1, 2, 3].map((n) => {
          const t: MindmapNode = { ...task(`task-${n}`), agentWaits: [question(n * 10)], openQuestionIds: [storedRowId(n * 10)] };
          return (
            <div key={n} data-answer-task={t.id}>
              <AnswerField question={question(n * 10)} staged={staged.includes(n)} actions={actions} />
            </div>
          );
        })}
      </div>
    );
  }

  it("goes to the next field that is waiting, skipping staged ones, selects its Task and focuses it", () => {
    render(<Board />);
    const select = vi.fn();
    const { result } = renderHook(() => useJumpToWaiting({ select, showToast: vi.fn() }));
    result.current();
    expect(select).toHaveBeenLastCalledWith("task-1");
    expect(fields()[0]).toHaveFocus();
    result.current();
    expect(select).toHaveBeenLastCalledWith("task-3");
    expect(fields()[2]).toHaveFocus();
  });

  it("wraps at the end", () => {
    render(<Board />);
    const select = vi.fn();
    const { result } = renderHook(() => useJumpToWaiting({ select, showToast: vi.fn() }));
    fields()[2]?.focus();
    result.current();
    expect(select).toHaveBeenLastCalledWith("task-1");
    expect(fields()[0]).toHaveFocus();
  });

  it("with nothing waiting does nothing but say so in a toast", () => {
    render(<Board staged={[1, 2, 3]} />);
    const select = vi.fn();
    const showToast = vi.fn();
    const { result } = renderHook(() => useJumpToWaiting({ select, showToast }));
    result.current();
    expect(select).not.toHaveBeenCalled();
    expect(showToast).toHaveBeenCalledWith(expect.objectContaining({ message: "nothingWaiting" }));
    expect(nextWaitingField(null)).toBeNull();
  });
});

const unstageChord = { key: "Enter", code: "Enter", ctrlKey: true, shiftKey: true };

function stagedQuestion(): MindmapNode {
  const wait = question(7);
  return { ...wait, agentWaiting: { note: null, question: true, answer: null, draft: { answer: "blue", verdict: null } } };
}

function stagedReview(): MindmapNode {
  const wait = review(8);
  return { ...wait, agentWaiting: { note: null, question: true, answer: null, review: { links: [], hand_tests: [] }, draft: { answer: "fix it", verdict: "changes_requested" } } };
}

describe("a staged field: Alt+Down lands on it, and Ctrl+Shift+Enter unstages it", () => {
  it("Alt+Down and Alt+Up stop on a staged (locked) field, which stays read only", () => {
    const actions = answerActions();
    render(
      <div>
        <AnswerField question={question(1)} staged={false} actions={actions} />
        <AnswerField question={stagedQuestion()} staged actions={actions} />
        <AnswerField question={question(3)} staged={false} actions={actions} />
      </div>,
    );
    const [first, staged, third] = fields();
    first?.focus();
    fireEvent.keyDown(first as HTMLElement, altDown);
    expect(staged).toHaveFocus();
    expect(staged).toHaveAttribute("readonly");
    fireEvent.keyDown(staged as HTMLElement, altDown);
    expect(third).toHaveFocus();
    fireEvent.keyDown(third as HTMLElement, altUp);
    expect(staged).toHaveFocus();
  });

  it("unstages a staged question, keeps its text, and keeps focus in the now editable field with the caret at the end", async () => {
    const actions = answerActions();
    const { rerender } = render(<AnswerField question={stagedQuestion()} staged actions={actions} />);
    const field = screen.getByRole("textbox");
    field.focus();
    fireEvent.keyDown(field, unstageChord);
    await waitFor(() => expect(actions.unstage).toHaveBeenCalledTimes(1));
    rerender(<AnswerField question={question(7)} staged={false} actions={actions} />);
    expect(screen.getByRole("textbox")).toHaveValue("blue");
    expect(screen.getByRole("textbox")).not.toHaveAttribute("readonly");
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 5)); });
    expect(screen.getByRole("textbox")).toHaveFocus();
    expect((screen.getByRole("textbox") as HTMLTextAreaElement).selectionStart).toBe(4);
    expect(actions.send).not.toHaveBeenCalled();
    expect(actions.stage).not.toHaveBeenCalled();
  });

  it("unstages a staged review, keeping its verdict and note", async () => {
    const actions = answerActions();
    const { rerender } = render(<ReviewAnswer review={stagedReview()} staged actions={actions} />);
    const note = screen.getByRole("textbox");
    note.focus();
    fireEvent.keyDown(note, unstageChord);
    await waitFor(() => expect(actions.unstage).toHaveBeenCalledTimes(1));
    rerender(<ReviewAnswer review={review(8)} staged={false} actions={actions} />);
    expect(screen.getByRole("textbox")).toHaveValue("fix it");
    expect(screen.getByRole("radio", { name: "reviewRequestChanges" })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("radio", { name: "reviewRequestChanges" })).toBeEnabled();
    expect(actions.send).not.toHaveBeenCalled();
  });

  it("does nothing in a field that is not staged, and never sends from a staged one", () => {
    const actions = answerActions();
    render(
      <div>
        <AnswerField question={question(1)} staged={false} actions={actions} />
        <AnswerField question={stagedQuestion()} staged actions={actions} />
      </div>,
    );
    const [open, staged] = fields();
    fireEvent.change(open as HTMLElement, { target: { value: "x" } });
    expect(fireEvent.keyDown(open as HTMLElement, unstageChord)).toBe(false);
    fireEvent.keyDown(staged as HTMLElement, unstageChord);
    expect(actions.stage).not.toHaveBeenCalled();
    expect(actions.send).not.toHaveBeenCalled();
    expect(actions.unstage).toHaveBeenCalledTimes(1);
  });

  it("shows the chord on the Stage button while staged, and not otherwise", () => {
    const { rerender } = render(<AnswerField question={stagedQuestion()} staged actions={answerActions()} />);
    expect(screen.getByRole("button", { name: "answerStage" })).toHaveAttribute("title", "Ctrl+Shift+Enter");
    expect(screen.getByRole("button", { name: "answerStage" })).toHaveAttribute("aria-keyshortcuts", "Ctrl+Shift+Enter");
    rerender(<AnswerField question={question(7)} staged={false} actions={answerActions()} />);
    expect(screen.getByRole("button", { name: "answerStage" })).not.toHaveAttribute("title");
  });

  it("Ctrl+Enter is unchanged: in a staged field it sends", async () => {
    const actions = answerActions();
    render(<AnswerField question={stagedQuestion()} staged actions={actions} />);
    fireEvent.keyDown(screen.getByRole("textbox"), { key: "Enter", code: "Enter", ctrlKey: true });
    await waitFor(() => expect(actions.send).toHaveBeenCalledTimes(1));
    expect(actions.unstage).not.toHaveBeenCalled();
  });
});

describe("the jump among the staged answers: Shift+Q", () => {
  function Board({ staged }: { staged: number[] }) {
    const actions = answerActions();
    return (
      <div>
        {[1, 2, 3, 4].map((n) => (
          <div key={n} data-answer-task={`task-${n}`}>
            <AnswerField question={question(n * 10)} staged={staged.includes(n)} actions={actions} />
          </div>
        ))}
      </div>
    );
  }

  it("walks only the staged answers, selects their Tasks, and wraps", () => {
    render(<Board staged={[2, 4]} />);
    const select = vi.fn();
    const { result } = renderHook(() => useJumpToWaiting({ select, showToast: vi.fn(), staged: true }));
    result.current();
    expect(select).toHaveBeenLastCalledWith("task-2");
    expect(fields()[1]).toHaveFocus();
    result.current();
    expect(select).toHaveBeenLastCalledWith("task-4");
    result.current();
    expect(select).toHaveBeenLastCalledWith("task-2");
  });

  it("with nothing staged does nothing but say so in a toast", () => {
    render(<Board staged={[]} />);
    const select = vi.fn();
    const showToast = vi.fn();
    const { result } = renderHook(() => useJumpToWaiting({ select, showToast, staged: true }));
    result.current();
    expect(select).not.toHaveBeenCalled();
    expect(showToast).toHaveBeenCalledWith(expect.objectContaining({ message: "nothingStaged" }));
  });
});
