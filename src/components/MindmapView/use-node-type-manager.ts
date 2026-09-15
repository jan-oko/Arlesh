import { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import type { MindmapNode, NodeKind } from "@/utils/tree-layout";
import type { RetypeOptions } from "./use-mindmap-data";
import { GOAL_CHILDREN_ACTION, INFO_CHILDREN_ACTION } from "./use-mindmap-data";
import type { RetypeLosses } from "@/api/retype";
import { retypeLosses, STRANDED_CHILDREN } from "@/api/retype";
import { getErrorMessage } from "@/api/errors";
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
  /**
   * What the backend refused to destroy without being told to, when this prompt came from
   * `retype_node`'s `needs_confirmation`. `null` for the two prompts the frontend still raises
   * on its own (flow items, and converting to an info).
   */
  losses: RetypeLosses | null;
}

/** Every kind the backend can report as a stranded child. */
const STRANDABLE_KINDS: readonly NodeKind[] = ["goal", "task", "domain", "project", "tag", "info", "flow"];

/** A stranded child's kind, translated — or the raw spelling if the backend named a new one. */
function childKindLabel(kind: string, t: Tf): string {
  const known = STRANDABLE_KINDS.find((candidate) => candidate === kind);
  return known === undefined ? kind : t(`nodeKinds:${known}`);
}

/**
 * Renders the backend's loss list as prompt lines.
 *
 * Every field key the command can emit has its own string; an unrecognised one falls back to
 * naming the field rather than rendering a raw key, so a field added to `tasks::retype` shows up
 * as readable text before anybody gets round to translating it.
 */
function describeLosses(losses: RetypeLosses, t: Tf): string[] {
  const lines: string[] = [];
  if (losses.lost_children.length > 0) {
    lines.push(t("warnings:strandedChildren", { count: losses.lost_children.length }));
    for (const child of losses.lost_children) {
      lines.push(t("warnings:strandedChild", { kind: childKindLabel(child.kind, t), title: child.title }));
    }
  }
  for (const field of losses.lost_fields) {
    lines.push(
      t(`warnings:lostField.${field.field}`, {
        value: field.value,
        count: Number(field.value),
        defaultValue: t("warnings:lostFieldFallback", { field: field.field, value: field.value }),
      }),
    );
  }
  return lines;
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
  setType: (nodeId: string, kind: NodeKind) => void;
  retypeActions: WarningAction[] | null;
}

