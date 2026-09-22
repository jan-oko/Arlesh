import { describe, it, expect } from "vitest";
import { pasteRefusal, countPasteRefusals, pasteRefusalKey, PASTE_REFUSAL, PASTE_REFUSAL_KEY } from "./paste-refusal";
import type { NodeRefusal, PasteRefusal } from "./paste-refusal";
import { isValidDropTarget, validParentKinds } from "./node-meta";
import type { MindmapNode, NodeKind } from "./tree-layout";
import { ALL_NODE_KINDS } from "./tree-layout";
import warnings from "@/i18n/locales/en/warnings.json";
import i18n from "@/i18n";

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
const PROJECT = mkNode("domain-3", "project", [TASK, GOAL, ASPECT, TAG, COMMITMENT, REPETITION, FLOW_ONE, FLOW_TWO]);
const TREE = mkNode("root", "domain", [PROJECT]);

/** A destination refusal for `child`, carrying the parents the rule itself would have accepted. */
function here(child: NodeKind): PasteRefusal {
  return { reason: PASTE_REFUSAL.HERE, child, validParents: validParentKinds(child) };
}

describe("pasteRefusal", () => {
  it("allows a task onto a goal, for both cut and copy", () => {
    expect(pasteRefusal(TREE, "task-5", GOAL, true)).toBeNull();
    expect(pasteRefusal(TREE, "task-5", GOAL, false)).toBeNull();
  });

  it("reports a clipboard id that is no longer in the tree as gone, not as a bad destination", () => {
    expect(pasteRefusal(TREE, "task-404", GOAL, true)).toEqual({ reason: PASTE_REFUSAL.GONE });
  });

  it("reports a Habit repetition as a repetition, not as a bad destination", () => {
    expect(pasteRefusal(TREE, "habit-3-0-virtual", GOAL, true)).toEqual({ reason: PASTE_REFUSAL.REPETITION });
    expect(pasteRefusal(TREE, "habit-3-0-virtual", GOAL, false)).toEqual({ reason: PASTE_REFUSAL.REPETITION });
  });

  it("reports an Aspect as an Aspect — no destination would have taken it", () => {
    expect(pasteRefusal(TREE, "aspect-1", GOAL, true)).toEqual({ reason: PASTE_REFUSAL.ASPECT });
    expect(pasteRefusal(TREE, "aspect-1", TASK, false)).toEqual({ reason: PASTE_REFUSAL.ASPECT });
  });

  it("refuses a copied Commitment but allows the same node to be cut", () => {
    expect(pasteRefusal(TREE, "commitment-7", GOAL, true)).toEqual({ reason: PASTE_REFUSAL.COMMITMENT });
    expect(pasteRefusal(TREE, "commitment-7", GOAL, false)).toBeNull();
  });

  it("refuses a flow item copied into another Flow but allows it back into its own", () => {
    expect(pasteRefusal(TREE, "flowtask-4", FLOW_TWO, true)).toEqual({ reason: PASTE_REFUSAL.OTHER_FLOW });
    expect(pasteRefusal(TREE, "flowtask-4", FLOW_ONE, true)).toBeNull();
    expect(pasteRefusal(TREE, "flowtask-4", FLOW_TWO, false)).toBeNull();
  });
});

// The refusal this change is about. It used to be the only one that said nothing: "1 node couldn't
// be pasted here" named neither the thing refused nor the rule that refused it. The decision now
// hands both back — the kind, and the parents `isValidDropTarget` *would* have accepted, read off
// the same predicate — so the sentence cannot claim a parentage the drop check does not enforce.
describe("pasteRefusal — the destination refusal", () => {
  it("names the Goal and the parents a Goal may have, when a Goal is pasted onto a Task", () => {
    expect(pasteRefusal(TREE, "goal-2", TASK, true)).toEqual({
      reason: PASTE_REFUSAL.HERE,
      child: "goal",
      validParents: ["aspect", "domain", "project", "goal"],
    });
  });

  it("names the Project and its two legal parents, when a Project is pasted onto a Goal", () => {
    expect(pasteRefusal(TREE, "domain-3", GOAL, true)).toEqual({
      reason: PASTE_REFUSAL.HERE,
      child: "project",
      validParents: ["aspect", "project"],
    });
  });

  it("names the Tag, which a Goal cannot hold", () => {
    expect(pasteRefusal(TREE, "tag-9", GOAL, true)).toEqual(here("tag"));
  });

  it("names the Flow item and the Flow kinds it belongs under, pasted onto a real node", () => {
    expect(pasteRefusal(TREE, "flowtask-4", TASK, true)).toEqual({
      reason: PASTE_REFUSAL.HERE,
      child: "flow_task",
      validParents: ["flow", "flow_goal", "flow_task"],
    });
  });

  it("names the Flow, which a Task cannot hold", () => {
    expect(pasteRefusal(TREE, "flow-1", TASK, true)).toEqual({
      reason: PASTE_REFUSAL.HERE,
      child: "flow",
      validParents: ["aspect", "domain", "project", "goal"],
    });
  });

  // The enumeration, taken from the rule rather than from a guess about which pairs exist: for
  // every kind that can reach the drop check and every kind it can be dropped on, the refusal has
  // to agree with `isValidDropTarget` and list exactly the parents `validParentKinds` lists.
  // Aspects never reach it (answered by kind) and nor does a folded Habit history, which is always
  // virtual and so is answered as a repetition.
  const DROPPABLE: readonly NodeKind[] = ALL_NODE_KINDS.filter(
    (kind) => kind !== "aspect" && kind !== "habit_group",
  );

  it.each(DROPPABLE)("agrees with the drop rule for every destination, pasting a %s", (child) => {
    const source = mkNode(`${child}-42`, child);
    const tree = mkNode("root", "domain", [mkNode("domain-3", "project", [source])]);
    for (const parentKind of ALL_NODE_KINDS) {
      // A CUT, so the copy-only refusals stay out of the way and the drop rule is what answers.
      const refusal = pasteRefusal(tree, source.id, mkNode(`${parentKind}-1`, parentKind), false);
      if (isValidDropTarget(child, parentKind)) {
        expect(refusal).toBeNull();
        continue;
      }
      expect(refusal).toEqual({ reason: PASTE_REFUSAL.HERE, child, validParents: validParentKinds(child) });
    }
  });
});

