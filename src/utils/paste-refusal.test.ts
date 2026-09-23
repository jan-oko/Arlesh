import { describe, it, expect } from "vitest";
import {
  pasteRefusal, countPasteRefusals, pasteRefusalKey, flowsLeftBehind,
  NAMED_FLOWS_LIMIT, PASTE_REFUSAL, PASTE_REFUSAL_KEY,
} from "./paste-refusal";
import type { FlowUnderRefusal, HereRefusal, PasteRefusal, PasteRefusalReason } from "./paste-refusal";
import { isValidDropTarget, validParentKinds } from "./node-meta";
import type { MindmapNode, NodeKind } from "./tree-layout";
import { ALL_NODE_KINDS } from "./tree-layout";
import warnings from "@/i18n/locales/en/warnings.json";
import i18n from "@/i18n";
import { fixtureRowId } from "@/test/node-fixture";

function mkNode(id: string, kind: NodeKind, children: MindmapNode[] = [], extra: Partial<MindmapNode> = {}): MindmapNode {
  return { id, ...fixtureRowId(id), kind, title: id, position: 0, tagIds: [], children, ...extra };
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
function here(child: NodeKind): HereRefusal {
  return { reason: PASTE_REFUSAL.HERE, child, validParents: validParentKinds(child) };
}

/** One Flow reported as left behind under a copied node. */
function leftBehind(title: string): FlowUnderRefusal {
  return { reason: PASTE_REFUSAL.FLOW_UNDER, title };
}

/** A refusal that reads out as a counted sentence of its own — everything but the destination. */
type CountedReason = Exclude<PasteRefusalReason, typeof PASTE_REFUSAL.HERE>;

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

// The skip that used to be silent. A Flow put on the clipboard is copied; a Flow hanging *under* a
// copied node is not, because the backend's duplication walk never descends into one — so the
// pasted subtree came out smaller than the one that was copied, with nothing said about it.
describe("flowsLeftBehind", () => {
  const HABIT = mkNode("flow-10", "flow", [mkNode("flowtask-11", "flow_task")], { title: "Morning pages" });
  const LIFT = mkNode("flow-12", "flow", [], { title: "Lift" });
  const INNER = mkNode("task-13", "task", [LIFT]);
  const PARENT_GOAL = mkNode("goal-14", "goal", [HABIT, INNER]);
  const BOARD = mkNode("root", "domain", [mkNode("domain-15", "project", [PARENT_GOAL])]);

  it("says nothing when nothing is selected", () => {
    expect(flowsLeftBehind(BOARD, [])).toEqual([]);
  });

  it("names a Flow hanging under the copied node", () => {
    expect(flowsLeftBehind(BOARD, ["goal-14"])).toEqual([leftBehind("Morning pages"), leftBehind("Lift")]);
  });

  it("names a Flow however deep under the copied node it hangs", () => {
    expect(flowsLeftBehind(BOARD, ["task-13"])).toEqual([leftBehind("Lift")]);
  });

  // The Flow itself goes through `duplicate_flow`, which clones the template and its Recurrence.
  // Reporting it as left behind would claim a loss that did not happen.
  it("says nothing about a Flow copied on its own", () => {
    expect(flowsLeftBehind(BOARD, ["flow-10"])).toEqual([]);
  });

  // A Flow *and* its parent on the clipboard: the paste keeps only top-level nodes, so the Flow is
  // taken as part of the parent's subtree — which does not carry it. That is a real loss.
  it("names a selected Flow whose parent was selected too, since only the parent is pasted", () => {
    expect(flowsLeftBehind(BOARD, ["goal-14", "flow-10"])).toEqual([
      leftBehind("Morning pages"), leftBehind("Lift"),
    ]);
  });

  it("reports one Flow once when two selected nodes above it both reach it", () => {
    expect(flowsLeftBehind(BOARD, ["goal-14", "task-13"])).toEqual([
      leftBehind("Morning pages"), leftBehind("Lift"),
    ]);
  });

  // Read off the tree, not off the clipboard, so the sentence does not change with the order the
  // selection happened to be assembled in.
  it("names them in tree order whatever order the clipboard holds", () => {
    expect(flowsLeftBehind(BOARD, ["task-13", "goal-14"])).toEqual(flowsLeftBehind(BOARD, ["goal-14", "task-13"]));
  });

  // A flow item goes wherever its Flow goes, and a Habit's repetitions are drawn from the template
  // rather than stored, so nothing beneath a Flow is separately at risk.
  it("stops at a Flow instead of reporting what hangs inside it", () => {
    expect(flowsLeftBehind(BOARD, ["domain-15"]).map((refusal) => refusal.title))
      .toEqual(["Morning pages", "Lift"]);
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

  // Every left-behind Flow folds into ONE line, never a toast each: the view holds a single
  // pending notice, so a second would overwrite the first and drop a Flow in silence.
  it("folds every left-behind Flow into one line that keeps their names", () => {
    expect(countPasteRefusals([leftBehind("Morning pages"), leftBehind("Lift")])).toEqual([
      { reason: PASTE_REFUSAL.FLOW_UNDER, count: 2, named: ["Morning pages", "Lift"], unnamed: 0 },
    ]);
  });

  // A toast is a viewport strip. A Domain that has collected a year of Habits would fill it with a
  // list nobody reads, so past three the count is what is honest.
  it("names the first few and counts the rest once there are more than a glance takes", () => {
    const many = ["Pages", "Lift", "Read", "Stretch", "Journal"].map(leftBehind);
    expect(countPasteRefusals(many)).toEqual([
      { reason: PASTE_REFUSAL.FLOW_UNDER, count: 5, named: ["Pages", "Lift", "Read"], unnamed: 2 },
    ]);
    expect(NAMED_FLOWS_LIMIT).toBe(3);
  });

  // Composition, which is the whole point of one slot: a paste that trips a destination rule AND
  // leaves a Flow behind says both, in one message.
  it("reports a left-behind Flow beside the other reasons rather than instead of them", () => {
    expect(countPasteRefusals([here("goal"), leftBehind("Lift"), { reason: PASTE_REFUSAL.GONE }])).toEqual([
      { ...here("goal"), count: 1 },
      { reason: PASTE_REFUSAL.FLOW_UNDER, count: 1, named: ["Lift"], unnamed: 0 },
      { reason: PASTE_REFUSAL.GONE, count: 1 },
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
    expect(pasteRefusalKey({ reason: PASTE_REFUSAL.FLOW_UNDER, count: 1, named: ["Lift"], unnamed: 0 }))
      .toBe("pasteSkippedFlowUnder");
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
  // Every reason that reads out as a counted sentence of its own, which is all of them but the
  // destination — the left-behind Flow included: it names the Flows *and* counts them, so its
  // sentence still turns on the count like the rest.
  const nodeRefusals: CountedReason[] = Object.values(PASTE_REFUSAL)
    .filter((reason): reason is CountedReason => reason !== PASTE_REFUSAL.HERE);

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

// The one refusal that names rather than counts, rendered through the real catalogue. A Flow under
// a copied node was never on the clipboard and is invisible in the paste, so "2 Flows weren't
// copied" would leave the user hunting the copy for whatever is missing. The names are the remedy.
describe("the left-behind Flow, rendered", () => {
  function render(titles: readonly string[]): string {
    const line = countPasteRefusals(titles.map(leftBehind))[0];
    if (line === undefined || line.reason !== PASTE_REFUSAL.FLOW_UNDER) throw new Error("no line");
    const flows = line.named.map((title) => i18n.t("warnings:pasteSkippedFlowName", { title }));
    if (line.unnamed > 0) flows.push(i18n.t("warnings:pasteSkippedFlowMore", { count: line.unnamed }));
    return i18n.t(`warnings:${pasteRefusalKey(line)}`, { count: line.count, flows: flows.join(", ") });
  }

  it("names the one Flow it left behind, and says what to do about it", () => {
    expect(render(["Morning pages"])).toBe(
      "1 Flow under what you copied wasn't copied with it — copy “Morning pages” across on its own.",
    );
  });

  it("names several in one sentence rather than one toast each", () => {
    expect(render(["Morning pages", "Lift"])).toBe(
      "2 Flows under what you copied weren't copied with it — copy “Morning pages”, “Lift” across on their own.",
    );
  });

  it("counts the tail once a subtree holds more Habits than a toast can read out", () => {
    expect(render(["Pages", "Lift", "Read", "Stretch", "Journal"])).toBe(
      "5 Flows under what you copied weren't copied with it — copy “Pages”, “Lift”, “Read”, and 2 more across on their own.",
    );
  });
});
