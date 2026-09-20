import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import type { SubtreeCrumb } from "@/stores/use-mindmap-store";
import styles from "./SubtreeBreadcrumb.module.css";

interface Props {
  /** The levels the breadcrumb had no room for, in the order they appear on the way down. */
  crumbs: readonly SubtreeCrumb[];
  /** How far across the breadcrumb the `…` sits, so the menu opens under it and not beside it. */
  offset: number;
  onSelect: (crumb: SubtreeCrumb) => void;
  onClose: () => void;
}

/**
 * The levels folded out of the breadcrumb, offered as a menu so that nothing a chain drops becomes
 * unreachable — picking one exits to it exactly as its segment would have.
 *
 * Rendered outside the chain it belongs to, because that chain clips what does not fit and would
 * clip this popover with it. `Escape` closes it: the subtree's own `Shift`/`Ctrl+Escape` are
 * modified chords, so the bare key is free to mean "never mind" here.
 */
export default function FoldedCrumbsMenu({ crumbs, offset, onSelect, onClose }: Props) {
  const { t } = useTranslation("common");

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key !== "Escape" || e.shiftKey || e.ctrlKey) return;
      e.preventDefault();
      onClose();
    }
    window.addEventListener("keydown", handleKeyDown, { capture: true });
    return () => window.removeEventListener("keydown", handleKeyDown, { capture: true });
  }, [onClose]);

  return (
    <>
      <div className={styles.backdrop} onClick={onClose} />
      <div className={styles.menu} style={{ insetInlineStart: offset }} role="menu" aria-label={t("foldedLevels")}>
        {crumbs.map((crumb) => (
          <button
            key={crumb.id ?? "root"}
            type="button"
            role="menuitem"
            className={styles.menuItem}
            dir="auto"
            onClick={() => { onSelect(crumb); onClose(); }}
          >
            {crumb.title}
          </button>
        ))}
      </div>
    </>
  );
}
