import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { MindmapNode } from "@/utils/tree-layout";
import type { ReviewVerdict } from "@/api/expectations";
import ReviewAnswer from "./ReviewAnswer";
import { useHotkeys } from "@/hooks/use-hotkeys";
import type { Binding } from "@/utils/hotkeys/chord";
import { answerActions } from "@/test/answer-actions";
import { storedRowId } from "@/test/stored-id";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { dir: () => "ltr" } }),
}));

function review(links: { label: string; url: string }[] = [], draft?: { verdict: ReviewVerdict; answer: string | null }): MindmapNode {
  return {
    id: "expectation-5", rowId: storedRowId(5), kind: "expectation", title: "Review #12", status: "pending", position: 0, tagIds: [], children: [],
    agentWaiting: {
      note: "Adds the thing", question: true, answer: null,
      review: { links, hand_tests: ["Open the board", "Press Enter"] },
      ...(draft === undefined ? {} : { draft }),
    },
  };
}

const approve = () => screen.getByRole("radio", { name: "reviewApprove" });
const changes = () => screen.getByRole("radio", { name: "reviewRequestChanges" });
const stage = () => screen.getByRole("button", { name: "answerStage" });
const send = () => screen.getByRole("button", { name: "answerSend" });
const chord = { key: "Enter", ctrlKey: true };

describe("ReviewAnswer: what the review shows", () => {
  it("shows the title, summary, links and hand tests, the tests as a plain list with nothing to tick", () => {
    render(<ReviewAnswer review={review([{ label: "PR #12", url: "https://example.test/pull/12" }])} staged={false} actions={answerActions()} />);
    expect(screen.getByText("Review #12")).toBeInTheDocument();
    expect(screen.getByText("Adds the thing")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "PR #12" })).toHaveAttribute("href", "https://example.test/pull/12");
    expect(screen.getAllByRole("listitem")).toHaveLength(3);
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
  });

  it("does not link an address that is not a web one", () => {
    render(<ReviewAnswer review={review([{ label: "Sneaky", url: "javascript:alert(1)" }])} staged={false} actions={answerActions()} />);
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
    expect(screen.getByText("Sneaky")).toBeInTheDocument();
  });

  it("calls Approve a merge when there is a PR link, and the button is a selectable verdict like the other", () => {
    render(<ReviewAnswer review={review([{ label: "PR", url: "https://github.com/o/r/pull/3" }])} staged={false} actions={answerActions()} />);
    expect(screen.getByRole("radio", { name: "reviewApproveMerge" })).toHaveAttribute("aria-checked", "false");
  });
});

