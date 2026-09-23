import { useCallback, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useScopePicker } from "@/hooks/use-scope-picker";
import { useScopeLabels } from "@/hooks/use-scope-labels";
import { usePopoverDismiss } from "@/hooks/use-popover-dismiss";
import { formatScopeAnchor } from "@/utils/scope-format";
import ScopePicker from "./ScopePicker";
import styles from "./ScopeField.module.css";

interface Props {
  /** The picked Day, `YYYY-MM-DD`, or `null` for "from when it is saved". */
  value: string | null;
  onChange: (date: string | null) => void;
  /** What an empty value reads as. */
  emptyLabel: string;
}

/**
 * A Day to start from — Check every's **Starting**. The app's own Day picker in a popover that
 * closes the way the others do: a click outside, Enter or Apply commits, Escape cancels.
 *
 * It replaced a native `<input type="date">`, whose calendar WebKitGTK draws as a GTK popover
 * outside the page: it never saw the page's clicks, so the only way to close it was Escape.
 */
export default function StartingDayField({ value, onChange, emptyLabel }: Props) {
  const { t } = useTranslation("editor");
  const [open, setOpen] = useState(false);
  const labels = useScopeLabels();
  const picker = useScopePicker("single");
  const popoverRef = useRef<HTMLDivElement>(null);
  const { seed, single } = picker;

  const toggle = () => {
    if (!open) seed(value === null ? [] : [{ kind: "day", date: value }]);
    setOpen((current) => !current);
  };
  const commit = useCallback(() => {
    if (single !== null && single.kind === "day") onChange(single.date);
    setOpen(false);
  }, [single, onChange]);
  const cancel = useCallback(() => setOpen(false), []);
  usePopoverDismiss(popoverRef, open, commit, cancel);

  return (
    <div className={styles.field}>
      <div className={styles.summaryRow}>
        <span className={styles.summary}>{value === null ? emptyLabel : formatScopeAnchor("day", value, labels)}</span>
        <button type="button" className={styles.button} onClick={toggle}>
          {open ? t("scopeClose") : t("scopeEdit")}
        </button>
        {value !== null && (
          <button type="button" className={styles.button} onClick={() => onChange(null)}>
            {t("scopeClear")}
          </button>
        )}
      </div>
      {open && (
        <div ref={popoverRef} className={styles.popover} role="group" aria-label={t("startingPicker")}>
          <ScopePicker picker={picker} initialKind="day" lockKind {...(value !== null ? { initialAnchor: value } : {})} />
          <button type="button" className={`${styles.button} ${styles.primary}`} onClick={commit}>
            {t("scopeApply")}
          </button>
        </div>
      )}
    </div>
  );
}
