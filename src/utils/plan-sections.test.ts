import { describe, it, expect } from "vitest";
import { buildPlanSections, subscopeCells } from "./plan-sections";
import type { TaskListRow } from "./list-filter";
import type { MindmapNode, NodeKind } from "./tree-layout";
import type { PartOfDay, Scope, ScopeKind } from "@/api/scopes";
import { testKey } from "@/test/scope-key";

/**
 * A scope row. Only the fields the sectioning reads carry meaning — the dates, the kind and the
 * band — and the datetimes are deliberately left null throughout: nothing here may consult them,
 * because what instant a day begins at is the backend's answer and it is moving off midnight.
 */
function scopeRow(id: number, kind: ScopeKind, startDate: string, endDate: string, part: PartOfDay | null = null): Scope {
  return {
    id: testKey(id), kind, label: `${kind}:${startDate}`,
    start_date: startDate, end_date: endDate,
    part, start_datetime: null, end_datetime: null,
  };
}

function node(id: string, extra: Partial<MindmapNode> = {}, kind: NodeKind = "task"): MindmapNode {
  return { id, kind, title: id, position: 0, tagIds: [], children: [], ...extra };
}

function row(id: string, planId: number | null, ancestors: MindmapNode[] = []): TaskListRow {
  return {
    node: node(id, planId === null ? {} : { plan: { start_id: testKey(planId), end_id: testKey(planId) } }),
    ancestors,
    goalRef: null, goalStatus: null, projectRef: null, projectStatus: null,
    dependencyRefs: [], isBlocked: false, isAgentic: false, isAsynchronous: false,
    hasBlockedAncestor: false, hasPrivateAncestor: false, scopeTokens: [],
  };
}

// September 2026 runs Tue 1st to Wed 30th. Its weeks (Sunday-started) therefore straddle at both
// ends: the first opens on Aug 30th, the last closes on Oct 3rd.
const SEPTEMBER = scopeRow(100, "month", "2026-09-01", "2026-09-30");

describe("subscopeCells", () => {
  it("gives a month the weeks that touch it, straddling ones included", () => {
    const cells = subscopeCells(SEPTEMBER);
    expect(cells.length).toBeGreaterThan(0);
    expect(cells[0]?.startDate).toBe("2026-08-30");
    expect(cells[cells.length - 1]?.endDate).toBe("2026-10-03");
    // Every cell touches the month; none is wholly outside it.
    for (const cell of cells) {
      expect(cell.startDate <= "2026-09-30" && cell.endDate >= "2026-09-01").toBe(true);
    }
  });

  it("keeps a season to its own three months, not the calendar year's twelve", () => {
    const autumn = scopeRow(200, "season", "2026-09-01", "2026-11-30");
    expect(subscopeCells(autumn).map((cell) => cell.startDate))
      .toEqual(["2026-09-01", "2026-10-01", "2026-11-01"]);
  });

  it("splits a day into its bands", () => {
    const day = scopeRow(300, "day", "2026-09-22", "2026-09-22");
    const cells = subscopeCells(day);
    expect(cells).toHaveLength(6);
    expect(cells.every((cell) => cell.ref.kind === "part_of_day")).toBe(true);
  });

  it("gives nothing for the two kinds with no rung below them", () => {
    expect(subscopeCells(scopeRow(400, "part_of_day", "2026-09-22", "2026-09-22", "morning"))).toEqual([]);
    expect(subscopeCells(scopeRow(401, "exact", "2026-09-22", "2026-09-22"))).toEqual([]);
  });
});

