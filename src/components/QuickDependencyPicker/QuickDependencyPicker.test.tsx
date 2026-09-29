import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import QuickDependencyPicker from "./QuickDependencyPicker";
import type { QuickDependencyTarget } from "@/hooks/use-quick-dependency";
import type { DependencyCandidate } from "@/utils/dependency-candidates";
import type { MindmapNode } from "@/utils/tree-layout";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

const dependent: MindmapNode = { id: "task-1", rowId: 1, kind: "task", title: "Ship it", position: 0, tagIds: [], children: [] };

const CANDIDATES: DependencyCandidate[] = [
  { id: "task-2", title: "Write the tests", kind: "task", path: ["Release"], dependency: { type: "task", id: 2 } },
  { id: "task-3", title: "Review", kind: "task", path: ["Release"], dependency: { type: "task", id: 3 } },
  { id: "expectation-7", title: "Tests from Dana", kind: "expectation", path: [], dependency: { type: "expectation", id: 7 } },
];

function target(candidates: DependencyCandidate[] | null = CANDIDATES): QuickDependencyTarget {
  return { anchorId: "task-1", dependent, candidates };
}

function setup(candidates: DependencyCandidate[] | null = CANDIDATES) {
  const onPick = vi.fn();
  const onClose = vi.fn();
  render(<QuickDependencyPicker target={target(candidates)} anchorAttribute="data-node-id" onPick={onPick} onClose={onClose} />);
  const input = screen.getByRole("combobox");
  return { onPick, onClose, input };
}

function options(): string[] {
  return screen.queryAllByRole("option").map((option) => option.textContent ?? "");
}

beforeEach(() => { vi.clearAllMocks(); });

describe("QuickDependencyPicker", () => {
  it("opens with the search focused and offers nothing until something is typed", () => {
    const { input } = setup();
    expect(screen.getByRole("dialog", { name: "editor:quickDependencyPicker" })).toBeTruthy();
    expect(document.activeElement).toBe(input);
    expect(options()).toEqual([]);
  });

  it("matches titles in any case, and names each result's kind", () => {
    const { input } = setup();
    fireEvent.change(input, { target: { value: "TESTS" } });
    expect(options()).toEqual(["Write the testsnodeKinds:task", "Tests from DananodeKinds:expectation"]);
  });

  it("adds the first match on Enter, and the arrows move the highlight", () => {
    const { input, onPick } = setup();
    fireEvent.change(input, { target: { value: "tests" } });
    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(input, { key: "ArrowUp" });
    fireEvent.keyDown(input, { key: "ArrowUp" });
    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onPick).toHaveBeenCalledWith(CANDIDATES[2]);
  });

  it("adds a result on a click", () => {
    const { input, onPick } = setup();
    fireEvent.change(input, { target: { value: "review" } });
    const [option] = screen.getAllByRole("option");
    if (option === undefined) throw new Error("no result drawn");
    fireEvent.mouseDown(option);
    expect(onPick).toHaveBeenCalledWith(CANDIDATES[1]);
  });

  it("says there are no results, and Enter then adds nothing", () => {
    const { input, onPick } = setup();
    fireEvent.change(input, { target: { value: "zzz" } });
    expect(screen.getByText("common:noResults")).toBeTruthy();
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onPick).not.toHaveBeenCalled();
  });

  it("says it is still loading while the edges are being read", () => {
    const { input } = setup(null);
    fireEvent.change(input, { target: { value: "tests" } });
    expect(screen.getByText("editor:quickDependencyLoading")).toBeTruthy();
  });

  it("closes on Escape and on a click outside, writing nothing", () => {
    const { input, onClose, onPick } = setup();
    fireEvent.change(input, { target: { value: "tests" } });
    fireEvent.keyDown(input, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
    fireEvent.mouseDown(document.body);
    expect(onClose).toHaveBeenCalledTimes(2);
    expect(onPick).not.toHaveBeenCalled();
  });
});
