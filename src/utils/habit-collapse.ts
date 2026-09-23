// Folding a Habit's passed iterations into one node, and expanding that node into scope levels.
//
// A Habit leaves one node per iteration, and they never stop arriving: three weeks of a missed
// daily habit is twenty-one dead nodes between you and the live one, and a year of a kept one is
// three hundred and sixty-five. This is the other end of the timeline from the ellipsis node that
// stands in for future iterations — a single node standing in for the passed ones.
//
// Two rules decide everything here:
//   * **What folds** — every iteration whose window has passed, however it ended. Done folds with
//     Lapsed and Missed, because the pile-up is the problem and a kept habit piles up fastest. The
//     iteration whose window is still open always renders on its own.
//   * **What the expansion looks like** — a level is inserted for a scope kind only where the run
//     spans more than one of that unit. Five days inside one week are five day nodes and no week
//     level; three weeks inside one month get a week level and no month level.
//
// Nothing here is persisted or written back: a group node has no DB row, no status and no filter
// of its own. It is a way of drawing iterations, which is why the fold runs *after* the filter —
// a group renders exactly when at least one iteration behind it would have.

import { lastDayOfWindow, seasonOf, weekStart } from "@/utils/scope-calendar";
import type { CanonicalKind } from "@/utils/scope-ref";
import type { HabitGroupLevel, HabitIterationMeta, MindmapNode } from "@/utils/tree-layout";

/** How many consecutive passed iterations it takes to fold, before the user says otherwise. */
export const DEFAULT_HABIT_COLLAPSE_THRESHOLD = 3;

/** The lowest threshold the setting offers: one iteration is not a run. */
export const MIN_HABIT_COLLAPSE_THRESHOLD = 2;

/** The highest threshold the setting offers — past this the setting is "never fold" spelled slowly. */
export const MAX_HABIT_COLLAPSE_THRESHOLD = 99;

/** How a run of iterations ended, as a group node reports it. */
export interface HabitTally {
  /** Iterations behind the node. */
  passed: number;
  /** How many of them finished. */
  done: number;
  /** How many did not — Lapsed, Missed and Expired alike. */
  missed: number;
}

/** A scope level of an expanded run — every `HabitGroupLevel` except the run node itself. */
export type HabitScopeLevel = Exclude<HabitGroupLevel, "run">;

/**
 * The localized text a group node is labelled with. Supplied by the caller (see
 * `use-habit-collapse-labels`) so this module stays pure and unit-testable with plain stubs —
 * the same arrangement `scope-format` has with `ScopeLabelFns`.
 */
export interface HabitCollapseLabels {
  /** The folded run, named for the Habit behind it: "Journal: 14 passed · 9 done, 5 missed". */
  run: (habit: string, tally: HabitTally) => string;
  /** One scope level: "September · 18 done, 12 missed". */
  level: (unit: string, tally: HabitTally) => string;
  /** The year-less label of one unit — "W12", "September", "Autumn", "2026". */
  unit: (level: HabitScopeLevel, anchorDate: string) => string;
  /** The day span behind a group, for its tooltip. */
  span: (startIso: string, endIso: string) => string;
}

/** How coarse each scope kind an iteration's own window can be is. */
const KIND_RANK: Record<CanonicalKind, number> = { day: 0, week: 1, month: 2, season: 3 };

/** The insertable levels, finest first, with the same ranking. Year sits above Season. */
const LEVEL_RANK: Record<HabitScopeLevel, number> = { week: 1, month: 2, season: 3, year: 4 };

const LEVELS_FINE_TO_COARSE: HabitScopeLevel[] = ["week", "month", "season", "year"];

/**
 * The unit of `level` that `date` falls in, as a grouping key.
 *
 * **Year keys off the Season, not the calendar.** A Winter that straddles New Year is one season,
 * and splitting it between two year nodes would draw it twice; the year a Season is labelled with
 * is the one it groups under. That also makes the year level self-limiting: two season-years imply
 * two seasons, so a year level never appears without the season level beneath it.
 */
export function unitKey(level: HabitScopeLevel, date: string): string {
  switch (level) {
    case "week": return weekStart(date);
    case "month": return date.slice(0, 7);
    case "season": {
      const season = seasonOf(date);
      return `${season.name}-${season.year}`;
    }
    case "year": return String(seasonOf(date).year);
  }
}

