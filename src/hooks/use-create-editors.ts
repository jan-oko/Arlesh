import { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import { storedId } from "@/api/node-id";
import { setFlowRecurrence } from "@/api/flows";
import type { CreateFlowRequest, Flow } from "@/api/flows";
import { withAtomicGesture } from "@/api/gesture";
import { recurrenceRequest } from "@/components/FlowEditorModal/recurrence-ui";
import type { CommitmentSaveData } from "@/components/CommitmentEditorModal/CommitmentEditorModal";
import type { FlowSaveData } from "@/components/FlowEditorModal/FlowEditorModal";
import { findNode } from "@/utils/mindmap-tree";
import { rowIdOfNodeId } from "@/utils/node-identity";
import type { MindmapNode, NodeKind } from "@/utils/tree-layout";

/** The node a blank Flow or Commitment will be created under, once its editor is saved. */
export interface PendingCreateParent {
  id: string;
  kind: NodeKind;
}

/** The node a blank Flow will be created under, and whether its editor opens as a Habit. */
export interface PendingFlowParent extends PendingCreateParent {
  /** Shift+H: the editor opens with repeating already switched on. */
  asHabit: boolean;
}

interface Options {
  tree: MindmapNode;
  createFlow: (request: CreateFlowRequest) => Promise<Flow>;
  createCommitment: (parentId: string, parentKind: NodeKind, data: CommitmentSaveData) => Promise<void>;
  /** Reloads the board — a new Habit's Recurrence is written after the reload `createFlow` does. */
  reload: () => Promise<void>;
}

/** The two create editors: which one is open, under what, and how each is saved or closed. */
export interface CreateEditors {
  flowParent: PendingFlowParent | null;
  commitmentParent: PendingCreateParent | null;
  /** Opens a blank Flow editor under `parentId`; the Flow is persisted only on save. */
  onNewFlow: (parentId: string) => void;
  /** Opens the blank Flow editor under `parentId` with repeating switched on — a new Habit. */
  onNewHabit: (parentId: string) => void;
  /** Opens a blank Commitment editor under `parentId`; the Commitment is persisted only on save. */
  onNewCommitment: (parentId: string) => void;
  onCreateFlow: (data: FlowSaveData) => Promise<void>;
  onCreateCommitment: (data: CommitmentSaveData) => Promise<void>;
  closeFlow: () => void;
  closeCommitment: () => void;
}

/**
 * **The two kinds that are configured before they exist.** A Flow is its instance type, window and
 * duration, so `Shift+F` opens that editor rather than creating a row to rename — and `Shift+H` the
 * same editor with repeating switched on, since a Habit is a Flow that repeats; a Commitment is not
 * valid without a window of its own or one above it, so `Shift+C` asks for the window first rather
 * than posting a bare row for the backend to refuse.
 *
 * `useNodeActions` routes both chords here through `onNewFlow` and `onNewCommitment`, so every view
 * that takes the creation chords needs the same pending state and the same save path. It lived in
 * `MindmapView` until the Steps View became the second.
 */
export function useCreateEditors({ tree, createFlow, createCommitment, reload }: Options): CreateEditors {
  const { t } = useTranslation("undo");
  const [flowParent, setFlowParent] = useState<PendingFlowParent | null>(null);
  const [commitmentParent, setCommitmentParent] = useState<PendingCreateParent | null>(null);

  const openFlowEditor = useCallback(
    (parentId: string, asHabit: boolean) => {
      const parent = findNode(tree, parentId);
      if (parent === undefined) return;
      setFlowParent({ id: parentId, kind: parent.kind, asHabit });
    },
    [tree],
  );
  const onNewFlow = useCallback((parentId: string) => openFlowEditor(parentId, false), [openFlowEditor]);
  const onNewHabit = useCallback((parentId: string) => openFlowEditor(parentId, true), [openFlowEditor]);

  const onNewCommitment = useCallback(
    (parentId: string) => {
      const parent = findNode(tree, parentId);
      if (parent === undefined) return;
      setCommitmentParent({ id: parentId, kind: parent.kind });
    },
    [tree],
  );

  // Persists a brand-new flow under the pending parent, then closes the create editor. A new Habit
  // is two writes — the flow, then its Recurrence — made one all-or-nothing gesture, so a refused
  // Recurrence leaves no plain Flow behind and one Ctrl+Z takes the Habit back whole.
  const onCreateFlow = useCallback(
    async (data: FlowSaveData) => {
      if (flowParent === null) return;
      const parentDbId = storedId(rowIdOfNodeId(tree, flowParent.id));
      const request: CreateFlowRequest = {
        title: data.title,
        instance_type: data.instanceType,
        parent_type: flowParent.kind,
        parent_id: parentDbId,
        target_type: data.targetType,
        target_id: data.targetId,
        flow_duration_n: data.durationN,
        flow_duration_kind: data.durationKind,
        flow_window_part: data.windowPart,
        flow_window_time_start: data.windowTimeStart,
        flow_window_time_end: data.windowTimeEnd,
        root_plan_kind: data.rootPlanKind,
        root_plan_start: data.rootPlanStart,
        root_plan_end: data.rootPlanEnd,
        verdict_window_n: data.verdictWindowN,
        verdict_window_kind: data.verdictWindowKind,
        is_private: data.isPrivate,
      };
      const recurrence = data.recurrence ?? null;
      if (recurrence === null) {
        await createFlow(request);
        setFlowParent(null);
        return;
      }
      try {
        await withAtomicGesture(t("gestures.newHabit"), async () => {
          const flow = await createFlow(request);
          await setFlowRecurrence(flow.id, recurrenceRequest(recurrence, data.durationKind));
        });
      } finally {
        await reload();
      }
      setFlowParent(null);
    },
    [flowParent, createFlow, reload, t, tree],
  );

  // Persists a brand-new commitment under the pending parent, then closes the create editor. A
  // refusal — a commitment with no window of its own and none above it — is left to propagate, so
  // the editor shows it and stays open on the fields that would answer it.
  const onCreateCommitment = useCallback(
    async (data: CommitmentSaveData) => {
      if (commitmentParent === null) return;
      await createCommitment(commitmentParent.id, commitmentParent.kind, data);
      setCommitmentParent(null);
    },
    [commitmentParent, createCommitment],
  );

  return {
    flowParent, commitmentParent, onNewFlow, onNewHabit, onNewCommitment, onCreateFlow, onCreateCommitment,
    closeFlow: () => setFlowParent(null),
    closeCommitment: () => setCommitmentParent(null),
  };
}
