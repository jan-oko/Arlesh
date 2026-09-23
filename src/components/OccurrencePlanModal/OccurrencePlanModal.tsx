import { useState } from "react";
import { useTranslation } from "react-i18next";
import { getErrorMessage } from "@/api/errors";
import type { PlanOverride } from "@/api/flows";
import type { TimeScope } from "@/api/time-scope";
import EditorModal from "@/components/EditorModal/EditorModal";
import PlanField from "@/components/ScopePicker/PlanField";
import { useInputCapture } from "@/hooks/use-input-capture";
import { useScopeRangeLabel } from "@/hooks/use-scope-range-label";
import { currentPlanOverride } from "@/hooks/use-occurrence-plan";
import type { MindmapNode } from "@/utils/tree-layout";
import styles from "@/components/EditorModal/EditorModal.module.css";

type Mode = PlanOverride["kind"];

const MODES: readonly Mode[] = ["inherit", "planned", "unplanned"];

interface Props {
  /** The occurrence being planned — a virtual Habit task occurrence. */
  node: MindmapNode;
  onSave: (plan: PlanOverride) => Promise<void>;
  onClose: () => void;
}

/**
 * Plans one Habit occurrence on its own: follow the Cycle Plan, plan this occurrence with the same
 * Plan field a Task uses, or leave it deliberately unplanned. Next occurrence is untouched either
 * way, and nothing here asks about the others — changing all of them is the Cycle Plan's job.
 */
export default function OccurrencePlanModal({ node, onSave, onClose }: Props) {
  useInputCapture();
  const { t } = useTranslation("editor");
  const initial = currentPlanOverride(node);
  const [mode, setMode] = useState<Mode>(initial.kind);
  const [plan, setPlan] = useState<TimeScope | null>(initial.kind === "planned" ? initial.plan : null);
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const cyclePlanLabel = useScopeRangeLabel(node.cyclePlan);

  function choosePlan(next: TimeScope | null) {
    setPlan(next);
    // The Plan field's Clear means "no plan", which for an occurrence is the deliberate choice.
    if (next === null) setMode("unplanned");
  }

  function chosen(): PlanOverride | null {
    if (mode === "inherit") return { kind: "inherit" };
    if (mode === "unplanned") return { kind: "unplanned" };
    return plan === null ? null : { kind: "planned", plan };
  }

  async function handleSave() {
    const next = chosen();
    if (next === null) {
      setSaveError(t("occurrencePlan.pickAPlan"));
      return;
    }
    setIsSaving(true);
    setSaveError(null);
    try {
      await onSave(next);
    } catch (error: unknown) {
      setSaveError(getErrorMessage(error));
      setIsSaving(false);
    }
  }

  function handleKeyDown(event: React.KeyboardEvent) {
    if (event.key === "Escape") onClose();
  }

  const cyclePlanSummary =
    node.cyclePlan == null
      ? t("occurrencePlan.noCyclePlan")
      : t("occurrencePlan.cyclePlan", { value: cyclePlanLabel ?? "…" });

  return (
    <EditorModal
      heading={t("occurrencePlan.heading", { title: node.title })}
      onClose={onClose}
      onKeyDown={handleKeyDown}
      isSaving={isSaving}
      onSave={() => void handleSave()}
      saveError={saveError}
      focusOnOpen="cancel"
    >
      <div className={styles.label}>
        {t("fieldPlan")}
        <div className={styles.statusPills} role="radiogroup" aria-label={t("fieldPlan")}>
          {MODES.map((option) => (
            <button
              key={option}
              type="button"
              role="radio"
              aria-checked={mode === option}
              className={`${styles.statusPill}${mode === option ? ` ${styles.statusPillActive}` : ""}`}
              onClick={() => setMode(option)}
            >
              {t(`occurrencePlan.${option}`)}
            </button>
          ))}
        </div>
      </div>
      <p className={styles.label}>{cyclePlanSummary}</p>
      {mode === "planned" && (
        <div className={styles.label}>
          <PlanField value={plan} timeScope={node.timeScope ?? null} onChange={choosePlan} />
        </div>
      )}
    </EditorModal>
  );
}