/**
 * The levels to insert for one run, coarsest first: those coarser than the iterations' own scope
 * kind that the run spans more than one of.
 *
 * A sub-day (Phase) window counts as a day: such a Habit steps whole days, so its iterations *are*
 * the day nodes, and a day level would hold exactly one child each.
 */
export function levelsForRun(iterations: readonly HabitIterationMeta[]): HabitScopeLevel[] {
  const first = iterations[0];
  if (first === undefined) return [];
  const ownRank = KIND_RANK[first.scopeKind ?? "day"];
  return LEVELS_FINE_TO_COARSE.filter((level) => {
    if (LEVEL_RANK[level] <= ownRank) return false;
    const units = new Set(iterations.map((it) => unitKey(level, it.anchorDate)));
    return units.size > 1;
  }).reverse();
}

function tallyOf(iterations: readonly HabitIterationMeta[]): HabitTally {
  const done = iterations.filter((it) => it.done).length;
  return { passed: iterations.length, done, missed: iterations.length - done };
}

/**
 * A group node's tree id. The spelling is frozen (Arlesh-z7n) and is a key only: what keeps the
 * node out of every DB-backed mutation is that it carries no `rowId`, exactly as the iteration
 * nodes it stands for carry none.
 *
 * The run node is keyed by its flow alone: passed iterations are a *prefix* of a Habit's generated
 * ones — a window cannot pass before an earlier window has — so one flow under one host has one
 * run, and an id that survives the run growing is what keeps an expansion expanded.
 */
export function habitRunId(flowId: number): string {
  return `habitrun-${flowId}-virtual`;
}

/**
 * A scope level's tree id, keyed by the first iteration under it.
 *
 * Not by the unit, because a unit does not identify a node: a Sunday-start week can straddle two
 * months, so one week label can legitimately appear under each of them, and keying by the label
 * would give the two nodes the same id. The buckets are disjoint runs of iterations, so their
 * first iteration always tells them apart.
 */
function habitLevelId(flowId: number, level: HabitScopeLevel, firstAnchorDate: string): string {
  return `habitrun-${flowId}-${level}-${firstAnchorDate}-virtual`;
}

/**
 * Whether a node is one of the fold's own — the run, or one of the scope levels it expands into.
 *
 * They are one kind for the purposes of opening and closing: both are drawn shut until the user
 * opens them, so both answer to `expandedHabitGroupIds` rather than to `collapsedNodeIds`.
 */
export function isHabitGroupNode(node: MindmapNode): boolean {
  return node.habitGroup !== undefined;
}

/** One iteration node paired with the metadata the fold reads off it. */
interface RunEntry {
  node: MindmapNode;
  meta: HabitIterationMeta;
}

function groupNode(
  level: HabitGroupLevel,
  entries: readonly RunEntry[],
  id: string,
  title: (tally: HabitTally) => string,
  children: MindmapNode[],
  labels: HabitCollapseLabels,
): MindmapNode {
  const metas = entries.map((entry) => entry.meta);
  const first = metas[0];
  const last = metas[metas.length - 1];
  // `entries` is never empty: every caller builds it from at least one iteration.
  if (first === undefined || last === undefined) throw new Error("habit group with no iterations");
  const tally = tallyOf(metas);
  const spanStart = first.anchorDate;
  const spanEnd = lastDayOfWindow(last.windowEnd);
  const color = entries[0]?.node.color;
  return {
    id,
    kind: "habit_group",
    title: title(tally),
    virtual: true,
    habitGroup: {
      flowId: first.flowId,
      level,
      ...tally,
      spanStart,
      spanEnd,
      spanLabel: labels.span(spanStart, spanEnd),
    },
    ...(color !== undefined ? { color } : {}),
    position: first.index,
    tagIds: [],
    children,
  };
}

/** Splits chronologically-ordered entries into consecutive same-unit buckets. */
function bucketByUnit(entries: readonly RunEntry[], level: HabitScopeLevel): RunEntry[][] {
  const buckets: RunEntry[][] = [];
  let currentKey: string | null = null;
  for (const entry of entries) {
    const key = unitKey(level, entry.meta.anchorDate);
    const current = buckets[buckets.length - 1];
    if (key === currentKey && current !== undefined) {
      current.push(entry);
      continue;
    }
    buckets.push([entry]);
    currentKey = key;
  }
  return buckets;
}

