import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import type { MindmapNode } from "@/utils/tree-layout";
import OpenWaits from "./OpenWaits";
import { answerActions } from "@/test/answer-actions";
import { storedRowId } from "@/test/stored-id";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { dir: () => "ltr" } }),
}));

function wait(n: number, title: string): MindmapNode {
  return {
    id: `expectation-${n}`, rowId: storedRowId(n), kind: "expectation", title, status: "pending", position: n, tagIds: [], children: [],
    agentWaiting: { note: null, question: true, answer: null },
  };
}

function task(staged: number[]): MindmapNode {
  return {
    id: "task-1", rowId: storedRowId(1), kind: "task", title: "Work", status: "todo", position: 0, tagIds: [],
    agentWaits: [wait(2, "One?"), wait(3, "Two?")],
    openQuestionIds: [storedRowId(2), storedRowId(3)],
    stagedQuestionIds: staged.map((n) => storedRowId(n)),
    children: [],
  };
}

describe("OpenWaits: the staged marks", () => {
  it("marks the Task when every open wait is staged, and no wait has a tag of its own", () => {
    render(<OpenWaits task={task([2, 3])} actions={answerActions()} />);
    expect(screen.getByText("taskStaged")).toBeInTheDocument();
    expect(screen.queryByText("answerStaged")).not.toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "answerStage" }).filter((b) => b.getAttribute("aria-pressed") === "true")).toHaveLength(2);
  });

  it("presses only the staged wait's Stage, and does not mark the Task, while any open wait is not staged", () => {
    render(<OpenWaits task={task([2])} actions={answerActions()} />);
    expect(screen.queryByText("taskStaged")).not.toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "answerStage" }).filter((b) => b.getAttribute("aria-pressed") === "true")).toHaveLength(1);
  });

  it("marks nothing when nothing is staged", () => {
    render(<OpenWaits task={task([])} actions={answerActions()} />);
    expect(screen.queryByText("taskStaged")).not.toBeInTheDocument();
    expect(screen.queryByText("answerStaged")).not.toBeInTheDocument();
  });
});
