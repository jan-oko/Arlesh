import { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  setHabitInstanceBlockReason,
  setHabitInstanceArchived,
  setHabitInstanceDependencies,
  setHabitInstancePlan,
  setHabitInstanceTitle,
} from "@/api/flows";
import type { FlowItemRef, OccurrenceKey, PlanOverride } from "@/api/flows";
import { withAtomicGesture } from "@/api/gesture";
import type { MindmapNode } from "@/utils/tree-layout";

/** Another item of the same Habit, as the dependency list offers it. */
export interface FlowItemOption {
  ref: FlowItemRef;
  title: string;
}

/** The Habit occurrence whose editor is open. */
export interface OccurrenceEditorTarget {
  node: MindmapNode;
  key: OccurrenceKey;
  /** What it could wait on: every other item drawn in the same iteration. */
  candidates: FlowItemOption[];
}

/** Everything the occurrence editor saves, as the editor holds it. */
export interface OccurrenceEdits {
  /** The title as typed. The template's own title, or nothing, means "the template's". */
  title: string;
  /** The block reason as typed; empty means none. */
  blockedReason: string;
  /** The Plan — only a task occurrence has one. */
  plan: PlanOverride;
  /** What it waits on — only a task occurrence waits. */
  dependsOn: FlowItemRef[];
}

/** One backend write an editor save needs. */
export type OccurrenceWrite =
  | { field: "title"; value: string | null }
  | { field: "blockedReason"; value: string | null }
  | { field: "plan"; value: PlanOverride }
  | { field: "dependsOn"; value: FlowItemRef[] };

/**
 * The occurrence a node is, when it is a Habit occurrence: an item's, or the iteration root — which
 * for a Habit with no items is the occurrence. Both are edited on their own.
 */
export function editableOccurrence(node: MindmapNode): OccurrenceKey | null {
  return node.habitItem ?? null;
}

/** Which of the three states an occurrence's Plan is in now. */
export function currentPlanOverride(node: MindmapNode): PlanOverride {
  if (node.planOverridden !== true) return { kind: "inherit" };
  if (node.plan == null) return { kind: "unplanned" };
  return { kind: "planned", plan: node.plan };
}

/** What the editor opens on: the occurrence as it stands. */
export function currentEdits(node: MindmapNode): OccurrenceEdits {
  return {
    title: node.title,
    blockedReason: node.occurrence?.blockedReason ?? "",
    plan: currentPlanOverride(node),
    dependsOn: node.occurrence?.dependsOn ?? [],
  };
}

function refKey(ref: FlowItemRef): string {
  return `${ref.item_type}-${ref.item_id}`;
}

function sameRefs(a: readonly FlowItemRef[], b: readonly FlowItemRef[]): boolean {
  const left = a.map(refKey).sort();
  const right = b.map(refKey).sort();
  return left.length === right.length && left.every((key, index) => key === right[index]);
}

function samePlan(a: PlanOverride, b: PlanOverride): boolean {
  if (a.kind !== "planned" || b.kind !== "planned") return a.kind === b.kind;
  return a.plan.start_id === b.plan.start_id && a.plan.end_id === b.plan.end_id;
}

