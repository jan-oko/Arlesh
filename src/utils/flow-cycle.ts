import type { FlowCyclePair } from "@/utils/tree-layout";

/**
 * Relative-cycle geometry. A flow item's Cycle Scope is the Nth subscope of the flow window; a
 * Cycle Plan is a range of sub-subscopes within it. Because the flow window is unanchored while
 * editing the template, the grid uses *nominal* subdivision counts (resolved to real dates only
 * when the flow is started, Phase 7.4).
 */

/** Scope kinds from coarsest to finest. */
export const SCOPE_ORDER = ["season", "month", "week", "day", "part_of_day"] as const;
export type CycleScopeKind = (typeof SCOPE_ORDER)[number];

/** Nominal count of `SCOPE_ORDER[i+1]` units in one `SCOPE_ORDER[i]`. */
const SUBDIVISIONS = [3, 4, 7, 6] as const; // season→month, month→week, week→day, day→part

function indexOfKind(kind: string): number {
  return SCOPE_ORDER.findIndex((k) => k === kind);
}

/** True when `kind` is a valid scope kind. */
export function isCycleScopeKind(kind: string): kind is CycleScopeKind {
  return indexOfKind(kind) !== -1;
}

/** The scope kinds strictly finer than `kind` (candidates for a subscope). */
export function kindsBelow(kind: string): CycleScopeKind[] {
  const idx = indexOfKind(kind);
  if (idx === -1) return [];
  return SCOPE_ORDER.slice(idx + 1);
}

/**
 * Nominal number of `child` units within one `parent` unit (e.g. week→day = 7). Returns 1 when
 * the kinds are equal and 0 when `child` is not strictly finer than `parent`.
 */
export function subdivisionsBetween(parent: string, child: string): number {
  const p = indexOfKind(parent);
  const c = indexOfKind(child);
  if (p === -1 || c === -1 || c < p) return 0;
  let product = 1;
  for (let i = p; i < c; i++) product *= SUBDIVISIONS[i]!;
  return product;
}

/** Number of `cycleKind` cells spanning a flow window of `flowN` × `flowKind`. */
export function cycleScopeCellCount(flowN: number, flowKind: string, cycleKind: string): number {
  return flowN * subdivisionsBetween(flowKind, cycleKind);
}

/** Number of `planKind` cells within a single `cycleKind` cycle scope. */
export function cyclePlanCellCount(cycleKind: string, planKind: string): number {
  return subdivisionsBetween(cycleKind, planKind);
}

/** Stable key for a cycle pair, used to dedupe and to key list rows. */
export function cyclePairKey(pair: FlowCyclePair): string {
  return [pair.scopeKind, pair.scopeIndex, pair.planKind, pair.planStart, pair.planEnd]
    .map((part) => (part === null ? "_" : String(part)))
    .join(":");
}

/** One level of the relative cycle navigator: `count` sibling slots at `kind`. */
export interface CycleLevel {
  kind: string;
  count: number;
}

/**
 * The ordered navigation levels from the flow's own repeated period down to `targetKind`: a root
 * level (the flow's own kind, repeated `flowN` times — e.g. "which of the 2 weeks") followed by
 * each canonical kind strictly between `flowKind` and `targetKind`, ending at `targetKind` itself.
 * Empty when `targetKind` isn't strictly finer than `flowKind`.
 */
export function cycleLevels(flowN: number, flowKind: string, targetKind: CycleScopeKind): CycleLevel[] {
  const flowIdx = indexOfKind(flowKind);
  const targetIdx = indexOfKind(targetKind);
  if (flowIdx === -1 || targetIdx === -1 || targetIdx <= flowIdx) return [];
  const levels: CycleLevel[] = [{ kind: flowKind, count: flowN }];
  for (let i = flowIdx; i < targetIdx; i++) {
    levels.push({ kind: SCOPE_ORDER[i + 1]!, count: SUBDIVISIONS[i]! });
  }
  return levels;
}

/**
 * Combines a 1-based per-level path (one index per `levels` entry, coarsest first) into the
 * single flat 1-based scope index the backend resolves against the flow's window start.
 */
export function pathToIndex(levels: CycleLevel[], path: number[]): number {
  let flat = 0;
  for (let i = 0; i < levels.length; i++) {
    flat = flat * levels[i]!.count + (path[i]! - 1);
  }
  return flat + 1;
}

/** Inverse of `pathToIndex`: decomposes a flat 1-based scope index back into its per-level path. */
export function indexToPath(levels: CycleLevel[], index: number): number[] {
  let remaining = index - 1;
  const path: number[] = new Array(levels.length);
  for (let i = levels.length - 1; i >= 0; i--) {
    const count = levels[i]!.count;
    path[i] = (remaining % count) + 1;
    remaining = Math.floor(remaining / count);
  }
  return path;
}
