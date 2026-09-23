import type { MindmapNode, NodeKind } from "./tree-layout";
import { ALL_NODE_KINDS } from "./tree-layout";
import { findNode, owningFlowId } from "./mindmap-tree";
import { canAdoptExistingChild, isFlowKind, validParentKinds } from "./node-meta";

/**
 * Why one node on the clipboard cannot be pasted onto a given target.
 *
 * Only one of these is about the destination. A paste used to report every skip with the same
 * "couldn't be pasted here", which sent the user off to find a different parent when the parent was
 * never the problem — the node was an Aspect, or a derived repetition, or a kind that has no copy at
 * all. Each member names a different thing, so each gets a different sentence.
 */
export const PASTE_REFUSAL = {
  /** The id on the clipboard is no longer in the tree — deleted, or filtered out, since the copy. */
  GONE: "gone",
  /** A Habit repetition: worked out from the template at load time, with no row behind it. */
  REPETITION: "repetition",
  /** An Aspect, which is fixed where it is — no destination would have taken it. */
  ASPECT: "aspect",
  /** The one refusal that really is about *here*: this kind cannot live under that parent. */
  HERE: "here",
  /** A COPY of a Commitment: what a copy of a recorded Verdict means has never been decided. */
  COMMITMENT: "commitment",
  /** A COPY of an Expectation: a wait has no duplicate command. */
  EXPECTATION: "expectation",
  /** A wait's check task or a delegated Task's wait: drawn from its owner, with no row behind it. */
  DERIVED_WAIT: "derivedWait",
  /** A COPY of a flow item into another Flow: its Cycle Scope offsets into its own Flow's window. */
  OTHER_FLOW: "otherFlow",
  /**
   * A Flow hanging *underneath* a copied node. The backend's duplication walk does not descend
   * into a Flow (`src-tauri/src/duplicate/mod.rs`), so the pasted subtree is smaller than the one
   * that was copied — the only skip here that is not about a node the user put on the clipboard.
   */
  FLOW_UNDER: "flowUnder",
} as const;

/** Which of the refusals happened. */
export type PasteRefusalReason = (typeof PASTE_REFUSAL)[keyof typeof PASTE_REFUSAL];

/**
 * The destination refusal, carrying what its sentence has to name: the kind that was refused, and
 * every kind that would have taken it.
 *
 * `validParents` is read off `isValidDropTarget` — the same predicate that produced the refusal,
 * turned round by {@link validParentKinds}. The message therefore cannot claim a parentage the drop
 * check does not enforce, which a hand-written table beside it eventually would.
 */
export interface HereRefusal {
  reason: typeof PASTE_REFUSAL.HERE;
  child: NodeKind;
  validParents: readonly NodeKind[];
}

/**
 * One Flow left behind underneath a copied node, carrying its title.
 *
 * It is the one refusal that names a node instead of counting one. Every other skip is about a
 * node the user selected and can still see highlighted, so a count identifies it; a Flow under a
 * copied node was never on the clipboard and is invisible in the paste, so a bare count would
 * leave the user searching the copy for whatever is missing.
 */
export interface FlowUnderRefusal {
  reason: typeof PASTE_REFUSAL.FLOW_UNDER;
  /** The Flow's title, as the sentence reads it out. */
  title: string;
}

/** A refusal about the node itself: no destination would have changed the answer. */
export interface NodeRefusal {
  reason: Exclude<PasteRefusalReason, typeof PASTE_REFUSAL.HERE | typeof PASTE_REFUSAL.FLOW_UNDER>;
}

/** One reason a single node was left behind by a paste. */
export type PasteRefusal = HereRefusal | FlowUnderRefusal | NodeRefusal;

/**
 * The `warnings` key each refusal about the node reports itself with. Every one is pluralised,
 * because each counts the nodes it applies to — the left-behind Flow counts them *and* names them,
 * but the count still governs the sentence.
 *
 * The destination refusal is not in this shape — it picks between two sentences, so it goes
 * through {@link pasteRefusalKey} like the rest.
 */
export const PASTE_REFUSAL_KEY = {
  gone: "pasteSkippedGone",
  repetition: "pasteSkippedRepetition",
  aspect: "pasteSkippedAspect",
  here: "pasteSkippedHere",
  commitment: "pasteSkippedCommitment",
  expectation: "pasteSkippedExpectation",
  derivedWait: "pasteSkippedDerivedWait",
  otherFlow: "pasteSkippedOtherFlow",
  flowUnder: "pasteSkippedFlowUnder",
} as const satisfies Record<PasteRefusalReason, string>;

/** A `warnings` key one refusal line can be said with. */
export type PasteRefusalMessageKey =
  | (typeof PASTE_REFUSAL_KEY)[PasteRefusalReason]
  | "pasteSkippedHereInFlow";

