import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";

/** Localized label functions for rendering scopes (see scope-format.ts). */
export interface ScopeLabelFns {
  month: (month1: number) => string;
  season: (name: string) => string;
  week: (n: number) => string;
}

/** Everything the Scope Picker fields need to render scope text in the active language. */
export interface ScopeLabels extends ScopeLabelFns {
  unscoped: string;
  unplanned: string;
  duration: (count: number, kind: string) => string;
}

type ScopesT = TFunction<"scopes">;

// Literal `t()` keys (typed from the JSON) — a switch keeps them literal for tsc.
function monthLabel(t: ScopesT, month1: number): string {
  switch (month1) {
    case 1: return t("month.1");
    case 2: return t("month.2");
    case 3: return t("month.3");
    case 4: return t("month.4");
    case 5: return t("month.5");
    case 6: return t("month.6");
    case 7: return t("month.7");
    case 8: return t("month.8");
    case 9: return t("month.9");
    case 10: return t("month.10");
    case 11: return t("month.11");
    default: return t("month.12");
  }
}

function seasonLabel(t: ScopesT, name: string): string {
  switch (name) {
    case "Spring": return t("season.spring");
    case "Summer": return t("season.summer");
    case "Autumn": return t("season.autumn");
    default: return t("season.winter");
  }
}

function durationLabel(t: ScopesT, count: number, kind: string): string {
  switch (kind) {
    case "day": return t("duration_day", { count });
    case "week": return t("duration_week", { count });
    case "month": return t("duration_month", { count });
    default: return t("duration_season", { count });
  }
}

/** Provides localized scope labels; memoized so consumers can depend on it in effects. */
export function useScopeLabels(): ScopeLabels {
  const { t } = useTranslation("scopes");
  return useMemo(
    () => ({
      unscoped: t("unscoped"),
      unplanned: t("unplanned"),
      week: (n: number) => t("week", { n }),
      month: (month1: number) => monthLabel(t, month1),
      season: (name: string) => seasonLabel(t, name),
      duration: (count: number, kind: string) => durationLabel(t, count, kind),
    }),
    [t],
  );
}