describe("countPasteRefusals", () => {
  it("returns nothing when nothing was refused", () => {
    expect(countPasteRefusals([])).toEqual([]);
  });

  it("counts repeats of one reason as one entry", () => {
    expect(countPasteRefusals([here("goal"), here("goal"), here("goal")]))
      .toEqual([{ ...here("goal"), count: 3 }]);
  });

  it("orders a mixed selection the same way however it arrived", () => {
    const arrived: PasteRefusal[] = [
      { reason: PASTE_REFUSAL.GONE },
      { reason: PASTE_REFUSAL.COMMITMENT },
      here("goal"),
      { reason: PASTE_REFUSAL.COMMITMENT },
    ];
    expect(countPasteRefusals(arrived)).toEqual([
      { ...here("goal"), count: 1 },
      { reason: PASTE_REFUSAL.COMMITMENT, count: 2 },
      { reason: PASTE_REFUSAL.GONE, count: 1 },
    ]);
    expect(countPasteRefusals([...arrived].reverse())).toEqual(countPasteRefusals(arrived));
  });

  // Grouping is where a reason gets swallowed. Two kinds refused by one destination are two
  // different rules — a Goal may not sit under a Task; a Project may sit under nothing but an
  // Aspect or a Project — so folding them into a single count would state a rule true of neither.
  it("gives each refused kind its own line rather than one count over all of them", () => {
    expect(countPasteRefusals([here("goal"), here("tag"), here("goal")])).toEqual([
      { ...here("goal"), count: 2 },
      { ...here("tag"), count: 1 },
    ]);
  });

  it("orders the destination lines by kind, so the same selection reads the same way", () => {
    const mixed: PasteRefusal[] = [here("tag"), here("project"), here("goal")];
    expect(countPasteRefusals(mixed).map((line) => (line.reason === PASTE_REFUSAL.HERE ? line.child : null)))
      .toEqual(["project", "goal", "tag"]);
    expect(countPasteRefusals([...mixed].reverse())).toEqual(countPasteRefusals(mixed));
  });
});

describe("pasteRefusalKey", () => {
  it("gives every refusal about the node its own sentence", () => {
    expect(pasteRefusalKey({ reason: PASTE_REFUSAL.GONE, count: 1 })).toBe("pasteSkippedGone");
    expect(pasteRefusalKey({ reason: PASTE_REFUSAL.ASPECT, count: 2 })).toBe("pasteSkippedAspect");
    expect(pasteRefusalKey({ reason: PASTE_REFUSAL.COMMITMENT, count: 1 })).toBe("pasteSkippedCommitment");
  });

  it("uses the parent-kinds sentence for a real node", () => {
    expect(pasteRefusalKey({ ...here("goal"), count: 1 })).toBe("pasteSkippedHere");
    expect(pasteRefusalKey({ ...here("flow"), count: 1 })).toBe("pasteSkippedHere");
  });

  // Listing a flow item's legal parents would read "only under Flow, Goal, Task" — the same two
  // labels real nodes use — and produce "a Task can't sit under a Task", which the app contradicts
  // everywhere else. A flow item is told about its Flow instead. Read off the parents the rule
  // handed back, never off a second list of which kinds are flow kinds.
  it("tells a flow item about its Flow rather than listing labels it shares with real nodes", () => {
    expect(pasteRefusalKey({ ...here("flow_task"), count: 1 })).toBe("pasteSkippedHereInFlow");
    expect(pasteRefusalKey({ ...here("flow_goal"), count: 3 })).toBe("pasteSkippedHereInFlow");
  });
});

