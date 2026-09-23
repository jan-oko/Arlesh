import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import type { Domain } from "@/api/domains";
import type { CreateEditors } from "@/hooks/use-create-editors";
import { findNode } from "@/utils/mindmap-tree";
import { flowTargetNodes, targetSelectionFor } from "@/utils/flow-target";
import type { MindmapNode } from "@/utils/tree-layout";
import CommitmentEditorModal from "@/components/CommitmentEditorModal/CommitmentEditorModal";
import FlowEditorModal from "@/components/FlowEditorModal/FlowEditorModal";

// A pristine flow used to seed the create editor before the flow is persisted.
const BLANK_FLOW_NODE: MindmapNode = {
  id: "flow-new", kind: "flow", title: "", position: 0,
  flow: { instanceType: "task", targetType: null, targetId: null, durationN: 1, durationKind: "week", windowPart: null, windowTimeStart: null, windowTimeEnd: null, isHabit: false, rootPlanKind: null, rootPlanStart: null, rootPlanEnd: null, verdictWindowN: null, verdictWindowKind: null },
  tagIds: [], children: [],
};

// A pristine commitment used to seed the create editor before the commitment is persisted. It
// carries no Time Scope on purpose: an empty window field is the question Shift+C asks.
const BLANK_COMMITMENT_NODE: MindmapNode = {
  id: "commitment-new", kind: "commitment", title: "", position: 0, tagIds: [], children: [],
};

interface Props {
  tree: MindmapNode;
  editors: CreateEditors;
  allTags: Domain[];
  domainNames: Map<number, string>;
}

/**
 * The blank Flow and Commitment editors that `useCreateEditors` opens — the create-side counterpart
 * of `NodeEditorModals`, shared by every view that takes the creation chords. Strictly rendering:
 * the pending parent and the save path are the hook's.
 */
export default function NodeCreateModals({ tree, editors, allTags, domainNames }: Props) {
  const { t } = useTranslation(["editor"]);
  const { flowParent, commitmentParent, onCreateFlow, onCreateCommitment, closeFlow, closeCommitment } = editors;

  const flowTargets = useMemo(() => flowTargetNodes(tree), [tree]);
  // With no explicit Target Node a new flow's instances fall back to its parent.
  const inheritedTarget = useMemo(
    () => (flowParent === null ? null : targetSelectionFor(findNode(tree, flowParent.id))),
    [flowParent, tree],
  );

  return (
    <>
      {commitmentParent !== null && (
        <CommitmentEditorModal node={BLANK_COMMITMENT_NODE} allTags={allTags} domainNames={domainNames} heading={t("editor:newCommitmentTitle")} onSave={onCreateCommitment} onClose={closeCommitment} />
      )}
      {flowParent !== null && (
        <FlowEditorModal node={BLANK_FLOW_NODE} availableTargets={flowTargets} inheritedTarget={inheritedTarget} heading={t("editor:newFlowTitle")} onSave={onCreateFlow} onClose={closeFlow} />
      )}
    </>
  );
}
