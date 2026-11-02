import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import type { ArchiveOffer } from "@/utils/hand-archive";
import styles from "@/components/NodeContextMenu/NodeContextMenu.module.css";

interface Props {
  x: number;
  y: number;
  /** The hand archive's item: Archive, or Unarchive on the one archived; `null` on a row that takes none. */
  archive: ArchiveOffer;
  onArchive: () => void;
  /** Opens the row's editor (the row is already selected). */
  onEdit: () => void;
  onClose: () => void;
}

/**
 * The List View's row context menu. It holds Edit — on every row, since full screen hides the action
 * bar's — and the hand archive (Task 269): Archive, or Unarchive on the row archived. Nothing else:
 * every other row gesture already has its key. Drawn in the Mindmap's menu style; a click outside closes it.
 */
export default function RowContextMenu({ x, y, archive, onArchive, onEdit, onClose }: Props) {
  const { t } = useTranslation("contextMenu");
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (event: MouseEvent) => {
      if (ref.current !== null && event.target instanceof Node && !ref.current.contains(event.target)) onClose();
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [onClose]);

  return createPortal(
    <div ref={ref} className={styles.menu} style={{ left: x, top: y }} role="menu">
      <button type="button" role="menuitem" className={styles.item} onClick={() => { onEdit(); onClose(); }}>
        {t("edit")}
      </button>
      {archive !== null && (
        <button type="button" role="menuitem" className={styles.item} onClick={() => { onArchive(); onClose(); }}>
          {t(archive)}
        </button>
      )}
    </div>,
    document.body,
  );
}
