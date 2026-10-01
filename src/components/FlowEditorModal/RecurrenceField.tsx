import { useId } from "react";
import { useTranslation } from "react-i18next";
import type { ClockKind, MissPolicy } from "@/api/flows";
import { recurrenceStartKind, recurrenceSummaryParts, type RecurrenceUi } from "./recurrence-ui";
import Switch from "@/components/Switch/Switch";
import AnchorScopeField from "@/components/ScopePicker/AnchorScopeField";
import { useScopeLabels } from "@/hooks/use-scope-labels";
import { formatScopeAnchor } from "@/utils/scope-format";
import editorStyles from "@/components/EditorModal/EditorModal.module.css";
import styles from "./RecurrenceField.module.css";

const GAP_KINDS = ["day", "week", "month", "season"] as const;
const CLOCKS: ClockKind[] = ["window", "interval"];
const MISS_POLICIES: MissPolicy[] = ["archive", "overdue", "owed"];

interface Props {
  value: RecurrenceUi;
  onChange: (value: RecurrenceUi) => void;
  /** The owning flow's Duration kind; the Recurrence anchors to a scope of this kind. */
  durationKind: string | null;
  /** How many periods of `durationKind` one window spans, for the summary's cadence. */
  durationN: number;
  /**
   * Whether the flow has a window. An Unscoped Habit can only keep an Interval clock, so the clock
   * choice is not offered at all.
   */
  scoped: boolean;
  /** Whether the settings are shown in full, or folded into their one-line summary. */
  expanded: boolean;
  onToggleExpanded: () => void;
}

/**
 * Edits a flow's **Recurrence** — the **clock** (Window, with what a missed iteration does, or
 * Interval) and the Repetition (Start, optional Gap, optional end) that turn it into a **Habit**.
 *
 * Once Repeating is on, the settings fold into a one-line summary ("Weekly · Window, Overdue ·
 * no gap · ends never"), a disclosure button that opens them; the parent decides whether it
 * starts open. Controlled throughout; the parent turns dates into scope keys and persists.
 */
export default function RecurrenceField({
  value, onChange, durationKind, durationN, scoped, expanded, onToggleExpanded,
}: Props) {
  const { t } = useTranslation("editor");
  const labels = useScopeLabels();
  const bodyId = useId();
  const set = (patch: Partial<RecurrenceUi>) => onChange({ ...value, ...patch });
  const anchorKind = recurrenceStartKind(durationKind);
  const parts = recurrenceSummaryParts(value, durationKind, durationN, scoped);

  const clockLabel = (kind: ClockKind): string => (kind === "window" ? t("clockWindow") : t("clockInterval"));
  const clockHint = (kind: ClockKind): string => (kind === "window" ? t("clockWindowHint") : t("clockIntervalHint"));
  const policyLabel = (policy: MissPolicy): string =>
    policy === "archive" ? t("missPolicyArchive") : policy === "overdue" ? t("missPolicyOverdue") : t("missPolicyOwed");
  const policyHint = (policy: MissPolicy): string =>
    policy === "archive" ? t("missPolicyArchiveHint") : policy === "overdue" ? t("missPolicyOverdueHint") : t("missPolicyOwedHint");

  const count = parts.cadenceCount;
  const cadence = parts.cadence === "week" ? t("cadenceWeek", { count })
    : parts.cadence === "month" ? t("cadenceMonth", { count })
      : parts.cadence === "season" ? t("cadenceSeason", { count })
        : parts.cadence === "day" ? t("cadenceDay", { count })
          : t("cadenceUnscoped");
  const summary = t("recurrenceSummary", {
    cadence,
    clock: parts.missPolicy === null
      ? clockLabel(parts.clock)
      : t("recurrenceSummaryClockPolicy", { clock: clockLabel(parts.clock), policy: policyLabel(parts.missPolicy) }),
    gap: parts.gap === null ? t("recurrenceSummaryNoGap") : t("recurrenceSummaryGap", { count: parts.gap.n, kind: parts.gap.kind }),
    ends: parts.endDate === null
      ? t("recurrenceSummaryEndsNever")
      : t("recurrenceSummaryEnds", { date: formatScopeAnchor(anchorKind, parts.endDate, labels) }),
  });

  return (
    <div className={styles.section}>
      <Switch checked={value.isHabit} onChange={(v) => set({ isHabit: v })} label={t("makeHabit")} />
      {value.isHabit && (
        <>
          <button
            type="button"
            className={styles.toggle}
            aria-expanded={expanded}
            aria-controls={bodyId}
            onClick={onToggleExpanded}
          >
            <span className={styles.chevron} aria-hidden="true">{expanded ? "▾" : "▸"}</span>
            {summary}
          </button>
          {expanded && (
            <div id={bodyId} className={styles.body}>
              {scoped && (
                <div className={editorStyles.statusPills} role="group" aria-label={t("clock")}>
                  {CLOCKS.map((kind) => (
                    <button
                      key={kind}
                      type="button"
                      title={clockHint(kind)}
                      className={`${editorStyles.statusPill}${parts.clock === kind ? ` ${editorStyles.statusPillActive}` : ""}`}
                      aria-pressed={parts.clock === kind}
                      onClick={() => set({ clock: kind })}
                    >
                      {clockLabel(kind)}
                    </button>
                  ))}
                </div>
              )}

              {parts.clock === "window" && (
                <div className={styles.row} role="group" aria-label={t("missPolicy")}>
                  {t("missPolicy")}
                  {MISS_POLICIES.map((policy) => (
                    <button
                      key={policy}
                      type="button"
                      title={policyHint(policy)}
                      className={`${editorStyles.statusPill}${value.missPolicy === policy ? ` ${editorStyles.statusPillActive}` : ""}`}
                      aria-pressed={value.missPolicy === policy}
                      onClick={() => set({ missPolicy: policy })}
                    >
                      {policyLabel(policy)}
                    </button>
                  ))}
                </div>
              )}

              <div className={styles.row}>
                {t("recurrenceStart")}
                <AnchorScopeField kind={anchorKind} date={value.startDate} onChange={(startDate) => set({ startDate })} />
              </div>

              <div className={styles.row}>
                <Switch checked={value.gapEnabled} onChange={(v) => set({ gapEnabled: v })} label={t("recurrenceGap")} />
                {value.gapEnabled && (
                  <>
                    <input
                      type="number"
                      min={1}
                      aria-label={t("recurrenceGap")}
                      className={`${editorStyles.control} ${editorStyles.numberInput}`}
                      value={value.gapN}
                      onChange={(e) => set({ gapN: Math.max(1, Number(e.target.value)) })}
                    />
                    <select
                      aria-label={t("recurrenceGap")}
                      className={`${editorStyles.control} ${editorStyles.select}`}
                      value={value.gapKind}
                      onChange={(e) => set({ gapKind: e.target.value })}
                    >
                      {GAP_KINDS.map((kind) => (
                        <option key={kind} value={kind}>{kind}</option>
                      ))}
                    </select>
                  </>
                )}
              </div>

              <div className={styles.row}>
                <Switch checked={value.endEnabled} onChange={(v) => set({ endEnabled: v })} label={t("recurrenceEnd")} />
                {value.endEnabled && (
                  <AnchorScopeField kind={anchorKind} date={value.endDate} onChange={(endDate) => set({ endDate })} />
                )}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
