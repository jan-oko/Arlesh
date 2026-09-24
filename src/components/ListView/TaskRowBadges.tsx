import { useTranslation } from "react-i18next";
import { isOccurrence } from "@/utils/node-identity";
import type { MindmapNode } from "@/utils/tree-layout";
import type { StatusIndicator } from "@/utils/node-status-indicators";
import { useScopeRangeLabel } from "@/hooks/use-scope-range-label";
import { useTagNames } from "@/hooks/use-tag-names";
import FlowIcon from "@/components/NodeIcon/FlowIcon";
import HabitIcon from "@/components/NodeIcon/HabitIcon";
import TagIcon from "@/components/NodeIcon/TagIcon";
import ClockIcon from "@/components/StatusIcons/ClockIcon";
import CalendarIcon from "@/components/StatusIcons/CalendarIcon";
import IceIcon from "@/components/StatusIcons/IceIcon";
import BacklogIcon from "@/components/StatusIcons/BacklogIcon";
import AgenticIcon from "@/components/StatusIcons/AgenticIcon";
import AsyncIcon from "@/components/StatusIcons/AsyncIcon";
import ArchiveIcon from "@/components/StatusIcons/ArchiveIcon";
import ExclamationIcon from "@/components/StatusIcons/ExclamationIcon";
import EllipsisIcon from "@/components/StatusIcons/EllipsisIcon";
import McpIcon from "@/components/StatusIcons/McpIcon";
import styles from "./TaskRowBadges.module.css";

const R = 6;
const MUTED = "var(--node-text-muted)";
const DANGER = "var(--danger)";
/** An agent waiting on the user is the one badge that asks for something, so it is not muted. */
const ACCENT = "var(--accent)";

interface Props {
  node: MindmapNode;
  indicators: StatusIndicator[];
}

/** HTML port of the Mindmap's StatusIconRow (same derivation, same icon glyphs, same tooltips),
 * laid out inline for a List View row instead of positioned in SVG canvas coordinates. */
export default function TaskRowBadges({ node, indicators }: Props) {
  const { t } = useTranslation("statusIcons");
  const scopeLabel = useScopeRangeLabel(node.timeScope);
  const planLabel = useScopeRangeLabel(node.plan);
  const tagNames = useTagNames();
  const tagsValue = node.tagIds.map((id) => tagNames.get(id) ?? `#${id}`).join(", ");

  if (indicators.length === 0) return null;

  const render = (indicator: StatusIndicator) => {
    switch (indicator.type) {
      case "scope":
        return {
          tooltip: t("scope", { value: scopeLabel ?? t("loading") }),
          icon: <ClockIcon cx={R} cy={R} r={R} color={MUTED} crossedOut={indicator.outOfScope === true} />,
        };
      case "overdue":
        return { tooltip: t("overdue"), icon: <ExclamationIcon cx={R} cy={R} r={R} color={DANGER} /> };
      case "archived":
        return {
          tooltip: indicator.conflict === true ? t("archivedConflict") : t("archived"),
          icon: <ArchiveIcon cx={R} cy={R} r={R} color={indicator.conflict === true ? DANGER : MUTED} />,
        };
      case "planned":
        return {
          tooltip: t("plan", { value: planLabel ?? t("loading") }),
          icon: <CalendarIcon cx={R} cy={R} r={R} color={MUTED} />,
        };
      case "frozen":
        return { tooltip: t("frozen"), icon: <IceIcon cx={R} cy={R} r={R} color={MUTED} /> };
      case "backlog":
        return { tooltip: t("backlog"), icon: <BacklogIcon cx={R} cy={R} r={R} color={MUTED} /> };
      case "agentic":
        return { tooltip: t("agentic"), icon: <AgenticIcon cx={R} cy={R} r={R} color={MUTED} /> };
      case "agentWaiting": {
        const note = node.agentWaiting?.note ?? null;
        return {
          tooltip: note === null ? t("agentWaiting") : t("agentWaitingNote", { note }),
          icon: <AgenticIcon cx={R} cy={R} r={R} color={ACCENT} />,
        };
      }
      case "asynchronous":
        return { tooltip: t("asynchronous"), icon: <AsyncIcon cx={R} cy={R} r={R} color={MUTED} /> };
      case "info":
        return { tooltip: node.infoDetails ?? "", icon: <EllipsisIcon cx={R} cy={R} r={R} color={MUTED} /> };
      case "flowInstance": {
        const isHabit = isOccurrence(node);
        return {
          tooltip: isHabit ? t("habitInstance") : t("flowInstance"),
          icon: isHabit
            ? <HabitIcon cx={R} cy={R} r={R} color={MUTED} opacity={1} />
            : <FlowIcon cx={R} cy={R} r={R} color={MUTED} opacity={1} />,
        };
      }
      case "tags":
        return { tooltip: t("tags", { value: tagsValue }), icon: <TagIcon cx={R} cy={R} r={R} color={MUTED} opacity={1} /> };
      case "mcp":
        return { tooltip: t("mcpVisible", { root: node.mcpVisibleVia ?? "" }), icon: <McpIcon cx={R} cy={R} r={R} color={MUTED} /> };
    }
  };

  return (
    <span className={styles.row} role="group" aria-label={t("row")}>
      {indicators.map((indicator) => {
        const { tooltip, icon } = render(indicator);
        return (
          <span key={indicator.type} className={styles.badge} title={tooltip}>
            <svg width={R * 2} height={R * 2} viewBox={`0 0 ${R * 2} ${R * 2}`} aria-hidden="true">{icon}</svg>
          </span>
        );
      })}
    </span>
  );
}