/** Empty (after trimming) reads as "none". */
function textOrNull(value: string): string | null {
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

/**
 * The writes a save needs: one per field that changed, and none for a field left as it was. A
 * title typed back to the template's is sent as `null`, which is the template's again.
 */
export function pendingWrites(node: MindmapNode, edits: OccurrenceEdits): OccurrenceWrite[] {
  const before = currentEdits(node);
  const writes: OccurrenceWrite[] = [];
  const title = textOrNull(edits.title);
  const templateTitle = node.occurrence?.templateTitle ?? node.title;
  if ((title ?? templateTitle) !== (textOrNull(before.title) ?? templateTitle)) {
    writes.push({ field: "title", value: title === templateTitle ? null : title });
  }
  if (textOrNull(edits.blockedReason) !== textOrNull(before.blockedReason)) {
    writes.push({ field: "blockedReason", value: textOrNull(edits.blockedReason) });
  }
  if (node.kind === "task" && !samePlan(edits.plan, before.plan)) {
    writes.push({ field: "plan", value: edits.plan });
  }
  // Only an item's occurrence waits on anything; an iteration root takes no part in its
  // template's dependency graph.
  const isItem = node.habitItem !== undefined && node.habitItem.itemType !== "flow_root";
  if (node.kind === "task" && isItem && !sameRefs(edits.dependsOn, before.dependsOn)) {
    writes.push({ field: "dependsOn", value: edits.dependsOn });
  }
  return writes;
}

function send(key: OccurrenceKey, write: OccurrenceWrite): Promise<void> {
  switch (write.field) {
    case "title":
      return setHabitInstanceTitle(key, write.value);
    case "blockedReason":
      return setHabitInstanceBlockReason(key, write.value);
    case "plan":
      return setHabitInstancePlan(key, write.value);
    case "dependsOn":
      return setHabitInstanceDependencies(key, write.value);
  }
}

/** Every node in the tree, depth-first. */
function everyNode(root: MindmapNode): MindmapNode[] {
  const found: MindmapNode[] = [];
  const visit = (node: MindmapNode): void => {
    found.push(node);
    for (const child of node.children) visit(child);
  };
  visit(root);
  return found;
}

/**
 * The other items of the occurrence's Habit that it could wait on, as drawn in the same iteration
 * — one entry per item, however many occurrences it has, since a dependency is an item's.
 */
export function occurrenceCandidates(tree: MindmapNode, key: OccurrenceKey): FlowItemOption[] {
  const options = new Map<string, FlowItemOption>();
  for (const node of everyNode(tree)) {
    const item = node.habitItem;
    if (item === undefined || item.flowId !== key.flowId || item.scopeId !== key.scopeId) continue;
    if (item.itemType === "flow_root") continue;
    if (item.itemType === key.itemType && item.itemId === key.itemId) continue;
    const ref: FlowItemRef = { item_type: item.itemType, item_id: item.itemId };
    if (!options.has(refKey(ref))) {
      options.set(refKey(ref), { ref, title: node.occurrence?.templateTitle ?? node.title });
    }
  }
  return [...options.values()];
}

export interface OccurrenceEditorHandles {
  /** The occurrence being edited, or `null` when the editor is shut. */
  target: OccurrenceEditorTarget | null;
  /** Opens the editor on `node` if it is an editable occurrence; reports whether it did. */
  open: (node: MindmapNode) => boolean;
  close: () => void;
  /** Writes what changed, as one undo step, and reloads. A refusal rejects, for the editor. */
  save: (edits: OccurrenceEdits) => Promise<void>;
  /** Archives the occurrence by hand, or unarchives it; one undo step. */
  setArchived: (archived: boolean) => Promise<void>;
}

/**
 * Editing one Habit occurrence on its own. A save is **one Gesture** however many fields it
 * touches, so one Ctrl+Z takes the whole edit back — and a refusal part-way takes back what the
 * save had already written.
 */
export function useOccurrenceEditor(
  tree: MindmapNode,
  reload: () => Promise<void>,
): OccurrenceEditorHandles {
  const { t } = useTranslation("undo");
  const [target, setTarget] = useState<OccurrenceEditorTarget | null>(null);

  const open = useCallback(
    (node: MindmapNode): boolean => {
      const key = editableOccurrence(node);
      if (key === null) return false;
      const candidates = key.itemType === "flow_root" ? [] : occurrenceCandidates(tree, key);
      setTarget({ node, key, candidates });
      return true;
    },
    [tree],
  );

  const close = useCallback(() => setTarget(null), []);

  const save = useCallback(
    async (edits: OccurrenceEdits): Promise<void> => {
      if (target === null) return;
      const writes = pendingWrites(target.node, edits);
      if (writes.length > 0) {
        await withAtomicGesture(t("gestures.editOccurrence"), async () => {
          for (const write of writes) await send(target.key, write);
        });
      }
      setTarget(null);
      if (writes.length > 0) await reload();
    },
    [target, reload, t],
  );

  const setArchived = useCallback(
    async (archived: boolean): Promise<void> => {
      if (target === null) return;
      await setHabitInstanceArchived(target.key, archived);
      setTarget(null);
      await reload();
    },
    [target, reload],
  );

  return { target, open, close, save, setArchived };
}
