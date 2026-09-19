import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { TimeScope } from "@/api/time-scope";
import EditorModal from "@/components/EditorModal/EditorModal";
import TimeScopeField from "@/components/ScopePicker/TimeScopeField";
import { useInputCapture } from "@/hooks/use-input-capture";
import styles from "@/components/EditorModal/EditorModal.module.css";

interface Props {
  /** The node being retyped, named so the question is about something rather than about a rule. */
  title: string;
  /** The chosen window, or `null` to cancel and leave the node exactly as it was. */
  onResolve: (timeScope: TimeScope | null) => void;
}

/**
 * The question a Commitment with nowhere to get a window from is asked, in place of a refusal.
 *
 * Commitment stays in the type cycle whether or not a window is in reach, because an option that
 * silently is not there reads as a missing feature rather than as a rule. The rule is enforced
 * where it always was — the backend refuses to write a commitment that could never come due — but
 * that refusal now arrives here as something answerable.
 *
 * It only ever opens when there is genuinely nothing to inherit: the refusal comes from the same
 * effective-scope climb the rest of the app uses, so a node under a scoped ancestor is never
 * asked for something it already has. Cancelling writes nothing at all — the retype is one atomic
 * call that has not happened yet — so the node is left exactly as it was, half of nothing.
 */
export default function CommitmentScopePrompt({ title, onResolve }: Props) {
  useInputCapture();
  const { t } = useTranslation("warnings");
  const [timeScope, setTimeScope] = useState<TimeScope | null>(null);
  const [missing, setMissing] = useState(false);

  function handleSave(): void {
    if (timeScope === null) {
      setMissing(true);
      return;
    }
    onResolve(timeScope);
  }

  return (
    <EditorModal
      heading={t("commitmentNeedsScopeHeading", { title })}
      onClose={() => onResolve(null)}
      onKeyDown={(event) => { if (event.key === "Escape") onResolve(null); }}
      focusOnOpen="cancel"
      isSaving={false}
      onSave={handleSave}
      saveError={missing ? t("commitmentNeedsScopeMissing") : null}
    >
      <p className={styles.label}>{t("commitmentNeedsScopeBody")}</p>
      <TimeScopeField
        value={timeScope}
        onChange={(value) => { setTimeScope(value); setMissing(false); }}
      />
    </EditorModal>
  );
}