/**
 * How many left-behind Flows one sentence names before it counts the rest as "and N more".
 *
 * Naming is the point — see {@link FlowUnderRefusal} — but a toast is a viewport strip, and a
 * Domain that collects a year of Habits would fill it with a list nobody reads. Three names is
 * what a glance takes; past that the count is the honest summary and the copy itself is where the
 * rest are found.
 */
export const NAMED_FLOWS_LIMIT = 3;

/**
 * Report order, fixed so the same mixed selection always produces the same sentence. Destination
 * first because it is the one the user can act on where they are standing; the stale clipboard last
 * because it is about a gesture already finished. The left-behind Flow sits just above it, since
 * it too is about what the paste has already done rather than about where it was aimed.
 */
const REFUSAL_ORDER: readonly PasteRefusalReason[] = [
  PASTE_REFUSAL.HERE,
  PASTE_REFUSAL.ASPECT,
  PASTE_REFUSAL.REPETITION,
  PASTE_REFUSAL.DERIVED_WAIT,
  PASTE_REFUSAL.COMMITMENT,
  PASTE_REFUSAL.EXPECTATION,
  PASTE_REFUSAL.OTHER_FLOW,
  PASTE_REFUSAL.FLOW_UNDER,
  PASTE_REFUSAL.GONE,
];

/**
 * Why `nodeId` cannot be pasted onto `target`, or `null` when it can.
 *
 * Order matters where a node trips more than one rule: the deeper fact wins. A repetition is
 * reported as a repetition even though its kind would also have been refused by the drop rule, and
 * an Aspect as an Aspect rather than as a destination mismatch, since no destination exists for it.
 */
export function pasteRefusal(
  tree: MindmapNode,
  nodeId: string,
  target: MindmapNode,
  isCopy: boolean,
): PasteRefusal | null {
  const node = findNode(tree, nodeId);
  if (node === undefined) return { reason: PASTE_REFUSAL.GONE };
  if (node.expectationCheck !== undefined || node.delegationWait !== undefined) {
    return { reason: PASTE_REFUSAL.DERIVED_WAIT };
  }
  if (node.virtual === true) return { reason: PASTE_REFUSAL.REPETITION };
  if (node.kind === "aspect") return { reason: PASTE_REFUSAL.ASPECT };
  // Asked of the target **node**, not of its kind: a folded run of Habit history and a virtual
  // occurrence both wear a kind that would say yes. A target that can adopt nothing at all is
  // refused by the caller before this is ever reached, so what is left here really is about kinds.
  if (!canAdoptExistingChild(target, node.kind)) {
    // The rule that said no also says where yes would have been, in the same breath and from the
    // same predicate — so the sentence and the decision cannot drift apart.
    return { reason: PASTE_REFUSAL.HERE, child: node.kind, validParents: validParentKinds(node.kind) };
  }
  // Everything below is about duplication, so a CUT of the same node is fine and says nothing.
  if (!isCopy) return null;
  if (node.kind === "commitment") return { reason: PASTE_REFUSAL.COMMITMENT };
  if (node.kind === "expectation") return { reason: PASTE_REFUSAL.EXPECTATION };
  if (
    (node.kind === "flow_goal" || node.kind === "flow_task") &&
    owningFlowId(tree, nodeId) !== owningFlowId(tree, target.id)
  ) {
    return { reason: PASTE_REFUSAL.OTHER_FLOW };
  }
  return null;
}

/**
 * The Flows a copy of `nodeIds` will leave behind: every Flow with a selected node *above* it.
 *
 * A Flow put on the clipboard directly is copied — `duplicate_flow` clones the template and its
 * Recurrence — but the subtree walk behind a Goal, Task, Project or Domain does not descend into
 * one, so a Habit hanging inside the copied subtree is simply absent from the paste. That is the
 * silent half of the skip this whole vocabulary exists to end, and the only one the selection
 * gives no hint of.
 *
 * Read off the tree rather than off the selection for two reasons. The walk is one pre-order pass
 * from the root, so the same selection always names the Flows in the same order however the
 * clipboard was assembled; and a Flow under *two* selected nodes — a Goal and its Task, both
 * picked — is reached once, so one loss is reported once.
 *
 * The walk stops at a Flow. Nothing under one is separately at risk: a flow item goes wherever its
 * Flow goes, and a Habit's repetitions are drawn from the template rather than stored.
 *
 * Only a **copy** loses them. A cut re-points one parent link and the whole subtree follows, Flows
 * included, so the caller asks this only when the clipboard holds a copy.
 */
