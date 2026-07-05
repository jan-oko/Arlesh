import { useTranslation } from "react-i18next";
import type { MindmapNode } from "@/utils/tree-layout";
import GoalIcon from "@/components/NodeIcon/GoalIcon";
import styles from "./GoalHeaderRow.module.css";

const ICON_R = 8;

const GOAL_STATUS_KEYS = ["active", "achieved", "frozen", "archived"] as const;
type GoalStatusKey = (typeof GOAL_STATUS_KEYS)[number];

function isGoalStatusKey(status: string): status is GoalStatusKey {
  return (GOAL_STATUS_KEYS as readonly string[]).includes(status);
}

interface Props {
  node: MindmapNode;
}

/** A Goal shown as a group-header row, immediately before its child tasks (SPEC List View: hidden by
 * default, toggled on via the goal-headers toggle). Display-only — Goals are never list rows. */
export default function GoalHeaderRow({ node }: Props) {
  const { t } = useTranslation("status");
  return (
    <div className={styles.header}>
      <svg width={ICON_R * 2} height={ICON_R * 2} viewBox={`0 0 ${ICON_R * 2} ${ICON_R * 2}`} aria-hidden="true">
        <GoalIcon cx={ICON_R} cy={ICON_R} r={ICON_R * 0.9} color="var(--text-secondary)" opacity={1} status={node.status} isBlocked={false} />
      </svg>
      <span className={styles.title}>{node.title}</span>
      {node.status !== undefined && isGoalStatusKey(node.status) && (
        <span className={styles.status}>{t(`goal.${node.status}`)}</span>
      )}
    </div>
  );
}
