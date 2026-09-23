import { useState } from "react";
import { useTranslation } from "react-i18next";
import { getErrorMessage } from "@/api/errors";
import type { FlowItemRef, PlanOverride } from "@/api/flows";
import type { TimeScope } from "@/api/time-scope";
import EditorModal from "@/components/EditorModal/EditorModal";
import PlanField from "@/components/ScopePicker/PlanField";
import { useInputCapture } from "@/hooks/use-input-capture";
import { useScopeRangeLabel } from "@/hooks/use-scope-range-label";
import { currentEdits } from "@/hooks/use-occurrence-editor";
import type { FlowItemOption, OccurrenceEdits } from "@/hooks/use-occurrence-editor";
import type { MindmapNode } from "@/utils/tree-layout";
import styles from "@/components/EditorModal/EditorModal.module.css";

type Mode = PlanOverride["kind"];

const MODES: readonly Mode[] = ["inherit", "planned", "unplanned"];

function sameRef(a: FlowItemRef, b: FlowItemRef): boolean {
  return a.item_type === b.item_type && a.item_id === b.item_id;
}

interface Props {
  /** The occurrence being edited — a virtual Habit item occurrence. */
  node: MindmapNode;
  /** The other items of its Habit it could wait on. */
  candidates: FlowItemOption[];
  onSave: (edits: OccurrenceEdits) => Promise<void>;
  /** Deletes the occurrence from its iteration (`true`) or restores it (`false`). */
  onSetDeleted: (deleted: boolean) => Promise<void>;
  onClose: () => void;
}

/**
 * Edits one Habit occurrence on its own: its title, its block reason and — for a task — its Plan
 * and what it waits on in this iteration; and deletes it from this iteration, or restores it.
 * Everything here diverges from the template for this occurrence alone, and putting a field back
 * to what the template says hands it back. Status stays on the node's own status control.
 */
export default function OccurrenceEditorModal({ node, candidates, onSave, onSetDeleted, onClose }: Props) {
  useInputCapture();
  const { t } = useTranslation("editor");
  const initial = currentEdits(node);
  const isTask = node.kind === "task";
  const deleted = node.occurrence?.deleted === true;
  const [title, setTitle] = useState(initial.title);
  const [blockedReason, setBlockedReason] = useState(initial.blockedReason);
  const [mode, setMode] = useState<Mode>(initial.plan.kind);
  const [plan, setPlan] = useState<TimeScope | null>(initial.plan.kind === "planned" ? initial.plan.plan : null);
  const [dependsOn, setDependsOn] = useState<FlowItemRef[]>(initial.dependsOn);
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const cyclePlanLabel = useScopeRangeLabel(node.cyclePlan);

  function choosePlan(next: TimeScope | null) {
    setPlan(next);
    // The Plan field's Clear means "no plan", which for an occurrence is the deliberate choice.
    if (next === null) setMode("unplanned");
  }

  function chosenPlan(): PlanOverride | null {
    if (mode === "inherit") return { kind: "inherit" };
    if (mode === "unplanned") return { kind: "unplanned" };
    return plan === null ? null : { kind: "planned", plan };
  }

  function toggleDependency(ref: FlowItemRef) {
    setDependsOn((current) =>
      current.some((existing) => sameRef(existing, ref))
        ? current.filter((existing) => !sameRef(existing, ref))
        : [...current, ref],
    );
  }

  async function run(action: () => Promise<void>) {
    setIsSaving(true);
    setSaveError(null);
    try {
      await action();
    } catch (error: unknown) {
      setSaveError(getErrorMessage(error));
      setIsSaving(false);
    }
  }

  function handleSave() {
    const nextPlan = chosenPlan();
    if (nextPlan === null) {
      setSaveError(t("occurrence.pickAPlan"));
      return;
    }
    void run(() => onSave({ title, blockedReason, plan: nextPlan, dependsOn }));
  }

  function handleKeyDown(event: React.KeyboardEvent) {
    if (event.key === "Escape") onClose();
  }

  const cyclePlanSummary =
    node.cyclePlan == null
      ? t("occurrence.noCyclePlan")
      : t("occurrence.cyclePlan", { value: cyclePlanLabel ?? "…" });

  return (
    <EditorModal
      heading={t("occurrence.heading", { title: node.occurrence?.templateTitle ?? node.title })}
      onClose={onClose}
      onKeyDown={handleKeyDown}
      isSaving={isSaving}
      onSave={handleSave}
      saveError={saveError}
      focusOnOpen="cancel"
    >
      <label className={styles.label}>
        {t("fieldTitle")}
        <input
          className={styles.input}
          value={title}
          placeholder={node.occurrence?.templateTitle ?? ""}
          onChange={(event) => setTitle(event.target.value)}
          type="text"
        />
      </label>
      <label className={styles.label}>
        {t("occurrence.blockReason")}
        <input
          className={styles.input}
          value={blockedReason}
          onChange={(event) => setBlockedReason(event.target.value)}
          type="text"
        />
      </label>
      {isTask && (
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
                {t(`occurrence.plan.${option}`)}
              </button>
            ))}
          </div>
          <span>{cyclePlanSummary}</span>
          {mode === "planned" && (
            <PlanField value={plan} timeScope={node.timeScope ?? null} onChange={choosePlan} />
          )}
        </div>
      )}
      {isTask && candidates.length > 0 && (
        <div className={`${styles.label} ${styles.tagSection}`} role="group" aria-label={t("occurrence.waitsOn")}>
          {t("occurrence.waitsOn")}
          <div className={styles.tagList}>
            {candidates.map((candidate) => (
              <label key={`${candidate.ref.item_type}-${candidate.ref.item_id}`} className={styles.tagOption}>
                <input
                  type="checkbox"
                  checked={dependsOn.some((ref) => sameRef(ref, candidate.ref))}
                  onChange={() => toggleDependency(candidate.ref)}
                />
                {candidate.title}
              </label>
            ))}
          </div>
        </div>
      )}
      <button
        type="button"
        className={styles.advancedToggle}
        disabled={isSaving}
        onClick={() => void run(() => onSetDeleted(!deleted))}
      >
        {deleted ? t("occurrence.restore") : t("occurrence.delete")}
      </button>
    </EditorModal>
  );
}
