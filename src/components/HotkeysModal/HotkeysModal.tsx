import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { BindingMeta, Chord, HotkeyLabelKey, Section } from "@/utils/hotkeys/chord";
import { formatChord } from "@/utils/hotkeys/chord";
import { GLOBAL_BINDINGS } from "@/utils/hotkeys/global-bindings";
import { TAB_BINDINGS } from "@/utils/hotkeys/tab-bindings";
import { MINDMAP_BINDINGS } from "@/utils/hotkeys/mindmap-bindings";
import { LIST_BINDINGS } from "@/utils/hotkeys/list-bindings";
import { PLAN_BINDINGS } from "@/utils/hotkeys/plan-bindings";
import { STEPS_BINDINGS } from "@/utils/hotkeys/steps-bindings";
import { ZEN_BINDINGS } from "@/utils/hotkeys/zen-bindings";
import { FILTER_GESTURES } from "@/utils/hotkeys/filter-gestures";
import { SCOPE_PICKER_KEYS } from "@/utils/hotkeys/scope-picker-keys";
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
  { section: "zenView", titleKey: "sectionZenView" },
];

/** Every binding in the app, display-side only — the same tables the handlers dispatch from. */
const ALL_BINDINGS: readonly BindingMeta[] = [
  ...GLOBAL_BINDINGS, ...TAB_BINDINGS, ...MINDMAP_BINDINGS, ...LIST_BINDINGS, ...PLAN_BINDINGS,
  ...STEPS_BINDINGS, ...ZEN_BINDINGS,
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
function groupRows(entries: ReadonlyArray<{ labelKey: HotkeyLabelKey; chord: Chord }>): Row[] {
  const rows: Row[] = [];
  for (const entry of entries) {
    const chord = formatChord(entry.chord);
    const existing = rows.find((r) => r.labelKey === entry.labelKey);
    if (existing === undefined) rows.push({ labelKey: entry.labelKey, chords: [chord] });
    else if (!existing.chords.includes(chord)) existing.chords.push(chord);
  }
  return rows;
}

function rowsFor(section: Section): Row[] {
  return groupRows(ALL_BINDINGS.filter((binding) => binding.section === section && binding.hidden !== true));
}

/** A row as drawn: its key labels and its description, both already in the words on screen. */
interface SheetRow {
  key: string;
  chords: string[];
  description: string;
}

interface SheetSection {
  key: string;
  title: string;
  rows: SheetRow[];
}

type Translate = (key: HotkeyLabelKey) => string;

function sheetRows(rows: readonly Row[], translate: Translate): SheetRow[] {
  return rows.map((row) => ({ key: row.labelKey, chords: row.chords, description: translate(row.labelKey) }));
}

/** The filter gestures: how a value is added in each mode, cycled and removed. Keys and clicks,
 * not bindings — see `FILTER_GESTURES`. The click reads as one more key label. */
function filterGesturesSection(translate: Translate): SheetSection {
  const rows = FILTER_GESTURES.map((gesture) => ({
    key: gesture.labelKey,
    chords: [
      ...gesture.chords.map((chord) => formatChord(chord)),
      ...(gesture.clickKey === null ? [] : [translate(gesture.clickKey)]),
    ],
    description: translate(gesture.labelKey),
  }));
  return { key: "filters", title: translate("sectionFilters"), rows };
}

/** Keys that act inside any Scope Picker while it has the focus — not bindings of a view. */
function scopePickerSection(translate: Translate): SheetSection {
  return {
    key: "scopePicker",
    title: translate("sectionScopePicker"),
    rows: sheetRows(groupRows(SCOPE_PICKER_KEYS), translate),
  };
}

/** Every section of the sheet, in the order it is drawn. */
function sheetSections(translate: Translate): SheetSection[] {
  return SECTIONS.flatMap(({ section, titleKey }) => {
    const drawn = { key: section, title: translate(titleKey), rows: sheetRows(rowsFor(section), translate) };
    // The filter gestures sit right after the Global section, where Alt+F and Ctrl+F are.
    if (section === "global") return [drawn, filterGesturesSection(translate)];
    // The picker's keys follow the Plan View, whose `[` `]` `\` they borrow.
    if (section === "planView") return [drawn, scopePickerSection(translate)];
    return [drawn];
  });
}

/** A row matches when its description or any of its key labels holds the query, in any case. */
function rowMatches(row: SheetRow, needle: string): boolean {
  return [row.description, ...row.chords].some((text) => text.toLowerCase().includes(needle));
}

/** The sections cut down to the rows the search matches; a section left with none is dropped. */
function searchSections(sections: readonly SheetSection[], query: string): SheetSection[] {
  const needle = query.trim().toLowerCase();
  return sections
    .map((section) => ({ ...section, rows: section.rows.filter((row) => rowMatches(row, needle)) }))
    .filter((section) => section.rows.length > 0);
}

function SheetSectionBlock({ section }: { section: SheetSection }) {
  return (
    <section className={styles.section}>
      <h3 className={styles.sectionTitle}>{section.title}</h3>
      <dl className={styles.list}>
        {section.rows.map((row) => (
          <div key={row.key} className={styles.row}>
            <dt className={styles.chord}>
              {row.chords.map((chord) => <kbd key={chord}>{chord}</kbd>)}
            </dt>
            <dd className={styles.label}>{row.description}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

/**
 * Ctrl+Shift+/ cheat-sheet: every keyboard binding, grouped by the surface it applies to, with a
 * search field that narrows it to the rows whose description or keys hold what is typed.
 */
export default function HotkeysModal({ onClose }: Props) {
  useInputCapture();
  const { t } = useTranslation(["hotkeys"]);
  const [query, setQuery] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    searchRef.current?.focus();
  }, []);

  useEffect(() => {
    // Esc empties a typed search first, so a second Esc is what closes the sheet.
    function handleKeyDown(event: KeyboardEvent) {
      if (event.code !== "Escape") return;
      event.preventDefault();
      event.stopImmediatePropagation();
      if (query !== "") setQuery("");
      else onClose();
    }
    window.addEventListener("keydown", handleKeyDown, { capture: true });
    return () => window.removeEventListener("keydown", handleKeyDown, { capture: true });
  }, [onClose, query]);

  const sections = useMemo(() => sheetSections((key) => t(`hotkeys:${key}`)), [t]);
  const shown = useMemo(() => searchSections(sections, query), [sections, query]);

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.modal} onClick={(e) => e.stopPropagation()} role="dialog" aria-label={t("hotkeys:title")}>
        <h2 className={styles.title}>{t("hotkeys:title")}</h2>
        <input
          ref={searchRef}
          type="search"
          className={styles.search}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t("hotkeys:searchPlaceholder")}
          aria-label={t("hotkeys:searchPlaceholder")}
        />
        {shown.length === 0 ? (
          <p className={styles.noMatch}>{t("hotkeys:searchNoMatch", { query: query.trim() })}</p>
        ) : (
          <div className={styles.sections}>
            {shown.map((section) => <SheetSectionBlock key={section.key} section={section} />)}
          </div>
        )}
      </div>
    </div>
  );
}
