import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { MindmapNode } from "@/utils/tree-layout";
import AnswerField from "./AnswerField";
import { answerActions } from "@/test/answer-actions";
import { storedRowId } from "@/test/stored-id";
import { useAgentActivityStore } from "@/stores/use-agent-activity-store";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { dir: () => "ltr" } }),
}));

function question(draft?: { answer: string | null }): MindmapNode {
  return {
    id: "expectation-9", rowId: storedRowId(9), kind: "expectation", title: "Red or blue?", status: "pending", position: 0, tagIds: [], children: [],
    agentWaiting: { note: "For the badge", question: true, answer: null, ...(draft === undefined ? {} : { draft: { answer: draft.answer, verdict: null } }) },
  };
}

const field = () => screen.getByRole("textbox");
const stage = () => screen.getByRole("button", { name: "answerStage" });
const send = () => screen.getByRole("button", { name: "answerSend" });
const chord = { key: "Enter", ctrlKey: true };

beforeEach(() => {
  useAgentActivityStore.setState({ stagedWaitIds: [] });
});

describe("AnswerField: a field that is not staged", () => {
  it("with no text has Stage disabled, and Send disabled while nothing else is staged", () => {
    render(<AnswerField question={question()} staged={false} actions={answerActions()} />);
    expect(stage()).toBeDisabled();
    expect(send()).toBeDisabled();
  });

  it("with no text has Send enabled when something else on the board is staged, and sends only that", async () => {
    useAgentActivityStore.setState({ stagedWaitIds: [storedRowId(3)] });
    const actions = answerActions();
    render(<AnswerField question={question()} staged={false} actions={actions} />);
    expect(stage()).toBeDisabled();
    fireEvent.click(send());
    await waitFor(() => expect(actions.send).toHaveBeenCalledWith(expect.objectContaining({ id: "expectation-9" })));
    expect(actions.send.mock.calls[0]).toHaveLength(1);
  });

  it("stages the text with Stage", async () => {
    const actions = answerActions();
    render(<AnswerField question={question()} staged={false} actions={actions} />);
    fireEvent.change(field(), { target: { value: "blue" } });
    fireEvent.click(stage());
    await waitFor(() => expect(actions.stage).toHaveBeenCalledWith(expect.objectContaining({ id: "expectation-9" }), { answer: "blue" }));
    expect(actions.send).not.toHaveBeenCalled();
  });

  it("stages the text with Ctrl+Enter, and does nothing on an empty field", async () => {
    const actions = answerActions();
    render(<AnswerField question={question()} staged={false} actions={actions} />);
    fireEvent.keyDown(field(), chord);
    expect(actions.stage).not.toHaveBeenCalled();
    fireEvent.change(field(), { target: { value: "blue" } });
    fireEvent.keyDown(field(), chord);
    await waitFor(() => expect(actions.stage).toHaveBeenCalledTimes(1));
    expect(actions.send).not.toHaveBeenCalled();
  });

  it("Send on text that is not staged yet is one call that stages it first, then sends", async () => {
    const actions = answerActions();
    render(<AnswerField question={question()} staged={false} actions={actions} />);
    fireEvent.change(field(), { target: { value: "blue" } });
    fireEvent.click(send());
    await waitFor(() => expect(actions.send).toHaveBeenCalledWith(expect.objectContaining({ id: "expectation-9" }), { answer: "blue" }));
    expect(actions.stage).not.toHaveBeenCalled();
  });
});

describe("AnswerField: a staged field", () => {
  it("shows the draft, locked, marked Staged and with Stage pressed", () => {
    render(<AnswerField question={question({ answer: "blue" })} staged actions={answerActions()} />);
    expect(field()).toHaveValue("blue");
    expect(field()).toHaveAttribute("readonly");
    expect(stage()).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText("answerStaged")).toBeInTheDocument();
  });

  it("locks the text: typing changes nothing", () => {
    render(<AnswerField question={question({ answer: "blue" })} staged actions={answerActions()} />);
    fireEvent.change(field(), { target: { value: "red" } });
    expect(field()).toHaveValue("blue");
  });

  it("unstages with Stage and keeps the text in the field to edit", async () => {
    const actions = answerActions();
    const staged = question({ answer: "blue" });
    const { rerender } = render(<AnswerField question={staged} staged actions={actions} />);
    fireEvent.click(stage());
    await waitFor(() => expect(actions.unstage).toHaveBeenCalledTimes(1));
    rerender(<AnswerField question={question()} staged={false} actions={actions} />);
    expect(field()).toHaveValue("blue");
    expect(field()).not.toHaveAttribute("readonly");
    expect(stage()).toHaveAttribute("aria-pressed", "false");
  });

  it("sends the batch with Send, without staging again", async () => {
    const actions = answerActions();
    render(<AnswerField question={question({ answer: "blue" })} staged actions={actions} />);
    fireEvent.click(send());
    await waitFor(() => expect(actions.send).toHaveBeenCalledTimes(1));
    expect(actions.send.mock.calls[0]).toHaveLength(1);
    expect(actions.stage).not.toHaveBeenCalled();
  });

  it("sends the batch with the second Ctrl+Enter", async () => {
    const actions = answerActions();
    render(<AnswerField question={question({ answer: "blue" })} staged actions={actions} />);
    fireEvent.keyDown(field(), chord);
    await waitFor(() => expect(actions.send).toHaveBeenCalledTimes(1));
    expect(actions.unstage).not.toHaveBeenCalled();
  });

  it("gives the keyboard back to the view when the send is pressed, so Ctrl+Z reaches the board", async () => {
    const actions = answerActions();
    render(<AnswerField question={question({ answer: "blue" })} staged actions={actions} />);
    field().focus();
    expect(field()).toHaveFocus();
    fireEvent.keyDown(field(), chord);
    await waitFor(() => expect(actions.send).toHaveBeenCalled());
    expect(field()).not.toHaveFocus();
    expect(document.activeElement).toBe(document.body);
  });

  it("disables both buttons while a call is in flight", async () => {
    const actions = answerActions();
    let land: (landed: boolean) => void = () => undefined;
    actions.send.mockReturnValue(new Promise<boolean>((resolve) => { land = resolve; }));
    render(<AnswerField question={question({ answer: "blue" })} staged actions={actions} />);
    fireEvent.click(send());
    await waitFor(() => expect(stage()).toBeDisabled());
    expect(send()).toBeDisabled();
    land(true);
  });
});
