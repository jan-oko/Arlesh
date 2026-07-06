import { useTranslation } from "react-i18next";
import type { ConsumptionKind, BlockingMode, CatchupPolicy } from "@/api/flows";
import { recurrenceStartKind, type RecurrenceUi } from "./recurrence-ui";
import Switch from "@/components/Switch/Switch";
import AnchorScopeField from "@/components/ScopePicker/AnchorScopeField";
import styles from "@/components/EditorModal/EditorModal.module.css";

const GAP_KINDS = ["day", "week", "month", "season"] as const;
const CATCHUP_POLICIES: CatchupPolicy[] = ["all_pending", "next", "latest"];

interface Props {
  value: RecurrenceUi;
  onChange: (value: RecurrenceUi) => void;
  /** The owning flow's Duration kind; the Recurrence anchors to a scope of this kind. */
  durationKind: string | null;
}

/**
 * Edits a flow's **Recurrence** — the Repetition (Start, optional Gap, optional end) and the
 * Consumption tree (Destructive vs Accumulating → Overlapping vs Blocking → catch-up policy) that
 * turn it into a **Habit**. Controlled; the parent materializes dates to scope ids and persists.
 */
export default function RecurrenceField({ value, onChange, durationKind }: Props) {
  const { t } = useTranslation("editor");
  const set = (patch: Partial<RecurrenceUi>) => onChange({ ...value, ...patch });
  const anchorKind = recurrenceStartKind(durationKind);

  const catchupLabel = (policy: CatchupPolicy): string =>
    policy === "all_pending" ? t("catchupAllPending") : policy === "next" ? t("catchupNext") : t("catchupLatest");

  return (
    <div className={styles.label}>
      <Switch checked={value.isHabit} onChange={(v) => set({ isHabit: v })} label={t("makeHabit")} />
      {value.isHabit && (
        <>
          <div className={styles.label}>
            {t("recurrenceStart")}
            <AnchorScopeField kind={anchorKind} date={value.startDate} onChange={(startDate) => set({ startDate })} />
          </div>

          <Switch checked={value.gapEnabled} onChange={(v) => set({ gapEnabled: v })} label={t("recurrenceGap")} />
          {value.gapEnabled && (
            <div className={styles.durationRow}>
              <input
                type="number"
                min={1}
                aria-label={t("recurrenceGap")}
                className={`${styles.control} ${styles.numberInput}`}
                value={value.gapN}
                onChange={(e) => set({ gapN: Math.max(1, Number(e.target.value)) })}
              />
              <select
                aria-label={t("recurrenceGap")}
                className={`${styles.control} ${styles.select}`}
                value={value.gapKind}
                onChange={(e) => set({ gapKind: e.target.value })}
              >
                {GAP_KINDS.map((kind) => (
                  <option key={kind} value={kind}>{kind}</option>
                ))}
              </select>
            </div>
          )}

          <Switch checked={value.endEnabled} onChange={(v) => set({ endEnabled: v })} label={t("recurrenceEnd")} />
          {value.endEnabled && (
            <AnchorScopeField kind={anchorKind} date={value.endDate} onChange={(endDate) => set({ endDate })} />
          )}

          <div className={styles.label}>
            {t("consumption")}
            <div className={styles.statusPills}>
              {(["destructive", "accumulating"] as ConsumptionKind[]).map((kind) => (
                <button
                  key={kind}
                  type="button"
                  className={`${styles.statusPill}${value.consumptionKind === kind ? ` ${styles.statusPillActive}` : ""}`}
                  onClick={() => set({ consumptionKind: kind })}
                >
                  {t(kind === "destructive" ? "consumptionDestructive" : "consumptionAccumulating")}
                </button>
              ))}
            </div>
          </div>

          {value.consumptionKind === "accumulating" && (
            <div className={styles.statusPills}>
              {(["overlapping", "blocking"] as BlockingMode[]).map((mode) => (
                <button
                  key={mode}
                  type="button"
                  className={`${styles.statusPill}${value.blockingMode === mode ? ` ${styles.statusPillActive}` : ""}`}
                  onClick={() => set({ blockingMode: mode })}
                >
                  {t(mode === "overlapping" ? "blockingOverlapping" : "blockingBlocking")}
                </button>
              ))}
            </div>
          )}

          {value.consumptionKind === "accumulating" && value.blockingMode === "blocking" && (
            <div className={styles.label}>
              {t("catchup")}
              <div className={styles.statusPills}>
                {CATCHUP_POLICIES.map((policy) => (
                  <button
                    key={policy}
                    type="button"
                    className={`${styles.statusPill}${value.catchupPolicy === policy ? ` ${styles.statusPillActive}` : ""}`}
                    onClick={() => set({ catchupPolicy: policy })}
                  >
                    {catchupLabel(policy)}
                  </button>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
