import { useTranslation } from "react-i18next";
import { isOccurrence } from "@/utils/node-identity";
import type { MindmapNode } from "@/utils/tree-layout";
import type { StatusIndicator } from "@/utils/node-status-indicators";
import { useScopeRangeLabel } from "@/hooks/use-scope-range-label";
import { useTagNames } from "@/hooks/use-tag-names";
import FlowIcon from "@/components/NodeIcon/FlowIcon";
import HabitIcon from "@/components/NodeIcon/HabitIcon";
import TagIcon from "@/components/NodeIcon/TagIcon";
import ClockIcon from "./ClockIcon";
import CalendarIcon from "./CalendarIcon";
import IceIcon from "./IceIcon";
import BacklogIcon from "./BacklogIcon";
import AgenticIcon from "./AgenticIcon";
import AsyncIcon from "./AsyncIcon";
import ArchiveIcon from "./ArchiveIcon";
import ExclamationIcon from "./ExclamationIcon";
import EllipsisIcon from "./EllipsisIcon";
import McpIcon from "./McpIcon";

const ICON_R = 6;
const ICON_SPACING = 16;
const ROW_GAP = 11;
const MUTED = "var(--node-text-muted)";
const DANGER = "var(--danger)";
/** An agent waiting on the user is the one badge that asks for something, so it is not muted. */
const ACCENT = "var(--accent)";

interface Props {
  node: MindmapNode;
  indicators: StatusIndicator[];
  /** Node box height (local coords); the row sits just below it. */
  top: number;
}

/**
 * A row of status badges rendered just below a node, aligned to the node box's left edge
 * (independent of the node title's own text direction), each with an SVG `<title>` tooltip.
 * Scope/Plan tooltips resolve their window labels asynchronously; tags resolve their names.
 */
export default function StatusIconRow({ node, indicators, top }: Props) {
  const { t } = useTranslation("statusIcons");
  const scopeLabel = useScopeRangeLabel(node.timeScope);
  const planLabel = useScopeRangeLabel(node.plan);
  const tagNames = useTagNames();

  const rowY = top + ROW_GAP + ICON_R;
  // First badge hugs the left edge; subsequent badges march rightward.
  const cxFor = (i: number) => ICON_R + i * ICON_SPACING;

  const tagsValue = node.tagIds.map((id) => tagNames.get(id) ?? `#${id}`).join(", ");

  const render = (indicator: StatusIndicator, cx: number) => {
    switch (indicator.type) {
      case "scope":
        return {
          tooltip: t("scope", { value: scopeLabel ?? t("loading") }),
          icon: <ClockIcon cx={cx} cy={rowY} r={ICON_R} color={MUTED} crossedOut={indicator.outOfScope === true} />,
        };
      case "overdue":
        return { tooltip: t("overdue"), icon: <ExclamationIcon cx={cx} cy={rowY} r={ICON_R} color={DANGER} /> };
      case "archived":
        return {
          tooltip: indicator.conflict === true ? t("archivedConflict") : t("archived"),
          icon: <ArchiveIcon cx={cx} cy={rowY} r={ICON_R} color={indicator.conflict === true ? DANGER : MUTED} />,
        };
      case "planned":
        return {
          tooltip: t("plan", { value: planLabel ?? t("loading") }),
          icon: <CalendarIcon cx={cx} cy={rowY} r={ICON_R} color={MUTED} />,
        };
      case "frozen":
        return { tooltip: t("frozen"), icon: <IceIcon cx={cx} cy={rowY} r={ICON_R} color={MUTED} /> };
      case "backlog":
        return { tooltip: t("backlog"), icon: <BacklogIcon cx={cx} cy={rowY} r={ICON_R} color={MUTED} /> };
      case "agentic":
        return { tooltip: t("agentic"), icon: <AgenticIcon cx={cx} cy={rowY} r={ICON_R} color={MUTED} /> };
      case "agentWaiting": {
        const note = node.agentWaiting?.note ?? null;
        return {
          tooltip: note === null ? t("agentWaiting") : t("agentWaitingNote", { note }),
          icon: <AgenticIcon cx={cx} cy={rowY} r={ICON_R} color={ACCENT} />,
        };
      }
      case "asynchronous":
        return { tooltip: t("asynchronous"), icon: <AsyncIcon cx={cx} cy={rowY} r={ICON_R} color={MUTED} /> };
      case "info":
        return { tooltip: node.infoDetails ?? "", icon: <EllipsisIcon cx={cx} cy={rowY} r={ICON_R} color={MUTED} /> };
      case "flowInstance": {
        // A Habit occurrence reads as the cyclical habit glyph; a Start-flow instance as the wave.
        const isHabit = isOccurrence(node);
        return {
          tooltip: isHabit ? t("habitInstance") : t("flowInstance"),
          icon: isHabit
            ? <HabitIcon cx={cx} cy={rowY} r={ICON_R} color={MUTED} opacity={1} />
            : <FlowIcon cx={cx} cy={rowY} r={ICON_R} color={MUTED} opacity={1} />,
        };
      }
      case "tags":
        return { tooltip: t("tags", { value: tagsValue }), icon: <TagIcon cx={cx} cy={rowY} r={ICON_R} color={MUTED} opacity={1} /> };
      case "mcp":
        return { tooltip: t("mcpVisible", { root: node.mcpVisibleVia ?? "" }), icon: <McpIcon cx={cx} cy={rowY} r={ICON_R} color={MUTED} /> };
    }
  };

  return (
    <g role="group" aria-label={t("row")} pointerEvents="none">
      {indicators.map((indicator, i) => {
        const { tooltip, icon } = render(indicator, cxFor(i));
        return (
          <g key={indicator.type}>
            <title>{tooltip}</title>
            {icon}
          </g>
        );
      })}
    </g>
  );
}
