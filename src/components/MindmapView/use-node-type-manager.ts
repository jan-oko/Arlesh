import { useCallback, useState } from "react";
import type { MindmapNode, NodeKind } from "@/utils/tree-layout";
import type { RetypeOptions } from "./use-mindmap-data";
import { GOAL_CHILDREN_ACTION } from "./use-mindmap-data";
import type { WarningAction } from "@/components/WarningConfirmModal/WarningConfirmModal";
import { WARNING_VARIANT } from "@/components/WarningConfirmModal/WarningConfirmModal";
import { validTypesForCycling, crossesGoalTaskBoundary } from "@/utils/node-meta";
import { goalStatusToTaskStatus, taskStatusToGoalStatus, GOAL_STATUS, TASK_STATUS } from "@/utils/status-mapping";
import { findNode, findParent } from "@/utils/mindmap-tree";

export interface WarningModalState {
  nodeId: string;
  fromKind: NodeKind;
  toKind: NodeKind;
  heading: string;
  consequences: string[];
  hasGoalChildren: boolean;
}

interface Options {
  tree: MindmapNode;
  retypeNode: (id: string, from: NodeKind, to: NodeKind, options?: RetypeOptions) => Promise<string | null>;
  selectNode: (id: string | null) => void;
  showToast: (toast: { nodeId: string; message: string }) => void;
}

interface Result {
  warningModal: WarningModalState | null;
  setWarningModal: (m: WarningModalState | null) => void;
  confirmRetype: (options?: RetypeOptions) => void;
  cycleType: (nodeId: string, direction: 1 | -1) => void;
  retypeActions: WarningAction[] | null;
}

function buildRetypeActions(
  hasGoalChildren: boolean,
  toKind: NodeKind,
  confirm: (options?: RetypeOptions) => void,
): WarningAction[] {
  if (hasGoalChildren) {
    return [
      { label: "Re-parent sub-goals", variant: WARNING_VARIANT.PRIMARY, onClick: () => { confirm({ goalChildrenAction: GOAL_CHILDREN_ACTION.REPARENT }); } },
      { label: "Delete sub-goals", variant: WARNING_VARIANT.DANGER, onClick: () => { confirm({ goalChildrenAction: GOAL_CHILDREN_ACTION.REMOVE }); } },
    ];
  }
  return [{ label: `Convert to ${toKind}`, variant: WARNING_VARIANT.PRIMARY, onClick: () => { confirm(); } }];
}

export function useNodeTypeManager({ tree, retypeNode, selectNode, showToast }: Options): Result {
  const [warningModal, setWarningModal] = useState<WarningModalState | null>(null);

  const confirmRetype = useCallback(
    (options?: RetypeOptions) => {
      if (warningModal === null) return;
      const { nodeId, fromKind, toKind } = warningModal;
      setWarningModal(null);
      void retypeNode(nodeId, fromKind, toKind, options).then((newId) => {
        selectNode(newId ?? nodeId);
      });
    },
    [warningModal, retypeNode, selectNode],
  );

  const cycleType = useCallback(
    (nodeId: string, direction: 1 | -1) => {
      const node = findNode(tree, nodeId);
      if (node === undefined || node.kind === "aspect") return;
      const parent = findParent(tree, nodeId);
      const validTypes = validTypesForCycling(node.kind, parent?.kind ?? null);
      if (validTypes.length <= 1) return;
      const currentIdx = validTypes.indexOf(node.kind);
      if (currentIdx === -1) return;
      const newKind = validTypes[(currentIdx + direction + validTypes.length) % validTypes.length];
      if (newKind === undefined || newKind === node.kind) return;

      if (crossesGoalTaskBoundary(node.kind, newKind)) {
        const newStatus =
          node.kind === "goal"
            ? goalStatusToTaskStatus(node.status ?? GOAL_STATUS.ACTIVE)
            : taskStatusToGoalStatus(node.status ?? TASK_STATUS.TODO);
        showToast({ nodeId, message: `Status: ${node.status ?? "—"} → ${newStatus}` });
        const hasGoalChildren = node.kind === "goal" && node.children.some((c) => c.kind === "goal");
        const hasBlockedReason = node.blockedReason != null && node.blockedReason !== "";
        if (hasGoalChildren || hasBlockedReason) {
          const consequences: string[] = [];
          if (hasBlockedReason) {
            const reason = node.blockedReason ?? "";
            const preview = reason.length > 40 ? `${reason.slice(0, 40)}…` : reason;
            consequences.push(`Block reason will carry over: "${preview}"`);
          }
          if (hasGoalChildren) {
            const count = node.children.filter((c) => c.kind === "goal").length;
            consequences.push(
              `${count} sub-goal${count > 1 ? "s" : ""} cannot live under a task — choose what happens to them`,
            );
          }
          setWarningModal({
            nodeId, fromKind: node.kind, toKind: newKind,
            heading: `Convert to ${newKind}?`, consequences, hasGoalChildren,
          });
          return;
        }
      }

      void retypeNode(nodeId, node.kind, newKind).then((newId) => {
        selectNode(newId ?? nodeId);
      });
    },
    [tree, showToast, retypeNode, selectNode],
  );

  const retypeActions = warningModal !== null
    ? buildRetypeActions(warningModal.hasGoalChildren, warningModal.toKind, confirmRetype)
    : null;

  return { warningModal, setWarningModal, confirmRetype, cycleType, retypeActions };
}