function buildRetypeActions(
  modal: WarningModalState,
  reparentLabel: string,
  deleteLabel: string,
  convertLabel: string,
  confirm: (options?: RetypeOptions) => void,
): WarningAction[] {
  const { hasGoalChildren, hasNonInfoChildren, losses } = modal;
  // A backend refusal: confirming means passing `strandedChildren`, which is both the choice and
  // the acknowledgement. When only fields are at stake there is nothing to choose, but the
  // acknowledgement is still required — the command refuses again without it.
  if (losses !== null) {
    if (losses.lost_children.length === 0) {
      return [
        {
          label: convertLabel,
          variant: WARNING_VARIANT.PRIMARY,
          onClick: () => { confirm({ strandedChildren: STRANDED_CHILDREN.REPARENT }); },
        },
      ];
    }
    return [
      {
        label: reparentLabel,
        variant: WARNING_VARIANT.PRIMARY,
        onClick: () => { confirm({ strandedChildren: STRANDED_CHILDREN.REPARENT }); },
      },
      {
        label: deleteLabel,
        variant: WARNING_VARIANT.DANGER,
        onClick: () => { confirm({ strandedChildren: STRANDED_CHILDREN.DELETE }); },
      },
    ];
  }
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

  /**
   * Runs a retype and deals with however it comes back.
   *
   * A `needs_confirmation` refusal is not a failure: it is the backend saying the retype would
   * destroy something and naming each thing, so it becomes this prompt. Anything else is a real
   * failure and gets a toast — a retype that quietly did nothing is exactly the class of bug
   * this whole path exists to end.
   */
  const runRetype = useCallback(
    (nodeId: string, fromKind: NodeKind, toKind: NodeKind, options?: RetypeOptions) => {
      void retypeNode(nodeId, fromKind, toKind, options).then(
        (newId) => {
          selectNode(newId ?? nodeId);
        },
        (error: unknown) => {
          const losses = retypeLosses(error);
          if (losses !== null) {
            setWarningModal({
              nodeId, fromKind, toKind,
              heading: t("warnings:convertHeading", { kind: t(`nodeKinds:${toKind}`) }),
              consequences: describeLosses(losses, t),
              hasGoalChildren: false, hasNonInfoChildren: false,
              losses,
            });
            return;
          }
          showToast({ nodeId, message: t("warnings:retypeFailed", { message: getErrorMessage(error) }) });
        },
      );
    },
    [retypeNode, selectNode, showToast, t],
  );

  const confirmRetype = useCallback(
    (options?: RetypeOptions) => {
      if (warningModal === null) return;
      const { nodeId, fromKind, toKind } = warningModal;
      setWarningModal(null);
      runRetype(nodeId, fromKind, toKind, options);
    },
    [warningModal, runRetype],
  );

  // Retypes `node` to `newKind`. The two prompts the frontend still raises itself come first —
  // flow items, and converting to an info, neither of which `retype_node` covers. Everything
  // else just runs: the backend refuses and names what is at stake, and `runRetype` turns that
  // refusal into the same prompt.
  const applyRetype = useCallback(
    (node: MindmapNode, newKind: NodeKind) => {
      const nodeId = node.id;
      // Flow items convert goal↔task; converting a flow-goal with flow-goal children into a
      // flow-task orphans those goals, so prompt to reparent or delete them first.
      if (node.kind === "flow_goal" || node.kind === "flow_task") {
        const hasGoalChildren =
          node.kind === "flow_goal" && newKind === "flow_task" && node.children.some((c) => c.kind === "flow_goal");
        if (hasGoalChildren) {
          const count = node.children.filter((c) => c.kind === "flow_goal").length;
          setWarningModal({
            nodeId, fromKind: node.kind, toKind: newKind,
            heading: t("warnings:convertHeading", { kind: t(`nodeKinds:${newKind}`) }),
            consequences: [t("warnings:subgoalsUnderTask", { count })],
            hasGoalChildren: true, hasNonInfoChildren: false, losses: null,
          });
          return;
        }
        runRetype(nodeId, node.kind, newKind);
        return;
      }

      if (newKind === "info") {
        const nonInfoChildren = node.children.filter((c) => c.kind !== "info");
        if (nonInfoChildren.length > 0) {
          setWarningModal({
            nodeId, fromKind: node.kind, toKind: newKind,
            heading: t("warnings:convertHeading", { kind: t(`nodeKinds:${newKind}`) }),
            consequences: [t("warnings:nonInfoChildrenUnderInfo", { count: nonInfoChildren.length })],
            hasGoalChildren: false,
            hasNonInfoChildren: true,
            losses: null,
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
        // A notification, not a question: the status always remaps and there is nothing to
        // decide. What *is* at stake — a sub-goal a task cannot hold, a Plan a goal has no
        // column for — the backend enumerates, and only it can, so nothing is predicted here.
        showToast({ nodeId, message: t("warnings:statusToast", { from: fromStatusLabel, to: toStatusLabel }) });
      }

      runRetype(nodeId, node.kind, newKind);
    },
    [showToast, runRetype, t],
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
      applyRetype(node, newKind);
    },
    [tree, applyRetype],
  );

  // Retypes a node directly to a chosen valid kind (from the context-menu "Set type" submenu).
  const setType = useCallback(
    (nodeId: string, newKind: NodeKind) => {
      const node = findNode(tree, nodeId);
      if (node === undefined || node.kind === newKind) return;
      const parent = findParent(tree, nodeId);
      if (!validTypesForCycling(node.kind, parent?.kind ?? null).includes(newKind)) return;
      applyRetype(node, newKind);
    },
    [tree, applyRetype],
  );

  const retypeActions = warningModal !== null
    ? buildRetypeActions(
        warningModal,
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

  return { warningModal, setWarningModal, confirmRetype, cycleType, setType, retypeActions };
}
