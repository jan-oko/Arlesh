import { useCallback } from "react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import type { ScopeRef } from "@/utils/scope-ref";
import { seasonOf, weekNumber, weekdayOf } from "@/utils/scope-calendar";

type LabelT = TFunction<["planView", "scopes"]>;

// Literal `t()` keys (typed from the JSON) — a switch keeps them literal for tsc, exactly as
// `use-scope-labels` does for the months it renders.
function weekdayLabel(t: LabelT, date: string): string {
  switch (weekdayOf(date)) {
    case 0: return t("planView:weekday.0");
    case 1: return t("planView:weekday.1");
    case 2: return t("planView:weekday.2");
    case 3: return t("planView:weekday.3");
    case 4: return t("planView:weekday.4");
    case 5: return t("planView:weekday.5");
    default: return t("planView:weekday.6");
  }
}

function monthLabel(t: LabelT, date: string): string {
  switch (Number(date.slice(5, 7))) {
    case 1: return t("scopes:month.1");
    case 2: return t("scopes:month.2");
    case 3: return t("scopes:month.3");
    case 4: return t("scopes:month.4");
    case 5: return t("scopes:month.5");
    case 6: return t("scopes:month.6");
    case 7: return t("scopes:month.7");
    case 8: return t("scopes:month.8");
    case 9: return t("scopes:month.9");
    case 10: return t("scopes:month.10");
    case 11: return t("scopes:month.11");
    default: return t("scopes:month.12");
  }
}

function seasonLabel(t: LabelT, date: string): string {
  switch (seasonOf(date).name) {
    case "Spring": return t("scopes:season.spring");
    case "Summer": return t("scopes:season.summer");
    case "Autumn": return t("scopes:season.autumn");
    default: return t("scopes:season.winter");
  }
}

/**
 * Names one **subscope** of the scope a Plan pass is filling, in the active language.
 *
 * A pass descends exactly one rung — a season into its months, a month into its weeks, a week into
 * its days, a day into its bands — so the four kinds here are all the kinds a bucket can be. A
 * season is handled anyway because the ref type allows one, not because anything descends into it.
 *
 * The names matter beyond reading: the keyboard's mnemonic for a bucket is its **initial** (see
 * `plan-subscope-keys`), so what a bucket is called is what letter reaches it, and calling a day
 * "22" the way the calendar grid does — where the column already says which weekday it is — would
 * leave the days of a week with no letters at all.
 *
 * A day keeps its date beside its weekday. A planning pass browses, and "Tuesday" alone is the same
 * word in every week of the year.
 */
export function useSubscopeLabel(): (ref: ScopeRef) => string {
  const { t } = useTranslation(["planView", "scopes"]);
  return useCallback(
    (ref: ScopeRef): string => {
      switch (ref.kind) {
        case "part_of_day": return t(`scopes:part.${ref.part}`);
        case "exact": return ref.start;
        case "day": return `${weekdayLabel(t, ref.date)} ${ref.date}`;
        case "week": return t("scopes:week", { n: weekNumber(ref.date) });
        case "month": return monthLabel(t, ref.date);
        case "season": return seasonLabel(t, ref.date);
      }
    },
    [t],
  );
}
