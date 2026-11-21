import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, renderHook, screen } from "@testing-library/react";
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
