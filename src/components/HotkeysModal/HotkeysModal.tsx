import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import type { BindingMeta, HotkeyLabelKey, Section } from "@/utils/hotkeys/chord";
import { formatChord } from "@/utils/hotkeys/chord";
import { GLOBAL_BINDINGS } from "@/utils/hotkeys/global-bindings";
import { TAB_BINDINGS } from "@/utils/hotkeys/tab-bindings";
import { MINDMAP_BINDINGS } from "@/utils/hotkeys/mindmap-bindings";
import { LIST_BINDINGS } from "@/utils/hotkeys/list-bindings";
import { PLAN_BINDINGS } from "@/utils/hotkeys/plan-bindings";
import { STEPS_BINDINGS } from "@/utils/hotkeys/steps-bindings";
import { useInputCapture } from "@/hooks/use-input-capture";
import styles from "./HotkeysModal.module.css";

interface Props {
  onClose: () => void;
}

const SECTIONS: ReadonlyArray<{ section: Section; titleKey: HotkeyLabelKey }> = [
  { section: "global", titleKey: "sectionGlobal" },
  { section: "tabs", titleKey: "sectionTabs" },
  { section: "mindmap", titleKey: "sectionMindmap" },
  { section: "listView", titleKey: "sectionListView" },
  { section: "planView", titleKey: "sectionPlanView" },
  { section: "stepsView", titleKey: "sectionStepsView" },
];

/** Every binding in the app, display-side only — the same tables the handlers dispatch from. */
const ALL_BINDINGS: readonly BindingMeta[] = [
  ...GLOBAL_BINDINGS, ...TAB_BINDINGS, ...MINDMAP_BINDINGS, ...LIST_BINDINGS, ...PLAN_BINDINGS,
  ...STEPS_BINDINGS,
];

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
