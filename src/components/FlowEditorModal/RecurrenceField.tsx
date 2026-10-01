import { useTranslation } from "react-i18next";
import type { ClockKind, CooldownKind, MissPolicy } from "@/api/flows";
import { cooldownKinds, effectiveCooldown, maxCooldown, recurrenceStartKind, takesCooldown, type RecurrenceUi } from "./recurrence-ui";
import Switch from "@/components/Switch/Switch";
import AnchorScopeField from "@/components/ScopePicker/AnchorScopeField";
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
  /** The owning flow's Duration count — how many `durationKind` periods one window spans. */
  durationN: number;
  /**
   * Whether the flow has a window. An Unscoped Habit can only keep an Interval clock, so the clock
   * choice is not offered at all.
   */
  scoped: boolean;
  /** Whether the Habit can take a cooldown at all: not a commitment one, which never completes. */
  offersCooldown?: boolean;
}

/**
 * Edits a flow's **Recurrence** — the **clock** (Window, with what a missed iteration does, or
 * Interval) and the Repetition (Start, optional Gap, optional end) that turn it into a **Habit**.
 * Controls run clock, miss policy (Window only), Starts, Gap, Ends; each choice explains itself in
 * its tooltip. Controlled; the parent turns dates into scope keys and persists.
 */
export default function RecurrenceField({ value, onChange, durationKind, durationN, scoped, offersCooldown = true }: Props) {
  const { t } = useTranslation("editor");
  const set = (patch: Partial<RecurrenceUi>) => onChange({ ...value, ...patch });
  const anchorKind = recurrenceStartKind(durationKind);
  // Unscoped, the clock is Interval whatever was last picked: a Window has nothing to repeat.
  const clock: ClockKind = scoped ? value.clock : "interval";

  const clockLabel = (kind: ClockKind): string => (kind === "window" ? t("clockWindow") : t("clockInterval"));
  const clockHint = (kind: ClockKind): string => (kind === "window" ? t("clockWindowHint") : t("clockIntervalHint"));
  const policyLabel = (policy: MissPolicy): string =>
    policy === "archive" ? t("missPolicyArchive") : policy === "overdue" ? t("missPolicyOverdue") : t("missPolicyOwed");
  const cooldownLabel = (kind: CooldownKind): string =>
    kind === "part" ? t("cooldownUnitPart") : kind === "day" ? t("cooldownUnitDay") : kind === "week" ? t("cooldownUnitWeek") : t("cooldownUnitMonth");
  // A Window Habit's cooldown, offered on a window that has a finer unit to count it in. What it
  // shows is what is saved: a unit the window no longer takes reads as the first it does.
  const unitChoices = cooldownKinds(durationKind);
  const cooldown = effectiveCooldown({ ...value, cooldownEnabled: true }, clock, durationKind, durationN);
  const policyHint = (policy: MissPolicy): string =>
    policy === "archive" ? t("missPolicyArchiveHint") : policy === "overdue" ? t("missPolicyOverdueHint") : t("missPolicyOwedHint");

  return (
    <div className={styles.section}>
      <Switch checked={value.isHabit} onChange={(v) => set({ isHabit: v })} label={t("makeHabit")} />
      {value.isHabit && (
          <div className={styles.body}>
              {scoped && (
                <div className={editorStyles.statusPills} role="group" aria-label={t("clock")}>
                  {CLOCKS.map((kind) => (
                    <button
                      key={kind}
                      type="button"
                      title={clockHint(kind)}
                      className={`${editorStyles.statusPill}${clock === kind ? ` ${editorStyles.statusPillActive}` : ""}`}
                      aria-pressed={clock === kind}
                      onClick={() => set({ clock: kind })}
                    >
                      {clockLabel(kind)}
                    </button>
                  ))}
                </div>
              )}

              {clock === "window" && (
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

              {offersCooldown && takesCooldown(clock) && cooldown.cooldownKind !== null && durationKind !== null && (
                <div className={styles.row} title={t("recurrenceCooldownHint")}>
                  <Switch
                    checked={value.cooldownEnabled}
                    onChange={(v) => set({ cooldownEnabled: v, cooldownKind: cooldown.cooldownKind ?? value.cooldownKind })}
                    label={t("recurrenceCooldown")}
                  />
                  {value.cooldownEnabled && (
                    <>
                      <input
                        type="number"
                        min={1}
                        max={maxCooldown(cooldown.cooldownKind, durationKind, durationN)}
                        aria-label={t("recurrenceCooldown")}
                        className={`${editorStyles.control} ${editorStyles.numberInput}`}
                        value={cooldown.cooldownN ?? 1}
                        onChange={(e) => set({ cooldownN: Math.max(1, Number(e.target.value)), cooldownKind: cooldown.cooldownKind ?? value.cooldownKind })}
                      />
                      <select
                        aria-label={t("recurrenceCooldown")}
                        className={`${editorStyles.control} ${editorStyles.select}`}
                        value={cooldown.cooldownKind}
                        onChange={(e) => {
                          const picked = unitChoices.find((kind) => kind === e.target.value);
                          if (picked !== undefined) set({ cooldownKind: picked });
                        }}
                      >
                        {unitChoices.map((kind) => (
                          <option key={kind} value={kind}>{cooldownLabel(kind)}</option>
                        ))}
                      </select>
                    </>
                  )}
                </div>
              )}

              <div className={styles.row}>
                <Switch checked={value.endEnabled} onChange={(v) => set({ endEnabled: v })} label={t("recurrenceEnd")} />
                {value.endEnabled && (
                  <AnchorScopeField kind={anchorKind} date={value.endDate} onChange={(endDate) => set({ endDate })} />
                )}
              </div>
          </div>
      )}
    </div>
  );
}
