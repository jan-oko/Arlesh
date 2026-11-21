import "@testing-library/jest-dom";

// The app always boots with a tab strip, and every per-tab store is read through the active tab.
// Loading the strip here gives each suite the same single default tab a fresh launch has, so a
// test can address the active tab directly (`useViewStore.setState(…)`) exactly as before tabs.
import "@/stores/use-tabs-store";

// The rule tables Rust serves at start (`rule_tables`), loaded from the conformance corpora that
// write the same tables down: no Tauri backend runs in a test.
import parentingCorpus from "@conformance/parenting.json";
import planCorpus from "@conformance/plan-triage.json";
import { setRuleTables } from "@/utils/rule-tables";
import type { RuleTables } from "@/api/rules";
import type { NodeKind } from "@/utils/tree-layout";

// Only type imports from the app here: a test's own `vi.mock` of a module must still be the first to
// load it, and the setup file runs before it.
const parents: Record<string, readonly string[]> = parentingCorpus.parents;
const kinds: readonly string[] = parentingCorpus.kinds;
/** Whether `value` is one of the corpus's kinds: the corpus is what names them. */
function isCorpusKind(value: string): value is NodeKind {
  return kinds.includes(value);
}
setRuleTables({
  parenting: kinds.filter(isCorpusKind).map((child) => ({
    child,
    parents: kinds.filter(isCorpusKind).filter((parent) => parents[child]?.includes(parent) === true),
  })),
  takeOut: planCorpus.takeOut.map((row): RuleTables["takeOut"][number] => ({
    split: row.split, hasParent: row.hasParent,
    lands: row.lands === "filled" || row.lands === "parent" ? row.lands : "clear",
  })),
});

// jsdom implements no layout, and with it no `ResizeObserver` — which the top bar's breadcrumb
// observes to re-measure when the bar changes width. A stub that never reports a change is the
// honest jsdom equivalent: nothing resizes unless a test installs an observer it can drive.
class NoopResizeObserver implements ResizeObserver {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}
globalThis.ResizeObserver = NoopResizeObserver;