describe("buildPlanSections", () => {
  const ALL = { includePremorning: true };

  it("returns null where there is nothing to split by, so the pane draws flat", () => {
    const band = scopeRow(400, "part_of_day", "2026-09-22", "2026-09-22", "morning");
    expect(buildPlanSections([row("a", null)], band, new Map(), ALL)).toBeNull();
  });

  it("files a task under the week its plan sits in", () => {
    const tuesday = scopeRow(1, "day", "2026-09-22", "2026-09-22");
    const scopes = new Map([[testKey(100), SEPTEMBER], [testKey(1), tuesday]]);
    const split = buildPlanSections([row("a", 1)], SEPTEMBER, scopes, ALL);
    const holding = split?.sections.filter((section) => section.rows.length > 0) ?? [];
    expect(holding).toHaveLength(1);
    expect(holding[0]?.rows[0]?.node.id).toBe("a");
    // Sep 22nd is a Tuesday; its week opens on Sunday the 20th.
    expect(holding[0]?.range.startDate).toBe("2026-09-20");
  });

  it("draws empty subscopes, because an empty week is an answer", () => {
    const split = buildPlanSections([], SEPTEMBER, new Map([[testKey(100), SEPTEMBER]]), ALL);
    expect(split?.sections.length).toBeGreaterThan(1);
    expect(split?.sections.every((section) => section.rows.length === 0)).toBe(true);
  });

  it("marks a straddling subscope partial, and a wholly-contained one not", () => {
    const sections = buildPlanSections([], SEPTEMBER, new Map([[testKey(100), SEPTEMBER]]), ALL)?.sections ?? [];
    expect(sections[0]?.partial).toBe(true);
    expect(sections[sections.length - 1]?.partial).toBe(true);
    // A week in the middle of the month is inside it at both ends.
    expect(sections.some((section) => !section.partial)).toBe(true);
  });

  // Arlesh-8jk moved the whole ladder to a 02:00 boundary, so a Day runs 02:00 -> 02:00 and holds
  // its own Night whole. Night's *cell* still ends on the following date, for the calendar grid to
  // shade, and reading that as containment was what marked every day's last band as straddling it.
  it("never marks a day's own bands partial, Night included", () => {
    const day = scopeRow(300, "day", "2026-09-22", "2026-09-22");
    const sections = buildPlanSections([], day, new Map([[testKey(300), day]]), ALL)?.sections ?? [];
    expect(sections).toHaveLength(6);
    expect(sections.some((section) => section.partial)).toBe(false);
  });

  it("never marks a week's own days partial either", () => {
    const week = scopeRow(500, "week", "2026-09-20", "2026-09-26");
    const sections = buildPlanSections([], week, new Map([[testKey(500), week]]), ALL)?.sections ?? [];
    expect(sections).toHaveLength(7);
    expect(sections.some((section) => section.partial)).toBe(false);
  });

  it("leaves a Premorning nobody asked for out of the split", () => {
    const day = scopeRow(300, "day", "2026-09-22", "2026-09-22");
    const split = buildPlanSections([], day, new Map([[testKey(300), day]]), { includePremorning: false });
    expect(split?.sections).toHaveLength(5);
    expect(split?.sections.some((section) => section.ref.kind === "part_of_day" && section.ref.part === "premorning")).toBe(false);
  });

  it("draws Premorning anyway while something is planned into it", () => {
    const day = scopeRow(300, "day", "2026-09-22", "2026-09-22");
    const early = scopeRow(1, "part_of_day", "2026-09-22", "2026-09-22", "premorning");
    const scopes = new Map([[testKey(300), day], [testKey(1), early]]);
    const split = buildPlanSections([row("a", 1)], day, scopes, { includePremorning: false });
    expect(split?.sections).toHaveLength(6);
    expect(split?.sections[0]?.rows.map((r) => r.node.id)).toEqual(["a"]);
  });

  it("hands work planned to the scope itself back as unplaced, for the candidates side", () => {
    const scopes = new Map([[testKey(100), SEPTEMBER]]);
    const split = buildPlanSections([row("a", 100)], SEPTEMBER, scopes, ALL);
    expect(split?.unplaced.map((r) => r.node.id)).toEqual(["a"]);
    expect(split?.sections.every((section) => section.rows.length === 0)).toBe(true);
  });

  it("hands a plan spanning several subscopes back too, rather than filing it under one", () => {
    // A window from the first week's Sunday to the third week's Saturday sits inside no one week.
    const wide = node("a", { plan: { start_id: testKey(1), end_id: testKey(2) } });
    const spanning: TaskListRow = { ...row("a", null), node: wide };
    const scopes = new Map([
      [testKey(100), SEPTEMBER],
      [testKey(1), scopeRow(1, "week", "2026-09-06", "2026-09-12")],
      [testKey(2), scopeRow(2, "week", "2026-09-20", "2026-09-26")],
    ]);
    const split = buildPlanSections([spanning], SEPTEMBER, scopes, ALL);
    expect(split?.unplaced).toHaveLength(1);
  });

  it("holds a task whose plan has not been read back yet, rather than dropping it", () => {
    // The scope map is empty but for the target: the plan's own rows are still in flight.
    const split = buildPlanSections([row("a", 7)], SEPTEMBER, new Map([[testKey(100), SEPTEMBER]]), ALL);
    expect(split?.unplaced.map((r) => r.node.id)).toEqual(["a"]);
  });

  it("files a task under the band its plan names, and hands the day's own work back", () => {
    const day = scopeRow(300, "day", "2026-09-22", "2026-09-22");
    const morning = scopeRow(1, "part_of_day", "2026-09-22", "2026-09-22", "morning");
    const scopes = new Map([[testKey(300), day], [testKey(1), morning]]);
    const split = buildPlanSections([row("a", 1), row("b", 300)], day, scopes, ALL);
    expect(split?.unplaced.map((r) => r.node.id)).toEqual(["b"]);
    const banded = split?.sections.filter((section) => section.rows.length > 0) ?? [];
    expect(banded).toHaveLength(1);
    expect(banded[0]?.rows[0]?.node.id).toBe("a");
  });

  it("keeps every planned row, in a bucket or out of one", () => {
    const scopes = new Map([
      [testKey(100), SEPTEMBER],
      [testKey(1), scopeRow(1, "day", "2026-09-22", "2026-09-22")],
      [testKey(2), scopeRow(2, "day", "2026-09-03", "2026-09-03")],
    ]);
    const rows = [row("a", 1), row("b", 2), row("c", 100), row("d", 99)];
    const split = buildPlanSections(rows, SEPTEMBER, scopes, ALL);
    const placed = (split?.sections ?? []).flatMap((section) => section.rows.map((r) => r.node.id));
    const all = [...placed, ...(split?.unplaced ?? []).map((r) => r.node.id)];
    expect(all.sort()).toEqual(["a", "b", "c", "d"]);
  });

  it("carries each bucket's own calendar cell, which is what a drop or a hotkey plans into", () => {
    const week = scopeRow(500, "week", "2026-09-20", "2026-09-26");
    const sections = buildPlanSections([], week, new Map([[testKey(500), week]]), ALL)?.sections ?? [];
    expect(sections[0]?.ref).toEqual({ kind: "day", date: "2026-09-20" });
  });
});
