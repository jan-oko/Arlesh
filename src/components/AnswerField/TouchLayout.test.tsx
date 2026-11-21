import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import type { MindmapNode } from "@/utils/tree-layout";
import AnswerField from "./AnswerField";
import ReviewAnswer from "./ReviewAnswer";
import { answerActions } from "@/test/answer-actions";
import { storedRowId } from "@/test/stored-id";
import { TOUCH_ONLY_QUERY } from "@/hooks/use-media-query";
import { TOUCH_FIELD_ROWS } from "@/utils/answer-focus";
import expectation from "@/i18n/locales/en/expectation.json";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { dir: () => "ltr" } }),
}));

const question: MindmapNode = {
  id: "expectation-9", rowId: storedRowId(9), kind: "expectation", title: "Red or blue?", status: "pending", position: 0, tagIds: [], children: [],
  agentWaiting: { note: null, question: true, answer: null },
};
const review: MindmapNode = {
  ...question,
  agentWaiting: { note: null, question: true, answer: null, review: { links: [], hand_tests: [] } },
};

function stubTouch(touchOnly: boolean): void {
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: touchOnly && query === TOUCH_ONLY_QUERY,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  }));
}

describe("The answer and review fields on the touch layout", () => {
  beforeEach(() => stubTouch(true));
  afterEach(() => vi.unstubAllGlobals());

  it("a question's field is two lines tall, compact or not, with the touch hint", () => {
    render(<AnswerField question={question} staged={false} actions={answerActions()} compact />);
    const field = screen.getByRole("textbox");
    expect(field).toHaveAttribute("rows", String(TOUCH_FIELD_ROWS));
    expect(field).toHaveAttribute("placeholder", "answerHintTouch");
  });

  it("a review's note is two lines tall, compact or not, with the touch hint", () => {
    render(<ReviewAnswer review={review} staged={false} actions={answerActions()} compact />);
    const field = screen.getByRole("textbox");
    expect(field).toHaveAttribute("rows", String(TOUCH_FIELD_ROWS));
    expect(field).toHaveAttribute("placeholder", "reviewNoteHintTouch");
  });

  it("a review's four controls are icon buttons found by name, with no text", () => {
    render(<ReviewAnswer review={review} staged={false} actions={answerActions()} />);
    const approve = screen.getByRole("radio", { name: "reviewApprove" });
    const changes = screen.getByRole("radio", { name: "reviewRequestChanges" });
    const stage = screen.getByRole("button", { name: "answerStage" });
    const send = screen.getByRole("button", { name: "answerSend" });
    for (const control of [approve, changes, stage, send]) {
      expect(control.textContent).toBe("");
      expect(control.querySelector("svg")).not.toBeNull();
      expect(control).toHaveAttribute("title", control.getAttribute("aria-label"));
    }
    expect(stage.parentElement).toBe(send.parentElement);
  });

  it("choosing a verdict by its icon selects it and enables Stage and Send", () => {
    render(<ReviewAnswer review={review} staged={false} actions={answerActions()} />);
    expect(screen.getByRole("button", { name: "answerStage" })).toBeDisabled();
    fireEvent.click(screen.getByRole("radio", { name: "reviewRequestChanges" }));
    expect(screen.getByRole("radio", { name: "reviewRequestChanges" })).toBeChecked();
    expect(screen.getByRole("button", { name: "answerStage" })).toBeEnabled();
  });

  it("a question's Stage and Send are icon buttons, and Send fires", () => {
    const actions = answerActions();
    render(<AnswerField question={question} staged={false} actions={actions} />);
    expect(screen.getByRole("button", { name: "answerStage" }).textContent).toBe("");
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "blue" } });
    fireEvent.click(screen.getByRole("button", { name: "answerSend" }));
    expect(actions.send).toHaveBeenCalled();
  });

  it("the touch hints name no keyboard chord", () => {
    expect(expectation.answerHintTouch).not.toMatch(/ctrl|enter/i);
    expect(expectation.reviewNoteHintTouch).not.toMatch(/ctrl|enter/i);
  });
});

describe("The answer and review fields with a mouse", () => {
  beforeEach(() => stubTouch(false));
  afterEach(() => vi.unstubAllGlobals());

  it("keep the chord hints and the desktop size", () => {
    render(<AnswerField question={question} staged={false} actions={answerActions()} compact />);
    expect(screen.getByRole("textbox")).toHaveAttribute("placeholder", "answerHint");
    expect(screen.getByRole("textbox")).toHaveAttribute("rows", "1");
  });

  it("keep text labels on the buttons", () => {
    render(<ReviewAnswer review={review} staged={false} actions={answerActions()} />);
    expect(screen.getByRole("button", { name: "answerSend" })).toHaveTextContent("answerSend");
    expect(screen.getByRole("radio", { name: "reviewApprove" })).toHaveTextContent("reviewApprove");
  });
});
