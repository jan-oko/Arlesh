import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { getScope } from "@/api/scopes";
import type { Scope } from "@/api/scopes";
import { useScopePicker } from "@/hooks/use-scope-picker";
import { useScopeLabels } from "@/hooks/use-scope-labels";
import { useFilterStore } from "@/stores/use-filter-store";
import { openingForScopes } from "@/utils/scope-calendar";
import { formatScopeRange } from "@/utils/scope-format";
import type { ScopeAxis, ScopeMatch, ScopeSelection } from "@/utils/scope-match";
import ScopePicker from "@/components/ScopePicker/ScopePicker";
import SegmentedChoice from "./SegmentedChoice";
import styles from "./ScopeSelector.module.css";

/**
 * What a first selection means when the user has said nothing about the rule.
 *
 * Overlapping, not Within. "What is relevant during this week" is the question the selector was
 * asked for, and it is the one a planning pass asks; Within — the old, unconditional containment
 * rule — answers "what belongs to exactly this week", which is a real question but a narrower one,
 * and starting there would open most boards empty.
 */
const DEFAULT_MATCH: ScopeMatch = "overlapping";
const DEFAULT_AXIS: ScopeAxis = "relevance";

/**
 * The scope selector: the picked scope, the axis it is compared on and the match rule, in one
 * control beside the status preset.
 *
 * Deliberately not a chip in the active-filter row. It is always visible and one click away,
 * because "which period am I looking at" is a question you re-ask constantly while planning,
 * unlike a tag pill you set once — and because with nothing selected there would be no chip at
 * all, and so nothing to click to start.
 *
 * One selection at a time. Setting another replaces it, and the × clears it without opening
 * anything, so the top bar both states the filter and undoes it.
 */
export default function ScopeSelector() {
  const { t } = useTranslation("filter");
  const selection = useFilterStore((s) => s.filter.scope);
  const setScopeFilter = useFilterStore((s) => s.setScopeFilter);
  const [open, setOpen] = useState(false);
  const picker = useScopePicker("range");
  const labels = useScopeLabels();
  // Drafts, so the two modes can be chosen *before* a scope is picked. While a selection is live
  // they are not drafts at all: changing one applies immediately, since re-picking the scope to
  // change the rule you are comparing it under would be a gesture with nothing to say for itself.
  const [axis, setAxis] = useState<ScopeAxis>(selection?.axis ?? DEFAULT_AXIS);
  const [match, setMatch] = useState<ScopeMatch>(selection?.match ?? DEFAULT_MATCH);

  // The endpoint scopes give the button its label and the picker the view it opens on. Tagged with
  // the endpoints they were fetched for, so a previous selection's scopes are never shown.
  const [fetched, setFetched] = useState<{ key: string; scopes: [Scope, Scope] } | null>(null);
  const key = selection === null ? null : `${selection.startId}:${selection.endId}`;
  useEffect(() => {
    if (selection === null) return;
    let active = true;
    const pending = `${selection.startId}:${selection.endId}`;
    void Promise.all([getScope(selection.startId), getScope(selection.endId)]).then(
      ([start, end]) => {
        if (active && start != null && end != null) setFetched({ key: pending, scopes: [start, end] });
      },
      () => {
        // Left alone on purpose: the button falls back to an ellipsis rather than claiming a scope
        // it could not read, and the filter itself is unaffected — it compares windows, not names.
      },
    );
    return () => {
      active = false;
    };
  }, [selection]);

  const endpoints = fetched !== null && fetched.key === key ? fetched.scopes : null;
  const opening = endpoints === null ? null : openingForScopes(endpoints);
  const summary =
    selection === null
      ? t("anyScope")
      : (endpoints === null ? "…" : formatScopeRange(endpoints[0], endpoints[1], labels));

  function replace(next: Partial<ScopeSelection>): void {
    if (selection === null) return;
    setScopeFilter({ ...selection, ...next });
  }

  function chooseAxis(next: ScopeAxis): void {
    setAxis(next);
    replace({ axis: next });
  }

  function chooseMatch(next: ScopeMatch): void {
    setMatch(next);
    replace({ match: next });
  }

  async function apply(): Promise<void> {
    const picked = await picker.resolve();
    if (picked === null) return;
    setScopeFilter({ startId: picked.start_id, endId: picked.end_id, axis, match });
    picker.reset();
    setOpen(false);
  }

  function clear(): void {
    setScopeFilter(null);
    picker.reset();
    setOpen(false);
  }

  return (
    <div className={styles.anchor}>
      <button
        type="button"
        className={styles.trigger}
        aria-label={t("scopeLabel")}
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
      >
        {summary}
      </button>
      {selection !== null && (
        <button type="button" className={styles.clear} aria-label={t("clearScope")} onClick={clear}>
          ×
        </button>
      )}
      {open && (
        <>
          <div className={styles.backdrop} onClick={() => setOpen(false)} />
          <div className={styles.popover} role="group" aria-label={t("scopePicker")}>
            <SegmentedChoice
              label={t("scopeAxis")}
              value={axis}
              options={[
                { value: "relevance", label: t("scopeAxisRelevance") },
                { value: "plan", label: t("scopeAxisPlan") },
              ]}
              onChange={chooseAxis}
            />
            <SegmentedChoice
              label={t("scopeMatch")}
              value={match}
              options={[
                { value: "within", label: t("scopeMatchWithin") },
                { value: "overlapping", label: t("scopeMatchOverlapping") },
              ]}
              onChange={chooseMatch}
            />
            {/* Keyed on the opening so a late-arriving scope re-opens the picker on it. */}
            <ScopePicker
              key={opening === null ? "default" : `${opening.kind}:${opening.anchor}`}
              picker={picker}
              initialKind={opening?.kind ?? "month"}
              {...(opening ? { initialAnchor: opening.anchor } : {})}
            />
            <div className={styles.actions}>
              <button type="button" className={styles.action} onClick={() => void apply()}>
                {t("scopeApply")}
              </button>
              <button type="button" className={styles.action} onClick={clear}>
                {t("scopeClear")}
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
