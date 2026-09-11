import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import type { BindingMeta, HotkeyLabelKey, Section } from "@/utils/hotkeys/chord";
import { formatChord } from "@/utils/hotkeys/chord";
import { GLOBAL_BINDINGS } from "@/utils/hotkeys/global-bindings";
import { MINDMAP_BINDINGS } from "@/utils/hotkeys/mindmap-bindings";
import { LIST_BINDINGS } from "@/utils/hotkeys/list-bindings";
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

/** Ctrl+Shift+/ cheat-sheet: every keyboard binding, grouped by the surface it applies to. */
export default function HotkeysModal({ onClose }: Props) {
  const { t } = useTranslation(["hotkeys"]);

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
      <div className={styles.modal} onClick={(e) => e.stopPropagation()} role="dialog" aria-label={t("hotkeys:title")}>
        <h2 className={styles.title}>{t("hotkeys:title")}</h2>
        <div className={styles.sections}>
          {SECTIONS.map(({ section, titleKey }) => {
            const rows = ALL_BINDINGS.filter((b) => b.section === section && b.hidden !== true);
            if (rows.length === 0) return null;
            return (
              <section key={section} className={styles.section}>
                <h3 className={styles.sectionTitle}>{t(`hotkeys:${titleKey}`)}</h3>
                <dl className={styles.list}>
                  {rows.map((binding) => (
                    <div key={binding.id} className={styles.row}>
                      <dt className={styles.chord}><kbd>{formatChord(binding.chord)}</kbd></dt>
                      <dd className={styles.label}>{t(`hotkeys:${binding.labelKey}`)}</dd>
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
