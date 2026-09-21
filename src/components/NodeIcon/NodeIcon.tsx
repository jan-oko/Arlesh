import type { NodeKind } from "@/utils/tree-layout";
import type { Verdict } from "@/api/verdict";
import { commitmentGlyphState } from "@/utils/commitment-glyph";
import DomainIcon from "./DomainIcon";
import ProjectIcon from "./ProjectIcon";
import GoalIcon from "./GoalIcon";
import TagIcon from "./TagIcon";
import TaskIcon from "./TaskIcon";
import CommitmentIcon from "./CommitmentIcon";
import InfoIcon from "./InfoIcon";
import FlowIcon from "./FlowIcon";
import HabitIcon from "./HabitIcon";
import HabitGroupIcon from "./HabitGroupIcon";

interface Props {
  kind: NodeKind;
  status: string | undefined;
  /** A Commitment's recorded verdict, which the shield is drawn from. */
  verdict?: Verdict | undefined;
  /** The node's effective Archival. On a Commitment with no verdict this is what tells an
   * unanswered one from one whose Verdict Window has run out. */
  isArchived?: boolean | undefined;
  isBlocked: boolean;
  isHabit: boolean;
  cx: number;
  cy: number;
  r: number;
  color: string;
  opacity: number;
}

export default function NodeIcon({ kind, status, verdict, isArchived = false, isBlocked, isHabit, cx, cy, r, color, opacity }: Props) {
  if (kind === "aspect") return null;
  if (kind === "domain") return <DomainIcon cx={cx} cy={cy} r={r} color={color} opacity={opacity} />;
  if (kind === "project") return <ProjectIcon cx={cx} cy={cy} r={r} color={color} opacity={opacity} />;
  if (kind === "goal") return <GoalIcon cx={cx} cy={cy} r={r} color={color} opacity={opacity} status={status} isBlocked={isBlocked} />;
  if (kind === "tag") return <TagIcon cx={cx} cy={cy} r={r} color={color} opacity={opacity} />;
  if (kind === "info") return <InfoIcon cx={cx} cy={cy} r={r} color={color} opacity={opacity} />;
  if (kind === "task") return <TaskIcon cx={cx} cy={cy} r={r} color={color} opacity={opacity} status={status} isBlocked={isBlocked} />;
  if (kind === "commitment") {
    return <CommitmentIcon cx={cx} cy={cy} r={r} color={color} opacity={opacity} state={commitmentGlyphState(verdict, isArchived)} />;
  }
  if (kind === "flow") {
    return isHabit
      ? <HabitIcon cx={cx} cy={cy} r={r} color={color} opacity={opacity} />
      : <FlowIcon cx={cx} cy={cy} r={r} color={color} opacity={opacity} />;
  }
  // A folded run of passed Habit iterations: stacked bars, not another cycle.
  if (kind === "habit_group") return <HabitGroupIcon cx={cx} cy={cy} r={r} color={color} opacity={opacity} />;
  // Flow items are templates for goals/tasks — reuse their icons.
  if (kind === "flow_goal") return <GoalIcon cx={cx} cy={cy} r={r} color={color} opacity={opacity} status={status} />;
  if (kind === "flow_task") return <TaskIcon cx={cx} cy={cy} r={r} color={color} opacity={opacity} status={status} isBlocked={isBlocked} />;
  const _exhaustive: never = kind;
  throw new Error(`NodeIcon: unhandled kind "${String(_exhaustive)}"`);
}