// The wordings are the point of the whole change: a refusal that names the wrong cause sends the
// user to fix something that was never the problem. These pin each one to the thing it names.
describe("the message each refusal produces", () => {
  const nodeRefusals: NodeRefusal["reason"][] = Object.values(PASTE_REFUSAL)
    .filter((reason): reason is NodeRefusal["reason"] => reason !== PASTE_REFUSAL.HERE);

  it("gives every refusal about the node a singular and a plural of its own", () => {
    const singulars = nodeRefusals.map((reason) => warnings[`${PASTE_REFUSAL_KEY[reason]}_one`]);
    const plurals = nodeRefusals.map((reason) => warnings[`${PASTE_REFUSAL_KEY[reason]}_other`]);
    expect(new Set(singulars).size).toBe(nodeRefusals.length);
    expect(new Set(plurals).size).toBe(nodeRefusals.length);
    expect(singulars.every((message) => message.includes("{{count}}"))).toBe(true);
    expect(plurals.every((message) => message.includes("{{count}}"))).toBe(true);
  });

  // The parent-kinds sentence needs no plural of its own: the noun it counts is the node kind,
  // which carries its own plural in `nodeKinds`, so the frame reads the same either way.
  it("blames the destination only in the refusals that are actually about the destination", () => {
    const blamingHere = nodeRefusals.filter((reason) =>
      warnings[`${PASTE_REFUSAL_KEY[reason]}_one`].includes("can't sit under"),
    );
    expect(blamingHere).toEqual([]);
    expect(warnings.pasteSkippedHere).toBe(
      "{{count}} {{child}} can't sit under {{parent}} — only under {{parents}}.",
    );
    expect(warnings.pasteSkippedHereInFlow_one).toBe(
      "{{count}} {{child}} belongs inside its Flow — it can't sit under {{parent}}.",
    );
    expect(warnings.pasteSkippedHereInFlow_other).toBe(
      "{{count}} {{child}} belong inside their Flow — they can't sit under {{parent}}.",
    );
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

// Rendered through the real catalogue, because the sentence is the deliverable: the kind, the
// destination and the parents that would have worked all have to come out as English.
describe("the destination refusal, rendered", () => {
  function render(child: NodeKind, parent: NodeKind, count: number): string {
    return i18n.t(`warnings:${pasteRefusalKey({ ...here(child), count })}`, {
      count,
      child: i18n.t(`nodeKinds:${child}`, { count }),
      parent: i18n.t(`nodeKinds:${parent}`),
      parents: validParentKinds(child).map((kind) => i18n.t(`nodeKinds:${kind}`)).join(", "),
    });
  }

  it("names a single Goal refused by a Task", () => {
    expect(render("goal", "task", 1)).toBe(
      "1 Goal can't sit under Task — only under Aspect, Domain, Project, Goal.",
    );
  });

  it("pluralises the kind it counts", () => {
    expect(render("goal", "task", 3)).toBe(
      "3 Goals can't sit under Task — only under Aspect, Domain, Project, Goal.",
    );
  });

  it("names a Project refused by a Domain", () => {
    expect(render("project", "domain", 1)).toBe("1 Project can't sit under Domain — only under Aspect, Project.");
  });

  it("names a Domain refused by a Goal", () => {
    expect(render("domain", "goal", 2)).toBe(
      "2 Domains can't sit under Goal — only under Aspect, Domain, Project.",
    );
  });

  it("names a Tag refused by a Goal", () => {
    expect(render("tag", "goal", 1)).toBe("1 Tag can't sit under Goal — only under Aspect, Domain, Project.");
  });

  it("names a Task refused by a Tag, which holds only notes", () => {
    expect(render("task", "tag", 1)).toBe(
      "1 Task can't sit under Tag — only under Aspect, Domain, Project, Goal, Task, Commitment.",
    );
  });

  it("names a Commitment refused by an Info", () => {
    expect(render("commitment", "info", 1)).toBe(
      "1 Commitment can't sit under Info — only under Aspect, Domain, Project, Goal, Task, Commitment.",
    );
  });

  // An Info may sit under a Tag, so a Tag is one of the places the sentence has to offer. The
  // Task and Goal refusals above still end without one: a label holds notes and nothing else.
  it("names a Tag among the parents an Info may have", () => {
    expect(render("info", "flow", 1)).toBe(
      "1 Info can't sit under Flow — only under Aspect, Domain, Project, Goal, Task, Commitment, Info, Tag.",
    );
  });

  it("names a Flow refused by a Task", () => {
    expect(render("flow", "task", 1)).toBe("1 Flow can't sit under Task — only under Aspect, Domain, Project, Goal.");
  });

  it("sends a flow item back inside its Flow instead of listing labels real nodes share", () => {
    expect(render("flow_task", "task", 1)).toBe("1 Task belongs inside its Flow — it can't sit under Task.");
    expect(render("flow_goal", "domain", 2)).toBe("2 Goals belong inside their Flow — they can't sit under Domain.");
  });
});
