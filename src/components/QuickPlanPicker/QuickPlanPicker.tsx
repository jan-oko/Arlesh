import { useCallback, useLayoutEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import type { TimeScope } from "@/api/time-scope";
import ScopePicker from "@/components/ScopePicker/ScopePicker";
import { useInputCapture } from "@/hooks/use-input-capture";
import { usePlanPicker } from "@/hooks/use-plan-picker";
import { usePopoverDismiss } from "@/hooks/use-popover-dismiss";
import type { QuickPlanTarget } from "@/hooks/use-quick-plan";
import { findAnchorElement } from "@/utils/anchor-element";
import fieldStyles from "@/components/ScopePicker/ScopeField.module.css";
import styles from "./QuickPlanPicker.module.css";

/** Room kept between the popover and the anchor, and between it and the window's edges. */
const GAP_PX = 6;

interface Position {
  top: number;
  left: number;
}

/**
 * Where the popover goes: below the anchor's box, left edges aligned — or above it when there is no
 * room below — and never past the window's edges. With no anchor drawn, the window's top-left.
 */
function positionFor(anchor: DOMRect | null, size: { width: number; height: number }): Position {
  if (anchor === null) return { top: GAP_PX, left: GAP_PX };
  const below = anchor.bottom + GAP_PX;
  const fitsBelow = below + size.height <= window.innerHeight - GAP_PX;
  const top = fitsBelow ? below : Math.max(GAP_PX, anchor.top - GAP_PX - size.height);
  const left = Math.max(GAP_PX, Math.min(anchor.left, window.innerWidth - GAP_PX - size.width));
  return { top, left };
}

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
 * share `usePlanPicker`). It dismisses the way every inline picker does — **Enter** or a click
 * outside applies the selection (with nothing picked, it just closes), **Esc** closes and writes
 * nothing — and it holds the keyboard while it is open, so the view's own letters stay quiet.
 */
export default function QuickPlanPicker({ target, anchorAttribute, onApply, onClose }: Props) {
  useInputCapture();
  const { t } = useTranslation("editor");
  const { picker, constraint, opening } = usePlanPicker(target.value, target.timeScope, true);
  // The picker re-mounts on this when a late-arriving Plan moves its opening, and may change size.
  const openingKey = opening === null ? "default" : `${opening.kind}:${opening.anchor}`;
  const ref = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<Position>({ top: GAP_PX, left: GAP_PX });

  useLayoutEffect(() => {
    function place() {
      const anchor = findAnchorElement(anchorAttribute, target.anchorId);
      const own = ref.current?.getBoundingClientRect();
      const size = { width: own?.width ?? 0, height: own?.height ?? 0 };
      const next = positionFor(anchor?.getBoundingClientRect() ?? null, size);
      setPosition((current) => (current.top === next.top && current.left === next.left ? current : next));
    }
    place();
    window.addEventListener("resize", place);
    return () => window.removeEventListener("resize", place);
  }, [anchorAttribute, target.anchorId, openingKey]);

  const commit = useCallback(() => {
    // An empty selection is an unanswered question, not a request to clear: only Clear clears.
    void picker.resolve().then((plan) => (plan === null ? onClose() : onApply(plan)));
  }, [picker, onApply, onClose]);

  usePopoverDismiss(ref, true, commit, onClose);

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
