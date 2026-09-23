import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import type { MindmapNode } from "@/utils/tree-layout";
import type { NodeEditorHandles } from "@/components/MindmapView/use-node-editor";
import { findParent } from "@/utils/mindmap-tree";
import { allFlowItemNodes, flowTargetNodes, targetSelectionFor } from "@/utils/flow-target";
import { hasNodeEditor } from "@/utils/node-meta";
import { BEADS_NODE_TYPE } from "@/api/beads";
import TaskEditorModal from "@/components/TaskEditorModal/TaskEditorModal";
import GoalEditorModal from "@/components/GoalEditorModal/GoalEditorModal";
import CommitmentEditorModal from "@/components/CommitmentEditorModal/CommitmentEditorModal";
import ExpectationEditorModal from "@/components/ExpectationEditorModal/ExpectationEditorModal";
import TitleEditorModal from "@/components/TitleEditorModal/TitleEditorModal";
import ProjectEditorModal from "@/components/ProjectEditorModal/ProjectEditorModal";
import InfoEditorModal from "@/components/InfoEditorModal/InfoEditorModal";
import FlowEditorModal from "@/components/FlowEditorModal/FlowEditorModal";
import FlowItemEditorModal from "@/components/FlowItemEditorModal/FlowItemEditorModal";

interface Props {
  /** The whole loaded tree — a Flow's editor needs its parent and its siblings, not just itself. */
  tree: MindmapNode;
  /** Everything `useNodeEditor` returns: the open modal, and the save path for every kind. */
  editor: NodeEditorHandles;
}

/**
 * **The editor, whichever kind you opened it on.** One `E`, one double-click, one set of modals.
 *
 * Every view sends you to the same editing surface, and until there were three of them each one
 * carried its own copy of this fan-out. The List View and the Plan View could get away with two
 * kinds each, because a row there is only ever a Task or a Commitment; a Steps card is any kind at
 * all, which is what made the duplication no longer worth having.
 *
 * It is strictly a **rendering** component: every handler it wires is one `useNodeEditor` already
 * produced, and it holds no state. The three flow derivations are computed here rather than passed
 * in because they are functions of the tree alone — asking a caller for them would be asking it to
 * know why a Flow editor needs its parent.
 *
 * Creating is deliberately **not** here. A blank Commitment and a blank Flow are configured before
 * they exist, so their editors are opened by a creation gesture with a pending parent rather than
 * by an open node, and that is a different question with a different lifetime.
 */
export default function NodeEditorModals({ tree, editor }: Props) {
  const { t } = useTranslation(["editor"]);
  const {
    editorModal, setEditorModal, allTags, domainNames, availableForDep,
    onTaskSave, onGoalSave, onCommitmentSave, onExpectationSave, onSimpleSave, onProjectSave, onInfoSave,
    onClearBeadsId, onFlowSave, onFlowItemSave, checkScopeClamp,
  } = editor;

  const flowTargets = useMemo(() => flowTargetNodes(tree), [tree]);
  const allFlowItems = useMemo(() => allFlowItemNodes(tree), [tree]);
  // The parent a flow's instances fall back to when it carries no explicit Target Node.
  const editedFlowParent = useMemo(
    () => (editorModal !== null && editorModal.node.kind === "flow"
      ? targetSelectionFor(findParent(tree, editorModal.node.id))
      : null),
    [editorModal, tree],
  );

  if (editorModal === null) return null;
  const node = editorModal.node;
  // Belt and braces: a caller that opens an editor on a node that has none would otherwise leave
  // the keyboard captured behind a modal that never renders. The gesture checks this too — this is
  // the copy that makes the component honest about what it can draw.
  if (!hasNodeEditor(node)) return null;
  const close = () => setEditorModal(null);

  switch (node.kind) {
    case "task":
      return (
        <TaskEditorModal
          node={node} allTags={allTags} domainNames={domainNames} availableForDep={availableForDep}
          onSave={onTaskSave} onClearBeadsId={() => onClearBeadsId(BEADS_NODE_TYPE.TASK)}
          onCheckScopeClamp={checkScopeClamp} onClose={close}
        />
      );
    case "goal":
      return (
        <GoalEditorModal
          node={node} allTags={allTags} domainNames={domainNames}
          onSave={onGoalSave} onClearBeadsId={() => onClearBeadsId(BEADS_NODE_TYPE.GOAL)}
          onCheckScopeClamp={checkScopeClamp} onClose={close}
        />
      );
    case "commitment":
      return (
        <CommitmentEditorModal
          node={node} allTags={allTags} domainNames={domainNames}
          onSave={onCommitmentSave} onClearBeadsId={() => onClearBeadsId(BEADS_NODE_TYPE.COMMITMENT)}
          onClose={close}
        />
      );
    case "expectation":
      return (
        <ExpectationEditorModal
          node={node} allTags={allTags} domainNames={domainNames} onSave={onExpectationSave} onClose={close}
        />
      );
    case "domain":
      return (
        <TitleEditorModal
          heading={t("editor:editDomain")} title={node.title}
          isPrivate={node.isPrivate ?? false} onSave={onSimpleSave} onClose={close}
        />
      );
    case "tag":
      return (
        <TitleEditorModal
          heading={t("editor:editTag")} title={node.title}
          isPrivate={node.isPrivate ?? false} onSave={onSimpleSave} onClose={close}
        />
      );
    case "project":
      return (
        <ProjectEditorModal
          node={node} onSave={onProjectSave}
          onClearBeadsId={() => onClearBeadsId(BEADS_NODE_TYPE.PROJECT)} onClose={close}
        />
      );
    case "info":
      return <InfoEditorModal node={node} onSave={onInfoSave} onClose={close} />;
    case "flow":
      return (
        <FlowEditorModal
          node={node} availableTargets={flowTargets} inheritedTarget={editedFlowParent}
          onSave={onFlowSave} onClose={close}
        />
      );
    case "flow_goal":
    case "flow_task":
      return (
        <FlowItemEditorModal
          node={node}
          availableDeps={allFlowItems.filter(
            (candidate) => candidate.flowItem?.flowId === node.flowItem?.flowId && candidate.id !== node.id,
          )}
          onSave={onFlowItemSave} onClose={close}
        />
      );
    // Unreachable: `hasNodeEditor` above already turned both away. Named rather than defaulted, so
    // a kind added to `NodeKind` later is a compile error here instead of a modal that silently
    // never appears.
    case "aspect":
    case "habit_group":
      return null;
  }
}
