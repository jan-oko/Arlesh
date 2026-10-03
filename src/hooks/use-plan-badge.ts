import { useTranslation } from "react-i18next";
import { useScopeRangeLabel } from "@/hooks/use-scope-range-label";
import type { MindmapNode } from "@/utils/tree-layout";

/** How fainter an inherited Plan's calendar badge is drawn than an own one's. */
export const INHERITED_PLAN_OPACITY = 0.45;

/** What the calendar badge says, and how it is drawn. */
export interface PlanBadge {
  tooltip: string;
  /** Faint for an inherited Plan, full for an own one. */
  opacity: number;
  /** Whether it flags a broken plan rule. */
  conflict: boolean;
}

/** The planned node an inherited Plan comes from, by its short id when it has one. */
function sourceName(node: MindmapNode): string {
  const source = node.planSource;
  if (source === undefined) return "";
  return source.shortId ?? source.nodeId;
}

/**
 * The calendar badge of a Task's **effective** Plan: its own, or — fainter — one it inherits, named
 * by where it comes from (`docs/spec/time-scopes.md`, *Plan inheritance*). A Task breaking a plan
 * rule says which.
 */
export function usePlanBadge(node: MindmapNode): PlanBadge {
  const { t } = useTranslation("statusIcons");
  const own = node.plan ?? null;
  const label = useScopeRangeLabel(own ?? node.inheritedPlan);
  const value = label ?? t("loading");
  const conflict = node.planConflict !== undefined;
  if (own !== null) {
    const tooltip = node.planConflict === "parent_plan" ? t("planOutsideInherited", { value }) : t("plan", { value });
    return { tooltip, opacity: 1, conflict };
  }
  if (node.planConflict === "empty") {
    return { tooltip: t("planEmpty", { source: sourceName(node) }), opacity: INHERITED_PLAN_OPACITY, conflict };
  }
  return {
    tooltip: t("planInherited", { source: sourceName(node), value }),
    opacity: INHERITED_PLAN_OPACITY,
    conflict,
  };
}