/** The children of an expanded run at one depth: the remaining levels, nested, then the iterations. */
function levelChildren(
  entries: readonly RunEntry[],
  levels: readonly HabitScopeLevel[],
  labels: HabitCollapseLabels,
): MindmapNode[] {
  const [level, ...rest] = levels;
  if (level === undefined) return entries.map((entry) => entry.node);
  return bucketByUnit(entries, level).map((bucket) => {
    const first = bucket[0];
    // A bucket comes from `bucketByUnit`, which never emits an empty one.
    if (first === undefined) throw new Error("habit group level with no iterations");
    return groupNode(
      level,
      bucket,
      habitLevelId(first.meta.flowId, level, first.meta.anchorDate),
      (tally) => labels.level(labels.unit(level, first.meta.anchorDate), tally),
      levelChildren(bucket, rest, labels),
      labels,
    );
  });
}

/** The single node a run of passed iterations folds into, with its expansion already built. */
function runNode(entries: readonly RunEntry[], labels: HabitCollapseLabels): MindmapNode {
  const metas = entries.map((entry) => entry.meta);
  const first = metas[0];
  if (first === undefined) throw new Error("habit run with no iterations");
  return groupNode(
    "run",
    entries,
    habitRunId(first.flowId),
    (tally) => labels.run(first.flowTitle, tally),
    levelChildren(entries, levelsForRun(metas), labels),
    labels,
  );
}

function foldChildren(
  children: readonly MindmapNode[],
  threshold: number,
  labels: HabitCollapseLabels,
): MindmapNode[] {
  const folded: MindmapNode[] = [];
  let run: RunEntry[] = [];

  function flush(): void {
    if (run.length === 0) return;
    // Below the threshold the iterations stand on their own: a short run is not a pile-up, and
    // folding two nodes into one node saves nothing and hides two.
    if (run.length >= threshold) folded.push(runNode(run, labels));
    else for (const entry of run) folded.push(entry.node);
    run = [];
  }

  for (const child of children) {
    const meta = child.habitIteration;
    if (meta === undefined || !meta.passed) {
      flush();
      folded.push(child);
      continue;
    }
    if (run[0] !== undefined && run[0].meta.flowId !== meta.flowId) flush();
    run.push({ node: child, meta });
  }
  flush();
  return folded;
}

/**
 * Replaces every run of `threshold` or more consecutive passed Habit iterations with one group
 * node standing in for them.
 *
 * Run over the **filtered** tree, never the loaded one: a group node is not a thing the filter can
 * evaluate — it has no status, no scope and no tags of its own — so it is built out of whichever
 * iterations the filter kept, and it therefore renders exactly when one of them would have.
 */
export function foldHabitRuns(
  root: MindmapNode,
  threshold: number,
  labels: HabitCollapseLabels,
): MindmapNode {
  const children = foldChildren(
    root.children.map((child) => foldHabitRuns(child, threshold, labels)),
    threshold,
    labels,
  );
  return { ...root, children };
}

/**
 * The collapsed set the canvas should lay out with: the nodes the user has collapsed, plus every
 * group node — run or scope level — they have not opened.
 *
 * Everything the fold draws is shut until asked for, which the ordinary collapsed set cannot say:
 * an id absent from it means *expanded*. So the run and its levels share one inverted set, and
 * opening a run shows the levels it spans rather than every iteration underneath them — which is
 * the whole point of levelling it. Each level then opens on its own with the same gesture.
 */
export function collapsedWithFoldedGroups(
  root: MindmapNode,
  collapsedIds: ReadonlySet<string>,
  expandedHabitGroupIds: ReadonlySet<string>,
): ReadonlySet<string> {
  const folded = new Set(collapsedIds);
  function visit(node: MindmapNode): void {
    if (isHabitGroupNode(node) && !expandedHabitGroupIds.has(node.id)) folded.add(node.id);
    for (const child of node.children) visit(child);
  }
  visit(root);
  return folded;
}