describe("ReviewAnswer: choosing a verdict, staging and sending", () => {
  it("with no verdict selected disables Stage and Send, and Ctrl+Enter does nothing", () => {
    const actions = answerActions();
    render(<ReviewAnswer review={review()} staged={false} actions={actions} />);
    expect(stage()).toBeDisabled();
    expect(send()).toBeDisabled();
    fireEvent.keyDown(screen.getByRole("textbox"), chord);
    expect(actions.stage).not.toHaveBeenCalled();
    expect(actions.send).not.toHaveBeenCalled();
  });

  it("is one switch with none selected at first, one selected at a time, and selecting writes nothing", () => {
    const actions = answerActions();
    render(<ReviewAnswer review={review()} staged={false} actions={actions} />);
    expect(screen.getByRole("radiogroup", { name: "reviewVerdict" })).toBeInTheDocument();
    expect(screen.getAllByRole("radio")).toHaveLength(2);
    expect(approve()).toHaveAttribute("aria-checked", "false");
    expect(changes()).toHaveAttribute("aria-checked", "false");
    fireEvent.click(approve());
    expect(approve()).toHaveAttribute("aria-checked", "true");
    expect(changes()).toHaveAttribute("aria-checked", "false");
    fireEvent.click(changes());
    expect(approve()).toHaveAttribute("aria-checked", "false");
    expect(changes()).toHaveAttribute("aria-checked", "true");
    expect(stage()).toBeEnabled();
    expect(actions.stage).not.toHaveBeenCalled();
    expect(actions.send).not.toHaveBeenCalled();
  });

  it("the arrow keys move the choice along the switch, as a radio group's do", () => {
    render(<ReviewAnswer review={review()} staged={false} actions={answerActions()} />);
    fireEvent.keyDown(approve(), { key: "ArrowRight" });
    expect(approve()).toHaveAttribute("aria-checked", "true");
    fireEvent.keyDown(approve(), { key: "ArrowRight" });
    expect(changes()).toHaveAttribute("aria-checked", "true");
    fireEvent.keyDown(changes(), { key: "ArrowLeft" });
    expect(approve()).toHaveAttribute("aria-checked", "true");
  });

  it("keeps the switch, Stage and Send on one line", () => {
    render(<ReviewAnswer review={review()} staged={false} actions={answerActions()} />);
    const line = screen.getByRole("radiogroup").parentElement;
    expect(line).toContainElement(stage());
    expect(line).toContainElement(send());
  });

  it("stages the selected verdict with the trimmed note", async () => {
    const actions = answerActions();
    render(<ReviewAnswer review={review()} staged={false} actions={actions} />);
    fireEvent.change(screen.getByRole("textbox"), { target: { value: " ship it " } });
    fireEvent.click(approve());
    fireEvent.click(stage());
    await waitFor(() => expect(actions.stage).toHaveBeenCalledWith(expect.objectContaining({ id: "expectation-5" }), { verdict: "approved", answer: "ship it" }));
  });

  it("stages a verdict without a note", async () => {
    const actions = answerActions();
    render(<ReviewAnswer review={review()} staged={false} actions={actions} />);
    fireEvent.click(changes());
    fireEvent.click(stage());
    await waitFor(() => expect(actions.stage).toHaveBeenCalledWith(expect.anything(), { verdict: "changes_requested" }));
  });

  it("Ctrl+Enter in the note stages the selected verdict", async () => {
    const actions = answerActions();
    render(<ReviewAnswer review={review()} staged={false} actions={actions} />);
    fireEvent.click(changes());
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "fix it" } });
    fireEvent.keyDown(screen.getByRole("textbox"), chord);
    await waitFor(() => expect(actions.stage).toHaveBeenCalledWith(expect.anything(), { verdict: "changes_requested", answer: "fix it" }));
    expect(actions.send).not.toHaveBeenCalled();
  });

  it("Send on a verdict that is not staged stages it first, in the one call", async () => {
    const actions = answerActions();
    render(<ReviewAnswer review={review()} staged={false} actions={actions} />);
    fireEvent.click(approve());
    fireEvent.click(send());
    await waitFor(() => expect(actions.send).toHaveBeenCalledWith(expect.anything(), { verdict: "approved" }));
    expect(actions.stage).not.toHaveBeenCalled();
  });
});

describe("ReviewAnswer: a staged review", () => {
  it("shows the staged verdict and note, locked, marked Staged", () => {
    render(<ReviewAnswer review={review([], { verdict: "changes_requested", answer: "fix it" })} staged actions={answerActions()} />);
    expect(changes()).toHaveAttribute("aria-checked", "true");
    expect(changes()).toBeDisabled();
    expect(approve()).toBeDisabled();
    expect(screen.getByRole("textbox")).toHaveValue("fix it");
    expect(screen.getByRole("textbox")).toHaveAttribute("readonly");
    expect(stage()).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText("answerStaged")).toBeInTheDocument();
  });

  it("sends the batch with Send and with the second Ctrl+Enter, without staging again", async () => {
    const actions = answerActions();
    render(<ReviewAnswer review={review([], { verdict: "approved", answer: null })} staged actions={actions} />);
    fireEvent.click(send());
    await waitFor(() => expect(actions.send).toHaveBeenCalledTimes(1));
    fireEvent.keyDown(screen.getByRole("textbox"), chord);
    await waitFor(() => expect(actions.send).toHaveBeenCalledTimes(2));
    expect(actions.send.mock.calls[0]).toHaveLength(1);
    expect(actions.stage).not.toHaveBeenCalled();
  });

  it("unstages with Stage, keeping the verdict and note to change", async () => {
    const actions = answerActions();
    const { rerender } = render(<ReviewAnswer review={review([], { verdict: "approved", answer: "ok" })} staged actions={actions} />);
    fireEvent.click(stage());
    await waitFor(() => expect(actions.unstage).toHaveBeenCalledTimes(1));
    rerender(<ReviewAnswer review={review()} staged={false} actions={actions} />);
    expect(approve()).toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("textbox")).toHaveValue("ok");
    expect(approve()).toBeEnabled();
  });
});

