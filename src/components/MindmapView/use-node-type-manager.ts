import { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import type { MindmapNode, NodeKind } from "@/utils/tree-layout";
import type { RetypeOptions } from "./use-mindmap-data";
import { GOAL_CHILDREN_ACTION, INFO_CHILDREN_ACTION } from "./use-mindmap-data";
import type { WarningAction } from "@/components/WarningConfirmModal/warning-confirm";
import { WARNING_VARIANT } from "@/components/WarningConfirmModal/warning-confirm";
import { validTypesForCycling, crossesGoalTaskBoundary } from "@/utils/node-meta";
import { goalStatusToTaskStatus, taskStatusToGoalStatus, GOAL_STATUS, TASK_STATUS } from "@/utils/status-mapping";
import { findNode, findParent } from "@/utils/mindmap-tree";

type Tf = TFunction<["warnings", "nodeKinds", "status"]>;

function labelGoalStatus(status: string, t: Tf): string {
  if (status === GOAL_STATUS.ACTIVE) return t("status:goal.active");
  if (status === GOAL_STATUS.ACHIEVED) return t("status:goal.achieved");
  if (status === GOAL_STATUS.FROZEN) return t("status:goal.frozen");
  if (status === GOAL_STATUS.ARCHIVED) return t("status:goal.archived");
  return status;
}

function labelTaskStatus(status: string, t: Tf): string {
  if (status === TASK_STATUS.TODO) return t("status:task.todo");
  if (status === TASK_STATUS.IN_PROGRESS) return t("status:task.in_progress");
  if (status === TASK_STATUS.DONE) return t("status:task.done");
  return status;
}

export interface WarningModalState {
  nodeId: string;
  fromKind: NodeKind;
  toKind: NodeKind;
  heading: string;
  consequences: string[];
  hasGoalChildren: boolean;
  hasNonInfoChildren: boolean;
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
  hasNonInfoChildren: boolean,
  reparentLabel: string,
  deleteLabel: string,
  convertLabel: string,
  confirm: (options?: RetypeOptions) => void,
): WarningAction[] {
  if (hasGoalChildren) {
    return [
      { label: reparentLabel, variant: WARNING_VARIANT.PRIMARY, onClick: () => { confirm({ goalChildrenAction: GOAL_CHILDREN_ACTION.REPARENT }); } },
      { label: deleteLabel, variant: WARNING_VARIANT.DANGER, onClick: () => { confirm({ goalChildrenAction: GOAL_CHILDREN_ACTION.REMOVE }); } },
    ];
  }
  if (hasNonInfoChildren) {
    return [
      { label: reparentLabel, variant: WARNING_VARIANT.PRIMARY, onClick: () => { confirm({ infoChildrenAction: INFO_CHILDREN_ACTION.REPARENT }); } },
      { label: deleteLabel, variant: WARNING_VARIANT.DANGER, onClick: () => { confirm({ infoChildrenAction: INFO_CHILDREN_ACTION.REMOVE }); } },
    ];
  }
  return [{ label: convertLabel, variant: WARNING_VARIANT.PRIMARY, onClick: () => { confirm(); } }];
}

export function useNodeTypeManager({ tree, retypeNode, selectNode, showToast }: Options): Result {
  const { t } = useTranslation(["warnings", "nodeKinds", "status"]);
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

      if (newKind === "info") {
        const nonInfoChildren = node.children.filter((c) => c.kind !== "info");
        if (nonInfoChildren.length > 0) {
          setWarningModal({
            nodeId, fromKind: node.kind, toKind: newKind,
            heading: t("warnings:convertHeading", { kind: t(`nodeKinds:${newKind}`) }),
            consequences: [t("warnings:nonInfoChildrenUnderInfo", { count: nonInfoChildren.length })],
            hasGoalChildren: false,
            hasNonInfoChildren: true,
          });
          return;
        }
      }

      if (crossesGoalTaskBoundary(node.kind, newKind)) {
        const rawOldStatus = node.status ?? (node.kind === "goal" ? GOAL_STATUS.ACTIVE : TASK_STATUS.TODO);
        const rawNewStatus = node.kind === "goal"
          ? goalStatusToTaskStatus(rawOldStatus)
          : taskStatusToGoalStatus(rawOldStatus);
        const fromStatusLabel = node.kind === "goal"
          ? labelGoalStatus(rawOldStatus, t)
          : labelTaskStatus(rawOldStatus, t);
        const toStatusLabel = node.kind === "goal"
          ? labelTaskStatus(rawNewStatus, t)
          : labelGoalStatus(rawNewStatus, t);
        showToast({ nodeId, message: t("warnings:statusToast", { from: fromStatusLabel, to: toStatusLabel }) });

        const hasGoalChildren = node.kind === "goal" && node.children.some((c) => c.kind === "goal");
        const hasBlockedReason = node.blockedReason != null && node.blockedReason !== "";
        if (hasGoalChildren || hasBlockedReason) {
          const consequences: string[] = [];
          if (hasBlockedReason) {
            const reason = node.blockedReason ?? "";
            const preview = reason.length > 40 ? `${reason.slice(0, 40)}…` : reason;
            consequences.push(t("warnings:blockReasonCarryOver", { preview }));
          }
          if (hasGoalChildren) {
            const count = node.children.filter((c) => c.kind === "goal").length;
            consequences.push(t("warnings:subgoalsUnderTask", { count }));
          }
          setWarningModal({
            nodeId, fromKind: node.kind, toKind: newKind,
            heading: t("warnings:convertHeading", { kind: t(`nodeKinds:${newKind}`) }),
            consequences, hasGoalChildren, hasNonInfoChildren: false,
          });
          return;
        }
      }

      void retypeNode(nodeId, node.kind, newKind).then((newId) => {
        selectNode(newId ?? nodeId);
      });
    },
    [tree, showToast, retypeNode, selectNode, t],
  );

  const retypeActions = warningModal !== null
    ? buildRetypeActions(
        warningModal.hasGoalChildren,
        warningModal.hasNonInfoChildren,
        warningModal.hasNonInfoChildren
          ? t("warnings:reparentNonInfoChildren")
          : t("warnings:reparentSubgoals"),
        warningModal.hasNonInfoChildren
          ? t("warnings:deleteNonInfoChildren")
          : t("warnings:deleteSubgoals"),
        t("warnings:convertHeading", { kind: t(`nodeKinds:${warningModal.toKind}`) }),
        confirmRetype,
      )
    : null;

  return { warningModal, setWarningModal, confirmRetype, cycleType, retypeActions };
}
