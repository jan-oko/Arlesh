import { useCallback, useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";

import type { TimeScope } from "@/api/time-scope";
import ScopePicker from "@/components/ScopePicker/ScopePicker";
import { useAnchoredPosition } from "@/hooks/use-anchored-position";
import { useInputCapture } from "@/hooks/use-input-capture";
import { usePlanPicker } from "@/hooks/use-plan-picker";
import type { QuickPlanTarget } from "@/hooks/use-quick-plan";
import fieldStyles from "@/components/ScopePicker/ScopeField.module.css";
import styles from "./QuickPlanPicker.module.css";

interface Props {
  target: QuickPlanTarget;
  /** The attribute the view marks each drawn node with — `data-node-id`, `data-row-id`, … */
  anchorAttribute: string;
  /** Writes the pick: a Plan, or `null` to clear it. */
  onApply: (plan: TimeScope | null) => void;
  /** Closes without writing. */
  onClose: () => void;
}

/**
 * The `P` quick picker: the editor's Plan picker, drawn at the selected node on its own.
 *
 * It is the same Scope Picker, constrained and opened exactly as the editor's Plan field is (they
 * share `usePlanPicker`), with the picker's own keyboard (`SCOPE_PICKER_KEYS`) live from the
 * moment it opens: arrows highlight, Space picks, Enter steps in, `[` `]` `\` browse and ascend.
 * **Ctrl+Enter**, Apply or a click outside applies the selection (with nothing picked, it just
 * closes); **Esc** closes and writes nothing. It holds the keyboard while it is open, so the view's
 * own letters stay quiet.
 */
export default function QuickPlanPicker({ target, anchorAttribute, onApply, onClose }: Props) {
  useInputCapture();
  const { t } = useTranslation("editor");
  const { picker, constraint, opening } = usePlanPicker(target.value, target.timeScope, true);
  // The picker re-mounts on this when a late-arriving Plan moves its opening, and may change size.
  const openingKey = opening === null ? "default" : `${opening.kind}:${opening.anchor}`;
  const ref = useRef<HTMLDivElement>(null);
  const position = useAnchoredPosition(ref, anchorAttribute, target.anchorId, openingKey);

  const commit = useCallback(() => {
    // An empty selection is an unanswered question, not a request to clear: only Clear clears.
    void picker.resolve().then((plan) => (plan === null ? onClose() : onApply(plan)));
  }, [picker, onApply, onClose]);

  // Esc closes and Ctrl+Enter applies wherever the focus is; a click outside applies, as with every
  // inline picker. Plain Enter is left to the grid, where it steps into the highlighted scope.
  useEffect(() => {
    function onMouseDown(event: MouseEvent) {
      const inside = event.target instanceof Node && ref.current !== null && ref.current.contains(event.target);
      if (!inside) commit();
    }
    function onKeyDown(event: KeyboardEvent) {
      const close = event.key === "Escape";
      const apply = event.key === "Enter" && event.ctrlKey;
      if (!close && !apply) return;
      event.stopPropagation();
      event.preventDefault();
      if (close) onClose(); else commit();
    }
    document.addEventListener("mousedown", onMouseDown, true);
    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      document.removeEventListener("mousedown", onMouseDown, true);
      document.removeEventListener("keydown", onKeyDown, true);
    };
  }, [commit, onClose]);

  const lead = target.tasks[0];
  const heading = target.tasks.length === 1 && lead !== undefined
    ? t("quickPlanHeading", { title: lead.title })
    : t("quickPlanHeadingMany", { count: target.tasks.length });
  const anyPlanned = target.tasks.some((task) => task.plan != null);

  return (
    <div
      ref={ref}
      className={styles.popover}
      style={{ top: position.top, left: position.left }}
      role="dialog"
      aria-label={t("quickPlanPicker")}
    >
      <span className={styles.heading}>{heading}</span>
      {/* Keyed on the opening so a late-arriving scope re-opens the picker on it. */}
      <ScopePicker
        key={openingKey}
        picker={picker}
        autoFocus
        initialKind={opening?.kind ?? "day"}
        {...(opening ? { initialAnchor: opening.anchor } : {})}
        {...(constraint ? { constraint } : {})}
      />
      <div className={styles.actions}>
        {anyPlanned && (
          <button type="button" className={fieldStyles.button} onClick={() => onApply(null)}>
            {t("scopeClear")}
          </button>
        )}
        <button type="button" className={`${fieldStyles.button} ${fieldStyles.primary}`} onClick={commit}>
          {t("scopeApply")}
        </button>
      </div>
    </div>
  );
}
