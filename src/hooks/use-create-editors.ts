import { useCallback, useState } from "react";
import type { CreateFlowRequest, Flow } from "@/api/flows";
import type { CommitmentSaveData } from "@/components/CommitmentEditorModal/CommitmentEditorModal";
import type { FlowSaveData } from "@/components/FlowEditorModal/FlowEditorModal";
import { findNode } from "@/utils/mindmap-tree";
import type { MindmapNode, NodeKind } from "@/utils/tree-layout";

/** The node a blank Flow or Commitment will be created under, once its editor is saved. */
export interface PendingCreateParent {
  id: string;
  kind: NodeKind;
}

interface Options {
  tree: MindmapNode;
  createFlow: (request: CreateFlowRequest) => Promise<Flow>;
  createCommitment: (parentId: string, parentKind: NodeKind, data: CommitmentSaveData) => Promise<void>;
}

/** The two create editors: which one is open, under what, and how each is saved or closed. */
export interface CreateEditors {
  flowParent: PendingCreateParent | null;
  commitmentParent: PendingCreateParent | null;
  /** Opens a blank Flow editor under `parentId`; the Flow is persisted only on save. */
  onNewFlow: (parentId: string) => void;
  /** Opens a blank Commitment editor under `parentId`; the Commitment is persisted only on save. */
  onNewCommitment: (parentId: string) => void;
  onCreateFlow: (data: FlowSaveData) => Promise<void>;
  onCreateCommitment: (data: CommitmentSaveData) => Promise<void>;
  closeFlow: () => void;
  closeCommitment: () => void;
}

/**
 * **The two kinds that are configured before they exist.** A Flow is its instance type, window and
 * duration, so `Shift+F` opens that editor rather than creating a row to rename; a Commitment is not
 * valid without a window of its own or one above it, so `Shift+C` asks for the window first rather
 * than posting a bare row for the backend to refuse.
 *
 * `useNodeActions` routes both chords here through `onNewFlow` and `onNewCommitment`, so every view
 * that takes the creation chords needs the same pending state and the same save path. It lived in
 * `MindmapView` until the Steps View became the second.
 */
export function useCreateEditors({ tree, createFlow, createCommitment }: Options): CreateEditors {
  const [flowParent, setFlowParent] = useState<PendingCreateParent | null>(null);
  const [commitmentParent, setCommitmentParent] = useState<PendingCreateParent | null>(null);

  const onNewFlow = useCallback(
    (parentId: string) => {
      const parent = findNode(tree, parentId);
      if (parent === undefined) return;
      setFlowParent({ id: parentId, kind: parent.kind });
    },
    [tree],
  );

  const onNewCommitment = useCallback(
    (parentId: string) => {
      const parent = findNode(tree, parentId);
      if (parent === undefined) return;
      setCommitmentParent({ id: parentId, kind: parent.kind });
    },
    [tree],
  );

  // Persists a brand-new flow under the pending parent, then closes the create editor.
  const onCreateFlow = useCallback(
    async (data: FlowSaveData) => {
      if (flowParent === null) return;
      const parentDbId = parseInt(flowParent.id.split("-").pop() ?? "0", 10);
      await createFlow({
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
      });
      setFlowParent(null);
    },
    [flowParent, createFlow],
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
    flowParent, commitmentParent, onNewFlow, onNewCommitment, onCreateFlow, onCreateCommitment,
    closeFlow: () => setFlowParent(null),
    closeCommitment: () => setCommitmentParent(null),
  };
}
