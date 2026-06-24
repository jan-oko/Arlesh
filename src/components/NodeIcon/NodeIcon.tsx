import type { NodeKind } from "@/utils/tree-layout";
import DomainIcon from "./DomainIcon";
import ProjectIcon from "./ProjectIcon";
import GoalIcon from "./GoalIcon";
import TagIcon from "./TagIcon";
import TaskIcon from "./TaskIcon";

interface Props {
  kind: NodeKind;
  status: string | undefined;
  isBlocked: boolean;
  cx: number;
  cy: number;
  r: number;
  color: string;
  opacity: number;
}

export default function NodeIcon({ kind, status, isBlocked, cx, cy, r, color, opacity }: Props) {
  if (kind === "aspect") return null;
  if (kind === "domain") return <DomainIcon cx={cx} cy={cy} r={r} color={color} opacity={opacity} />;
  if (kind === "project") return <ProjectIcon cx={cx} cy={cy} r={r} color={color} opacity={opacity} />;
  if (kind === "goal") return <GoalIcon cx={cx} cy={cy} r={r} color={color} opacity={opacity} />;
  if (kind === "tag") return <TagIcon cx={cx} cy={cy} r={r} color={color} opacity={opacity} />;
  return <TaskIcon cx={cx} cy={cy} r={r} color={color} opacity={opacity} status={status} isBlocked={isBlocked} />;
}
