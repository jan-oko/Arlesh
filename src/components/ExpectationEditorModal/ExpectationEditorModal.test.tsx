import { describe, it, expect, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { MindmapNode } from "@/utils/tree-layout";
import ExpectationEditorModal from "./ExpectationEditorModal";

vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key, i18n: { dir: () => "ltr" } }) }));

const WAIT: MindmapNode = {
  id: "wait", kind: "expectation", rowId: 3, title: "Reviewer replies", status: "pending",
  checkEvery: { n: 3, kind: "day" }, checkStarting: "2026-07-03T02:00:00", timeScope: null,
  position: 0, tagIds: [], children: [],
};

describe("ExpectationEditorModal — Check every", () => {
  it("clears a set Check every, and the save says so", async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(<ExpectationEditorModal node={WAIT} onSave={onSave} onClose={vi.fn()} />);
    // The first Clear is Check every's; the second, once it is set, is Starting's.
    fireEvent.click(screen.getAllByRole("button", { name: "scopeClear" })[0]!);
    // The Starting field goes with it: there is nothing left to start.
    expect(screen.queryByText("expectation:fieldCheckStarting")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "save" }));
    await waitFor(() => expect(onSave).toHaveBeenCalled());
    expect(onSave.mock.calls[0]?.[0]).toMatchObject({ checkEvery: null });
  });
});

describe("ExpectationEditorModal — an agent waiting on you", () => {
  const ASKED: MindmapNode = {
    ...WAIT, agentWaiting: { note: "Red or blue for the badge?", question: true, answer: null },
  };

  it("shows the agent's question, and saves the answer in a field of its own", async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(<ExpectationEditorModal node={ASKED} onSave={onSave} onClose={vi.fn()} />);
    expect(screen.getByLabelText("expectation:agentNote")).toHaveValue("Red or blue for the badge?");

    fireEvent.change(screen.getByLabelText("expectation:agentAnswer"), { target: { value: "Blue." } });
    fireEvent.click(screen.getByRole("button", { name: "save" }));
    await waitFor(() => expect(onSave).toHaveBeenCalled());

    expect(onSave.mock.calls[0]?.[0]).toMatchObject({
      agentic: true, agenticNote: "Red or blue for the badge?", agenticAnswer: "Blue.",
    });
  });

  it("saves the note and the answer without trailing blank lines", async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(<ExpectationEditorModal node={ASKED} onSave={onSave} onClose={vi.fn()} />);
    fireEvent.change(screen.getByLabelText("expectation:agentNote"), { target: { value: "Red or blue?\n\n" } });
    fireEvent.change(screen.getByLabelText("expectation:agentAnswer"), { target: { value: "NULL\n" } });
    fireEvent.click(screen.getByRole("button", { name: "save" }));
    await waitFor(() => expect(onSave).toHaveBeenCalled());

    expect(onSave.mock.calls[0]?.[0]).toMatchObject({ agenticNote: "Red or blue?", agenticAnswer: "NULL" });
  });

  it("asks no answer of a wait on something other than the user", () => {
    const ci: MindmapNode = { ...WAIT, agentWaiting: { note: "CI on #86", question: false, answer: null } };
    render(<ExpectationEditorModal node={ci} onSave={vi.fn()} onClose={vi.fn()} />);
    expect(screen.getByLabelText("expectation:agentWaitNote")).toHaveValue("CI on #86");
    expect(screen.queryByLabelText("expectation:agentAnswer")).toBeNull();
  });

  it("has no question field on an ordinary wait", () => {
    render(<ExpectationEditorModal node={WAIT} onSave={vi.fn()} onClose={vi.fn()} />);
    expect(screen.queryByLabelText("expectation:agentNote")).toBeNull();
  });
});
