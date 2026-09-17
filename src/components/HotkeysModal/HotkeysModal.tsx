import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import type { BindingMeta, HotkeyLabelKey, Section } from "@/utils/hotkeys/chord";
import { formatChord } from "@/utils/hotkeys/chord";
import { GLOBAL_BINDINGS } from "@/utils/hotkeys/global-bindings";
import { MINDMAP_BINDINGS } from "@/utils/hotkeys/mindmap-bindings";
import { LIST_BINDINGS } from "@/utils/hotkeys/list-bindings";
import { useFocusTrap } from "@/hooks/use-focus-trap";
import { useInputCapture } from "@/hooks/use-input-capture";
import styles from "./HotkeysModal.module.css";

interface Props {
  onClose: () => void;
}

const SECTIONS: ReadonlyArray<{ section: Section; titleKey: HotkeyLabelKey }> = [
  { section: "global", titleKey: "sectionGlobal" },
  { section: "mindmap", titleKey: "sectionMindmap" },
  { section: "listView", titleKey: "sectionListView" },
];

/** Every binding in the app, display-side only — the same tables the handlers dispatch from. */
const ALL_BINDINGS: readonly BindingMeta[] = [...GLOBAL_BINDINGS, ...MINDMAP_BINDINGS, ...LIST_BINDINGS];

interface Row {
  labelKey: HotkeyLabelKey;
  chords: string[];
}

/**
 * One row per distinct action, carrying every chord that triggers it — so the four arrow keys read
 * as a single "← → ↑ ↓ move between cells" row rather than four identical lines. Order follows each
 * action's first appearance in the table.
 */
function rowsFor(section: Section): Row[] {
  const rows: Row[] = [];
  for (const binding of ALL_BINDINGS) {
    if (binding.section !== section || binding.hidden === true) continue;
    const chord = formatChord(binding.chord);
    const existing = rows.find((r) => r.labelKey === binding.labelKey);
    if (existing === undefined) rows.push({ labelKey: binding.labelKey, chords: [chord] });
    else if (!existing.chords.includes(chord)) existing.chords.push(chord);
  }
  return rows;
}

/** Ctrl+Shift+/ cheat-sheet: every keyboard binding, grouped by the surface it applies to. */
export default function HotkeysModal({ onClose }: Props) {
  useInputCapture();
  const modalRef = useFocusTrap<HTMLDivElement>();
  const { t } = useTranslation(["hotkeys", "common"]);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.code !== "Escape") return;
      event.preventDefault();
      event.stopImmediatePropagation();
      onClose();
    }
    window.addEventListener("keydown", handleKeyDown, { capture: true });
    return () => window.removeEventListener("keydown", handleKeyDown, { capture: true });
  }, [onClose]);

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div
        ref={modalRef}
        className={styles.modal}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={t("hotkeys:title")}
      >
        {/* The sheet was all text — nothing to tab to, so Tab walked straight out into the page
            behind it, and the only way out was a key the sheet itself had to teach you. Close is
            both the affordance and the tab stop the trap holds on to. */}
        <div className={styles.titleRow}>
          <h2 className={styles.title}>{t("hotkeys:title")}</h2>
          <button type="button" className={styles.closeBtn} onClick={onClose}>{t("common:close")}</button>
        </div>
        <div className={styles.sections}>
          {SECTIONS.map(({ section, titleKey }) => {
            const rows = rowsFor(section);
            if (rows.length === 0) return null;
            return (
              <section key={section} className={styles.section}>
                <h3 className={styles.sectionTitle}>{t(`hotkeys:${titleKey}`)}</h3>
                <dl className={styles.list}>
                  {rows.map((row) => (
                    <div key={row.labelKey} className={styles.row}>
                      <dt className={styles.chord}>
                        {row.chords.map((chord) => <kbd key={chord}>{chord}</kbd>)}
                      </dt>
                      <dd className={styles.label}>{t(`hotkeys:${row.labelKey}`)}</dd>
                    </div>
                  ))}
                </dl>
              </section>
            );
          })}
        </div>
      </div>
    </div>
  );
}
