import { useTranslation } from "react-i18next";
import type { MindmapNode } from "@/utils/tree-layout";
import type { StepFieldKind } from "@/utils/steps-card";
import { useScopeRangeLabel } from "@/hooks/use-scope-range-label";
import { useTagNames } from "@/hooks/use-tag-names";
import { GOAL_STATUS, PROJECT_STATUS, TASK_STATUS } from "@/utils/status-mapping";
import styles from "./StepCard.module.css";

interface Props {
  node: MindmapNode;
  fields: readonly StepFieldKind[];
}

const BLOCKER_SEPARATOR = "; ";
const TAG_SEPARATOR = ", ";

/**
 * The card's field list — what makes a Steps card a **read mode of the editor** rather than a
 * bigger Mindmap node.
 *
 * Every value here is read off the loaded node. `MindmapNode` already carries what the editors
 * edit, resolved on load, so a Step of forty cards costs the same one board load a Step of one
 * does: **no per-card fetch, no N+1**. The two hooks below are the only asynchrony, and both are
 * app-wide caches shared by every card on screen — a scope id resolved for one card is already
 * resolved for the next.
 *
 * There is deliberately **no free-text description**. Only an `info` node has one today; promising
 * one on every kind needs a column, a migration and trigger regeneration, which is a feature of its
 * own. What a card shows instead is `virtualBlockers` — the derived "Blocked by …" reasons, which
 * are the only dependency information the node carries and exactly what you would open the editor
 * to check.
 */
export default function StepCardFields({ node, fields }: Props) {
  const { t } = useTranslation(["stepsView", "status", "nodeKinds"]);
  const scopeLabel = useScopeRangeLabel(node.timeScope);
  const planLabel = useScopeRangeLabel(node.plan);
  const checkByLabel = useScopeRangeLabel(node.checkBy);
  const tagNames = useTagNames();

  if (fields.length === 0) return null;

  /**
   * The status in words. Spelled out per kind and per value rather than assembled into a key,
   * because the i18n keys are typed: a vocabulary that grows a status is then a compile error here
   * instead of a card that prints the raw database word.
   */
  function statusLabel(): string {
    const status = node.status ?? "";
    if (node.kind === "task") {
      if (status === TASK_STATUS.TODO) return t("status:task.todo");
      if (status === TASK_STATUS.IN_PROGRESS) return t("status:task.in_progress");
      if (status === TASK_STATUS.DONE) return t("status:task.done");
      return status;
    }
    if (node.kind === "goal") {
      if (status === GOAL_STATUS.ACTIVE) return t("status:goal.active");
      if (status === GOAL_STATUS.ACHIEVED) return t("status:goal.achieved");
      if (status === GOAL_STATUS.FROZEN) return t("status:goal.frozen");
      if (status === GOAL_STATUS.ARCHIVED) return t("status:goal.archived");
      return status;
    }
    if (node.kind === "project") {
      if (status === PROJECT_STATUS.ACTIVE) return t("status:project.active");
      if (status === PROJECT_STATUS.ACHIEVED) return t("status:project.achieved");
      if (status === PROJECT_STATUS.FROZEN) return t("status:project.frozen");
      if (status === PROJECT_STATUS.ARCHIVED) return t("status:project.archived");
      return status;
    }
    return status;
  }

  function valueFor(field: StepFieldKind): string {
    switch (field) {
      // The status vocabularies are per kind — a Task is To Do, a Goal is Active — and only the
      // three kinds that have one ever ask for this field.
      case "status":
        return statusLabel();
      case "timeScope":
        return scopeLabel ?? t("stepsView:value.loading");
      case "plan":
        return planLabel ?? t("stepsView:value.loading");
      case "onScopeExit":
        return node.onScopeExit === "archive"
          ? t("stepsView:value.onExitArchive")
          : t("stepsView:value.onExitKeep");
      case "checkBy":
        return checkByLabel ?? t("stepsView:value.loading");
      case "verdictWindow": {
        const window = node.verdictWindow;
        return window == null ? "" : `${window.n} ${window.kind}`;
      }
      case "blockedBy":
        return [...(node.blockReasons ?? []), ...(node.virtualBlockers ?? [])].join(BLOCKER_SEPARATOR);
      case "details":
        return node.infoDetails ?? "";
      case "knowledgeBase":
        return node.knowledgeBaseDirectory ?? "";
      case "private":
        return t("stepsView:value.yes");
      case "instanceType":
        return t(`nodeKinds:${node.flow?.instanceType ?? "task"}`);
      case "beadsId":
        return node.beadsId ?? "";
      case "tags":
        return node.tagIds.map((id) => tagNames.get(id) ?? `#${id}`).join(TAG_SEPARATOR);
    }
  }

  return (
    <dl className={styles.fields}>
      {fields.map((field) => (
        <div key={field} className={styles.field}>
          <dt className={styles.fieldLabel}>{t(`stepsView:field.${field}`)}</dt>
          <dd className={styles.fieldValue}>{valueFor(field)}</dd>
        </div>
      ))}
    </dl>
  );
}