describe("ReviewAnswer: Alt+Y and Alt+N", () => {
  const altY = { key: "y", code: "KeyY", altKey: true };
  const altN = { key: "n", code: "KeyN", altKey: true };

  it("select Approve and Request changes from the note field, and type nothing into it", () => {
    render(<ReviewAnswer review={review()} staged={false} actions={answerActions()} />);
    const note = screen.getByRole("textbox");
    note.focus();
    expect(fireEvent.keyDown(note, altY)).toBe(false);
    expect(approve()).toHaveAttribute("aria-checked", "true");
    fireEvent.keyDown(note, altN);
    expect(changes()).toHaveAttribute("aria-checked", "true");
    expect(approve()).toHaveAttribute("aria-checked", "false");
    expect(note).toHaveValue("");
  });

  it("select from the controls too", () => {
    render(<ReviewAnswer review={review()} staged={false} actions={answerActions()} />);
    fireEvent.keyDown(stage(), altN);
    expect(changes()).toHaveAttribute("aria-checked", "true");
    fireEvent.keyDown(send(), altY);
    expect(approve()).toHaveAttribute("aria-checked", "true");
  });

  it("only select: nothing is staged or sent", () => {
    const actions = answerActions();
    render(<ReviewAnswer review={review()} staged={false} actions={actions} />);
    fireEvent.keyDown(screen.getByRole("textbox"), altY);
    expect(actions.stage).not.toHaveBeenCalled();
    expect(actions.send).not.toHaveBeenCalled();
  });

  it("select Approve and merge when that is the option shown", () => {
    render(<ReviewAnswer review={review([{ label: "PR", url: "https://github.com/o/r/pull/3" }])} staged={false} actions={answerActions()} />);
    fireEvent.keyDown(screen.getByRole("textbox"), altY);
    expect(screen.getByRole("radio", { name: "reviewApproveMerge" })).toHaveAttribute("aria-checked", "true");
  });

  it("are ignored in a staged review, and still type nothing", () => {
    render(<ReviewAnswer review={review([], { verdict: "approved", answer: "ok" })} staged actions={answerActions()} />);
    const note = screen.getByRole("textbox");
    expect(fireEvent.keyDown(note, altN)).toBe(false);
    expect(approve()).toHaveAttribute("aria-checked", "true");
    expect(changes()).toHaveAttribute("aria-checked", "false");
    expect(note).toHaveValue("ok");
  });

  it("are shown on the two options, as a title and as aria-keyshortcuts", () => {
    render(<ReviewAnswer review={review()} staged={false} actions={answerActions()} />);
    expect(approve()).toHaveAttribute("title", "Alt+Y");
    expect(approve()).toHaveAttribute("aria-keyshortcuts", "Alt+Y");
    expect(changes()).toHaveAttribute("title", "Alt+N");
    expect(changes()).toHaveAttribute("aria-keyshortcuts", "Alt+N");
  });

  describe("against a global binding on the same chord", () => {
    const fired = vi.fn();
    const bindings: readonly Binding<{ run: () => void }>[] = [
      { id: "test.altY", section: "global", chord: { code: "KeyY", alt: true }, labelKey: "filterCloseMenu", run: (ctx) => ctx.run() },
    ];

    function Host() {
      useHotkeys(bindings, { run: fired }, true);
      return (
        <div>
          <ReviewAnswer review={review()} staged={false} actions={answerActions()} />
          <button type="button" aria-label="outside" />
        </div>
      );
    }

    it("takes precedence while focus is in the review: the binding does not also fire", () => {
      fired.mockClear();
      render(<Host />);
      fireEvent.keyDown(stage(), altY);
      fireEvent.keyDown(screen.getByRole("textbox"), altY);
      expect(approve()).toHaveAttribute("aria-checked", "true");
      expect(fired).not.toHaveBeenCalled();
    });

    it("does nothing new outside the review: the binding fires and no verdict is selected", () => {
      fired.mockClear();
      render(<Host />);
      fireEvent.keyDown(screen.getByRole("button", { name: "outside" }), altY);
      expect(fired).toHaveBeenCalledTimes(1);
      expect(approve()).toHaveAttribute("aria-checked", "false");
    });
  });
});
