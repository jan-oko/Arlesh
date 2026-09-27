import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import QuickPlanPicker from "./QuickPlanPicker";
import { getScope, resolveScope } from "@/api/scopes";
import type { Scope, ScopeKey } from "@/api/scopes";
import type { TimeScope } from "@/api/time-scope";
import type { QuickPlanTarget } from "@/hooks/use-quick-plan";
import { keyStartDate } from "@/utils/scope-key";
import type { MindmapNode } from "@/utils/tree-layout";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock("@/api/scopes", () => ({
  getScope: vi.fn(),
  resolveScope: vi.fn(),
}));

const JUNE: ScopeKey = { kind: "month", date: "2026-06-01" };
const single = (id: ScopeKey): TimeScope => ({ start_id: id, end_id: id });

function scopeOf(id: ScopeKey): Scope {
  return {
    id, kind: id.kind, label: "",
    start_date: keyStartDate(id), end_date: keyStartDate(id),
    part: null, start_datetime: null, end_datetime: null,
  };
}

function task(extra: Partial<MindmapNode> = {}): MindmapNode {
  return { id: "task-5", rowId: 5, kind: "task", title: "Ship it", position: 0, tagIds: [], children: [], ...extra };
}

function target(extra: Partial<QuickPlanTarget> = {}): QuickPlanTarget {
  return { anchorId: "task-5", tasks: [task()], skipped: 0, value: null, timeScope: null, ...extra };
}

/** A drawn node the picker anchors to, laid out at the given box. */
function drawAnchor(box: { left: number; top: number; bottom: number }): HTMLElement {
  const element = document.createElement("div");
  element.setAttribute("data-node-id", "task-5");
  element.getBoundingClientRect = () => DOMRect.fromRect({ x: box.left, y: box.top, width: 120, height: box.bottom - box.top });
  document.body.appendChild(element);
  return element;
}

let anchor: HTMLElement | null = null;

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getScope).mockImplementation((id) => Promise.resolve(scopeOf(id)));
});

afterEach(() => {
  anchor?.remove();
  anchor = null;
});

/** The day cells of the picker's grid, which it opens on with no Plan. */
function dayCells(): HTMLElement[] {
  return screen.getAllByRole("button").filter((button) => /^\d+$/.test(button.textContent ?? ""));
}

describe("QuickPlanPicker", () => {
  it("opens anchored just below the selected node", () => {
    anchor = drawAnchor({ left: 140, top: 200, bottom: 236 });
    render(<QuickPlanPicker target={target()} anchorAttribute="data-node-id" onApply={vi.fn()} onClose={vi.fn()} />);
    const dialog = screen.getByRole("dialog", { name: "quickPlanPicker" });
    expect(dialog.style.left).toBe("140px");
    expect(dialog.style.top).toBe("242px");
  });

  it("applies the picked scope as the Plan", async () => {
    const onApply = vi.fn();
    render(<QuickPlanPicker target={target()} anchorAttribute="data-node-id" onApply={onApply} onClose={vi.fn()} />);
    fireEvent.click(dayCells()[0]!);
    fireEvent.click(screen.getByRole("button", { name: "scopeApply" }));
    await waitFor(() => expect(onApply).toHaveBeenCalledWith(expect.objectContaining({
      start_id: { kind: "day", date: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/) },
    })));
  });

  it("applies on Enter, as every inline picker does", async () => {
    const onApply = vi.fn();
    render(<QuickPlanPicker target={target()} anchorAttribute="data-node-id" onApply={onApply} onClose={vi.fn()} />);
    fireEvent.click(dayCells()[0]!);
    fireEvent.keyDown(document, { key: "Enter" });
    await waitFor(() => expect(onApply).toHaveBeenCalledTimes(1));
  });

  it("closes on Escape without writing anything", () => {
    const onApply = vi.fn();
    const onClose = vi.fn();
    render(<QuickPlanPicker target={target()} anchorAttribute="data-node-id" onApply={onApply} onClose={onClose} />);
    fireEvent.click(dayCells()[0]!);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalled();
    expect(onApply).not.toHaveBeenCalled();
  });

  it("with nothing picked, Apply just closes — only Clear removes a Plan", async () => {
    const onApply = vi.fn();
    const onClose = vi.fn();
    render(<QuickPlanPicker target={target()} anchorAttribute="data-node-id" onApply={onApply} onClose={onClose} />);
    fireEvent.click(screen.getByRole("button", { name: "scopeApply" }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(onApply).not.toHaveBeenCalled();
  });

  it("offers Clear on a planned Task, and Clear writes no Plan", async () => {
    const onApply = vi.fn();
    const planned = target({ tasks: [task({ plan: single(JUNE) })], value: single(JUNE) });
    render(<QuickPlanPicker target={planned} anchorAttribute="data-node-id" onApply={onApply} onClose={vi.fn()} />);
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "June 2026" })).toHaveAttribute("aria-pressed", "true"),
    );
    fireEvent.click(screen.getByRole("button", { name: "scopeClear" }));
    expect(onApply).toHaveBeenCalledWith(null);
  });

  it("offers no Clear on an unplanned Task", () => {
    render(<QuickPlanPicker target={target()} anchorAttribute="data-node-id" onApply={vi.fn()} onClose={vi.fn()} />);
    expect(screen.queryByRole("button", { name: "scopeClear" })).not.toBeInTheDocument();
  });

  it("holds the picker to the Task's Time Scope: a Day outside it cannot be picked", async () => {
    vi.mocked(resolveScope).mockResolvedValue({ start: "2026-06-01T02:00:00", end: "2026-07-01T02:00:00", active: false });
    // The picker opens on the week of June 2nd, which starts on May 31st — outside June.
    const day = { kind: "day" as const, date: "2026-06-02" };
    const bound = target({ timeScope: single(JUNE), value: { start_id: day, end_id: day } });
    render(<QuickPlanPicker target={bound} anchorAttribute="data-node-id" onApply={vi.fn()} onClose={vi.fn()} />);
    await waitFor(() => expect(resolveScope).toHaveBeenCalledWith(JUNE));
    await waitFor(() => expect(screen.getByRole("button", { name: "31" })).toBeDisabled());
    expect(screen.getByRole("button", { name: "02" })).toBeEnabled();
  });
});
