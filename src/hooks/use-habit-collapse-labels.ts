import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useScopeLabels } from "@/hooks/use-scope-labels";
import { seasonOf } from "@/utils/scope-calendar";
import { formatScopeAnchor, formatScopeCore } from "@/utils/scope-format";
import type { HabitCollapseLabels, HabitScopeLevel } from "@/utils/habit-collapse";
import type { ScopeLabelFns } from "@/hooks/use-scope-labels";

/**
 * One scope unit as a folded run labels it: year-less, because the level above already says which
 * year it is ("Autumn" under "2026"), and a Year node is simply its number.
 */
function unitLabel(level: HabitScopeLevel, anchorDate: string, scopes: ScopeLabelFns): string {
  // Year is a display-only grouping over Seasons, so it reads the season's year — the one a
  // Winter straddling New Year is labelled with, not the calendar year of each of its days.
  if (level === "year") return String(seasonOf(anchorDate).year);
  return formatScopeCore(level, anchorDate, scopes);
}

/** The localized text the Mindmap's folded Habit-history nodes are labelled with. */
export function useHabitCollapseLabels(): HabitCollapseLabels {
  const { t } = useTranslation("habits");
  const scopes = useScopeLabels();
  return useMemo(
    () => ({
      run: (tally) => t("collapse.run", { passed: tally.passed, done: tally.done, missed: tally.missed }),
      level: (unit, tally) => t("collapse.level", { unit, done: tally.done, missed: tally.missed }),
      unit: (level, anchorDate) => unitLabel(level, anchorDate, scopes),
      span: (startIso, endIso) =>
        t("collapse.span", {
          start: formatScopeAnchor("day", startIso, scopes),
          end: formatScopeAnchor("day", endIso, scopes),
        }),
    }),
    [t, scopes],
  );
}
