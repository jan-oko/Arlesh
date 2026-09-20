import { describe, it, expect } from "vitest";
import { pasteRefusal, countPasteRefusals, PASTE_REFUSAL, PASTE_REFUSAL_KEY } from "./paste-refusal";
import type { PasteRefusal } from "./paste-refusal";
import type { MindmapNode, NodeKind } from "./tree-layout";
import warnings from "@/i18n/locales/en/warnings.json";

function mkNode(id: string, kind: NodeKind, children: MindmapNode[] = [], extra: Partial<MindmapNode> = {}): MindmapNode {
  return { id, kind, title: id, position: 0, tagIds: [], children, ...extra };
}

const TASK = mkNode("task-5", "task");
const GOAL = mkNode("goal-2", "goal");
const ASPECT = mkNode("aspect-1", "aspect");
const TAG = mkNode("tag-9", "tag");
const COMMITMENT = mkNode("commitment-7", "commitment");
const REPETITION = mkNode("habit-3-0-virtual", "task", [], { virtual: true });
const FLOW_TASK = mkNode("flowtask-4", "flow_task");
const FLOW_ONE = mkNode("flow-1", "flow", [FLOW_TASK]);
const FLOW_TWO = mkNode("flow-2", "flow");
const TREE = mkNode("root", "domain", [
  mkNode("domain-3", "project", [TASK, GOAL, ASPECT, TAG, COMMITMENT, REPETITION, FLOW_ONE, FLOW_TWO]),
]);

describe("pasteRefusal", () => {
  it("allows a task onto a goal, for both cut and copy", () => {
    expect(pasteRefusal(TREE, "task-5", GOAL, true)).toBeNull();
    expect(pasteRefusal(TREE, "task-5", GOAL, false)).toBeNull();
  });

  it("reports a clipboard id that is no longer in the tree as gone, not as a bad destination", () => {
    expect(pasteRefusal(TREE, "task-404", GOAL, true)).toBe(PASTE_REFUSAL.GONE);
  });

  it("reports a Habit repetition as a repetition, not as a bad destination", () => {
    expect(pasteRefusal(TREE, "habit-3-0-virtual", GOAL, true)).toBe(PASTE_REFUSAL.REPETITION);
    expect(pasteRefusal(TREE, "habit-3-0-virtual", GOAL, false)).toBe(PASTE_REFUSAL.REPETITION);
  });

  it("reports an Aspect as an Aspect — no destination would have taken it", () => {
    expect(pasteRefusal(TREE, "aspect-1", GOAL, true)).toBe(PASTE_REFUSAL.ASPECT);
    expect(pasteRefusal(TREE, "aspect-1", TASK, false)).toBe(PASTE_REFUSAL.ASPECT);
  });

  it("reports a kind the target cannot hold as being about here", () => {
    expect(pasteRefusal(TREE, "task-5", TAG, true)).toBe(PASTE_REFUSAL.HERE);
    expect(pasteRefusal(TREE, "task-5", TAG, false)).toBe(PASTE_REFUSAL.HERE);
  });

  it("refuses a copied Commitment but allows the same node to be cut", () => {
    expect(pasteRefusal(TREE, "commitment-7", GOAL, true)).toBe(PASTE_REFUSAL.COMMITMENT);
    expect(pasteRefusal(TREE, "commitment-7", GOAL, false)).toBeNull();
  });

  it("refuses a flow item copied into another Flow but allows it back into its own", () => {
    expect(pasteRefusal(TREE, "flowtask-4", FLOW_TWO, true)).toBe(PASTE_REFUSAL.OTHER_FLOW);
    expect(pasteRefusal(TREE, "flowtask-4", FLOW_ONE, true)).toBeNull();
    expect(pasteRefusal(TREE, "flowtask-4", FLOW_TWO, false)).toBeNull();
  });
});

describe("countPasteRefusals", () => {
  it("returns nothing when nothing was refused", () => {
    expect(countPasteRefusals([])).toEqual([]);
  });

  it("counts repeats of one reason as one entry", () => {
    expect(countPasteRefusals([PASTE_REFUSAL.HERE, PASTE_REFUSAL.HERE, PASTE_REFUSAL.HERE]))
      .toEqual([{ refusal: PASTE_REFUSAL.HERE, count: 3 }]);
  });

  it("orders a mixed selection the same way however it arrived", () => {
    const arrived = [PASTE_REFUSAL.GONE, PASTE_REFUSAL.COMMITMENT, PASTE_REFUSAL.HERE, PASTE_REFUSAL.COMMITMENT];
    expect(countPasteRefusals(arrived)).toEqual([
      { refusal: PASTE_REFUSAL.HERE, count: 1 },
      { refusal: PASTE_REFUSAL.COMMITMENT, count: 2 },
      { refusal: PASTE_REFUSAL.GONE, count: 1 },
    ]);
    expect(countPasteRefusals([...arrived].reverse())).toEqual(countPasteRefusals(arrived));
  });
});

// The wordings are the point of the whole change: a refusal that names the wrong cause sends the
// user to fix something that was never the problem. These pin each one to the thing it names.
describe("the message each refusal produces", () => {
  const refusals: PasteRefusal[] = Object.values(PASTE_REFUSAL);

  it("gives every refusal a singular and a plural of its own", () => {
    const singulars = refusals.map((refusal) => warnings[`${PASTE_REFUSAL_KEY[refusal]}_one`]);
    const plurals = refusals.map((refusal) => warnings[`${PASTE_REFUSAL_KEY[refusal]}_other`]);
    expect(new Set(singulars).size).toBe(refusals.length);
    expect(new Set(plurals).size).toBe(refusals.length);
    expect(singulars.every((message) => message.includes("{{count}}"))).toBe(true);
    expect(plurals.every((message) => message.includes("{{count}}"))).toBe(true);
  });

  it("blames the destination only in the refusal that is actually about the destination", () => {
    // The Aspect message is allowed to say "not here": it exists to deny that here was the problem.
    const blamingHere = refusals.filter((refusal) =>
      warnings[`${PASTE_REFUSAL_KEY[refusal]}_one`].includes("pasted here"),
    );
    expect(blamingHere).toEqual([PASTE_REFUSAL.HERE]);
    expect(warnings.pasteSkippedHere_one).toBe("{{count}} node couldn't be pasted here.");
  });

  it("points a Commitment and a cross-Flow copy at cut, which still works", () => {
    expect(warnings.pasteSkippedCommitment_one).toBe("{{count}} Commitment can't be copied — use cut to move it.");
    expect(warnings.pasteSkippedOtherFlow_one).toBe(
      "{{count}} Flow item can't be copied into a different Flow — use cut to move it.",
    );
  });

  it("sends a repetition to the Habit's template and a stale id back to the clipboard", () => {
    expect(warnings.pasteSkippedRepetition_one).toBe(
      "{{count}} Habit repetition isn't a row of its own, so there is nothing to paste — copy it from the Habit's template instead.",
    );
    expect(warnings.pasteSkippedGone_one).toBe(
      "{{count}} copied node isn't in the mindmap any more — copy it again.",
    );
  });

  it("tells an Aspect it is the Aspect, not the destination", () => {
    expect(warnings.pasteSkippedAspect_one).toBe(
      "{{count}} Aspect can't be moved or copied — not here and not anywhere else.",
    );
  });
});
