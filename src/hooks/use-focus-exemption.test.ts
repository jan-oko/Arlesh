import { describe, it, expect } from "vitest";
import { renderHook } from "@testing-library/react";
import { useFocusExemption } from "@/hooks/use-focus-exemption";

interface Props {
  selectedNodeId: string | null;
  filterKeys: readonly unknown[];
}

function renderExemption(initial: Props) {
  return renderHook(({ selectedNodeId, filterKeys }: Props) => useFocusExemption(selectedNodeId, filterKeys), {
    initialProps: initial,
  });
}

const FILTER = { statusMode: "plan" };
const OTHER_FILTER = { statusMode: "all" };

describe("useFocusExemption", () => {
  it("exempts whatever is selected", () => {
    const { result } = renderExemption({ selectedNodeId: "task-1", filterKeys: [FILTER] });
    expect(result.current).toBe("task-1");
  });

  it("exempts nothing when nothing is selected", () => {
    const { result } = renderExemption({ selectedNodeId: null, filterKeys: [FILTER] });
    expect(result.current).toBeNull();
  });

  it("holds the exemption across a data reload that leaves the selection where it is", () => {
    const { result, rerender } = renderExemption({ selectedNodeId: "task-1", filterKeys: [FILTER] });
    rerender({ selectedNodeId: "task-1", filterKeys: [FILTER] });
    expect(result.current).toBe("task-1");
  });

  it("moves the exemption to the newly selected node", () => {
    const { result, rerender } = renderExemption({ selectedNodeId: "task-1", filterKeys: [FILTER] });
    rerender({ selectedNodeId: "task-2", filterKeys: [FILTER] });
    expect(result.current).toBe("task-2");
  });

  it("ends the exemption when the selection is cleared", () => {
    const { result, rerender } = renderExemption({ selectedNodeId: "task-1", filterKeys: [FILTER] });
    rerender({ selectedNodeId: null, filterKeys: [FILTER] });
    expect(result.current).toBeNull();
  });

  it("ends the exemption the moment a filter changes, even though the selection stands", () => {
    const { result, rerender } = renderExemption({ selectedNodeId: "task-1", filterKeys: [FILTER] });
    rerender({ selectedNodeId: "task-1", filterKeys: [OTHER_FILTER] });
    expect(result.current).toBeNull();
  });

  it("stays ended while the selection stands after a filter change", () => {
    const { result, rerender } = renderExemption({ selectedNodeId: "task-1", filterKeys: [FILTER] });
    rerender({ selectedNodeId: "task-1", filterKeys: [OTHER_FILTER] });
    rerender({ selectedNodeId: "task-1", filterKeys: [OTHER_FILTER] });
    expect(result.current).toBeNull();
  });

  it("re-exempts the node when you select it again after a filter change", () => {
    const { result, rerender } = renderExemption({ selectedNodeId: "task-1", filterKeys: [FILTER] });
    rerender({ selectedNodeId: "task-1", filterKeys: [OTHER_FILTER] });
    rerender({ selectedNodeId: "task-2", filterKeys: [OTHER_FILTER] });
    rerender({ selectedNodeId: "task-1", filterKeys: [OTHER_FILTER] });
    expect(result.current).toBe("task-1");
  });

  it("follows the selection when a filter change and a reselection land together", () => {
    const { result, rerender } = renderExemption({ selectedNodeId: "task-1", filterKeys: [FILTER] });
    rerender({ selectedNodeId: "task-2", filterKeys: [OTHER_FILTER] });
    expect(result.current).toBe("task-2");
  });

  it("ends the exemption when any one of several filter keys changes", () => {
    const { result, rerender } = renderExemption({ selectedNodeId: "task-1", filterKeys: [FILTER, null] });
    rerender({ selectedNodeId: "task-1", filterKeys: [FILTER, "goal-1"] });
    expect(result.current).toBeNull();
  });
});