export function flowsLeftBehind(tree: MindmapNode, nodeIds: readonly string[]): FlowUnderRefusal[] {
  const selected = new Set(nodeIds);
  const leftBehind: FlowUnderRefusal[] = [];
  const walk = (node: MindmapNode, underACopiedNode: boolean): void => {
    if (node.kind === "flow") {
      if (underACopiedNode) leftBehind.push({ reason: PASTE_REFUSAL.FLOW_UNDER, title: node.title });
      return;
    }
    const inside = underACopiedNode || selected.has(node.id);
    for (const child of node.children) walk(child, inside);
  };
  walk(tree, false);
  return leftBehind;
}

/**
 * Every Flow one paste left behind, folded into a single line the sentence can read out.
 *
 * It is the one line that carries titles rather than a count alone, and the only one whose
 * contents can outgrow a toast — hence the split between the names it says and the number it
 * only counts. `unnamed` is `0` whenever the line names them all.
 */
export interface FlowUnderCount {
  reason: typeof PASTE_REFUSAL.FLOW_UNDER;
  /** How many Flows were left behind altogether, named or not. */
  count: number;
  /** The titles the sentence reads out, at most {@link NAMED_FLOWS_LIMIT} of them. */
  named: readonly string[];
  /** How many more there were than the sentence names. */
  unnamed: number;
}

/** One refusal and how many of the pasted nodes hit it. */
export type PasteRefusalCount =
  | (HereRefusal & { count: number })
  | (NodeRefusal & { count: number })
  | FlowUnderCount;

/**
 * The refusals a paste collected, counted and in report order. Reasons nothing hit are dropped, so
 * an all-legal paste reports nothing at all.
 */
export function countPasteRefusals(refusals: readonly PasteRefusal[]): PasteRefusalCount[] {
  const counts: PasteRefusalCount[] = [];
  for (const reason of REFUSAL_ORDER) {
    if (reason === PASTE_REFUSAL.HERE) {
      counts.push(...countByRefusedKind(refusals));
      continue;
    }
    if (reason === PASTE_REFUSAL.FLOW_UNDER) {
      const line = countLeftBehindFlows(refusals);
      if (line !== null) counts.push(line);
      continue;
    }
    const count = refusals.filter((candidate) => candidate.reason === reason).length;
    if (count > 0) counts.push({ reason, count });
  }
  return counts;
}

/**
 * The left-behind Flows as one line, or `null` when none were left behind.
 *
 * The cap is applied here rather than where the sentence is built, so the decision about how much
 * a toast can say lives beside the reason it is being said at all.
 */
function countLeftBehindFlows(refusals: readonly PasteRefusal[]): FlowUnderCount | null {
  const titles = refusals
    .filter((candidate): candidate is FlowUnderRefusal => candidate.reason === PASTE_REFUSAL.FLOW_UNDER)
    .map((candidate) => candidate.title);
  if (titles.length === 0) return null;
  return {
    reason: PASTE_REFUSAL.FLOW_UNDER,
    count: titles.length,
    named: titles.slice(0, NAMED_FLOWS_LIMIT),
    unnamed: Math.max(0, titles.length - NAMED_FLOWS_LIMIT),
  };
}

/**
 * Destination refusals, a line per kind refused.
 *
 * Folding them into one count is the swallowing this whole message exists to undo: the rule that
 * refuses a Goal under a Task is not the rule that refuses a Project under one, and a single
 * "2 nodes couldn't be pasted here" would state a rule true of neither. Ordered by
 * {@link ALL_NODE_KINDS} so one selection always reads the same way, however it was assembled.
 */
function countByRefusedKind(refusals: readonly PasteRefusal[]): PasteRefusalCount[] {
  const here = refusals.filter(
    (candidate): candidate is HereRefusal => candidate.reason === PASTE_REFUSAL.HERE,
  );
  const lines: PasteRefusalCount[] = [];
  for (const child of ALL_NODE_KINDS) {
    const ofKind = here.filter((candidate) => candidate.child === child);
    const first = ofKind[0];
    if (first === undefined) continue;
    lines.push({ ...first, count: ofKind.length });
  }
  return lines;
}

/**
 * Which sentence one refusal line reads out.
 *
 * A destination refusal has two, because listing a flow item's legal parents would print the labels
 * real nodes already use — "only under Flow, Goal, Task" — and so produce "a Task can't sit under a
 * Task", which the app contradicts everywhere else. A flow item is told about its Flow instead. The
 * test for that is the parents the rule handed back, never a second list of which kinds are flow
 * kinds: if the drop rule ever lets a flow item out of its Flow, the sentence follows it.
 */
export function pasteRefusalKey(line: PasteRefusalCount): PasteRefusalMessageKey {
  if (line.reason !== PASTE_REFUSAL.HERE) return PASTE_REFUSAL_KEY[line.reason];
  const onlyInsideAFlow = line.validParents.length > 0 && line.validParents.every(isFlowKind);
  return onlyInsideAFlow ? "pasteSkippedHereInFlow" : PASTE_REFUSAL_KEY.here;
}
