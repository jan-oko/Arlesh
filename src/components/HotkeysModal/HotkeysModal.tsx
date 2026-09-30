import { Fragment, useEffect, useId, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { BindingMeta, Chord, HotkeyGroup, HotkeyLabelKey, Section } from "@/utils/hotkeys/chord";
import { formatChord, HOTKEY_GROUPS } from "@/utils/hotkeys/chord";
import type { View } from "@/stores/use-view-store";
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
  /** The view the sheet was opened over: it opens on that view's tab. None opens on Global. */
  view?: View | undefined;
}

/** A tab of the sheet: a binding section, or one of the two lists of keys that are not bindings. */
type SheetKey = Section | "filters" | "scopePicker";

const SECTIONS: ReadonlyArray<{ section: Section; titleKey: HotkeyLabelKey }> = [
  { section: "global", titleKey: "sectionGlobal" },
  { section: "tabs", titleKey: "sectionTabs" },
  { section: "mindmap", titleKey: "sectionMindmap" },
  { section: "listView", titleKey: "sectionListView" },
  { section: "planView", titleKey: "sectionPlanView" },
  { section: "stepsView", titleKey: "sectionStepsView" },
  { section: "zenView", titleKey: "sectionZenView" },
];

const VIEW_SECTION: Readonly<Record<View, Section>> = {
  mindmap: "mindmap",
  list: "listView",
  plan: "planView",
  steps: "stepsView",
  zen: "zenView",
};

/** Every binding in the app, display-side only — the same tables the handlers dispatch from. */
const ALL_BINDINGS: readonly BindingMeta[] = [
  ...GLOBAL_BINDINGS, ...TAB_BINDINGS, ...MINDMAP_BINDINGS, ...LIST_BINDINGS, ...PLAN_BINDINGS,
  ...STEPS_BINDINGS, ...ZEN_BINDINGS,
];

interface Row {
  labelKey: HotkeyLabelKey;
  chords: string[];
  group: HotkeyGroup | null;
}

/**
 * One row per distinct action, carrying every chord that triggers it — so the four arrow keys read
 * as a single "← → ↑ ↓ move between cells" row rather than four identical lines. Order follows each
 * action's first appearance in the table.
 */
function groupRows(
  entries: ReadonlyArray<{ labelKey: HotkeyLabelKey; chord: Chord; group?: HotkeyGroup }>,
): Row[] {
  const rows: Row[] = [];
  for (const entry of entries) {
    const chord = formatChord(entry.chord);
    const existing = rows.find((r) => r.labelKey === entry.labelKey);
    if (existing === undefined) rows.push({ labelKey: entry.labelKey, chords: [chord], group: entry.group ?? null });
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
  group: HotkeyGroup | null;
}

interface SheetSection {
  key: SheetKey;
  /** The tab's name. */
  tab: string;
  /** The heading over its rows in search results — the tab's name, or a longer one. */
  title: string;
  rows: SheetRow[];
}

type Translate = (key: HotkeyLabelKey) => string;

function sheetRows(rows: readonly Row[], translate: Translate): SheetRow[] {
  return rows.map((row) => ({
    key: row.labelKey, chords: row.chords, description: translate(row.labelKey), group: row.group,
  }));
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
    group: null,
  }));
  return { key: "filters", tab: translate("tabFilters"), title: translate("sectionFilters"), rows };
}

/** Keys that act inside any Scope Picker while it has the focus — not bindings of a view. */
function scopePickerSection(translate: Translate): SheetSection {
  return {
    key: "scopePicker",
    tab: translate("tabScopePicker"),
    title: translate("sectionScopePicker"),
    rows: sheetRows(groupRows(SCOPE_PICKER_KEYS), translate),
  };
}

/** Every section of the sheet, in the order its tabs are drawn. */
function sheetSections(translate: Translate): SheetSection[] {
  return SECTIONS.flatMap(({ section, titleKey }) => {
    const title = translate(titleKey);
    const drawn = { key: section, tab: title, title, rows: sheetRows(rowsFor(section), translate) };
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

interface RowBlock {
  group: HotkeyGroup | null;
  rows: SheetRow[];
}

/** Rows under their sub-headings, in `HOTKEY_GROUPS` order; rows with no group come first, bare. */
function rowBlocks(rows: readonly SheetRow[]): RowBlock[] {
  const blocks: RowBlock[] = [{ group: null, rows: rows.filter((row) => row.group === null) }];
  for (const group of HOTKEY_GROUPS) blocks.push({ group, rows: rows.filter((row) => row.group === group) });
  return blocks.filter((block) => block.rows.length > 0);
}

/** A section's rows, flowed into columns. A group keeps together; a bare row never splits. */
function SectionRows({ rows }: { rows: readonly SheetRow[] }) {
  const { t } = useTranslation(["hotkeys"]);
  return (
    <div className={styles.columns}>
      {rowBlocks(rows).map((block) => {
        const list = (
          <dl className={styles.list}>
            {block.rows.map((row) => (
              <div key={row.key} className={styles.row}>
                <dt className={styles.chord}>
                  {row.chords.map((chord) => <kbd key={chord}>{chord}</kbd>)}
                </dt>
                <dd className={styles.label}>{row.description}</dd>
              </div>
            ))}
          </dl>
        );
        if (block.group === null) return <Fragment key="ungrouped">{list}</Fragment>;
        return (
          <div key={block.group} className={styles.group}>
            <h4 className={styles.groupTitle}>{t(`hotkeys:${block.group}`)}</h4>
            {list}
          </div>
        );
      })}
    </div>
  );
}

function scrollBody(body: HTMLElement | null, by: number): void {
  if (body !== null) body.scrollTop += by;
}

/** Scrolls the body a page, less a line of overlap so the reader keeps their place. */
function pageBody(body: HTMLElement | null, direction: 1 | -1): void {
  scrollBody(body, direction * Math.max((body?.clientHeight ?? 0) - 40, 40));
}

function isPageKey(event: KeyboardEvent): boolean {
  const bare = !event.ctrlKey && !event.altKey && !event.shiftKey && !event.metaKey;
  return bare && (event.code === "PageUp" || event.code === "PageDown");
}

function isArrowStep(event: KeyboardEvent): boolean {
  const bare = !event.ctrlKey && !event.altKey && !event.shiftKey && !event.metaKey;
  return bare && (event.code === "ArrowLeft" || event.code === "ArrowRight");
}

/**
 * Ctrl+Shift+/ cheat-sheet: every keyboard binding, one tab per surface, opening on the view it was
 * opened over. A search field narrows it to the rows whose description or keys hold what is typed,
 * across every tab at once.
 */
export default function HotkeysModal({ onClose, view }: Props) {
  useInputCapture();
  const { t } = useTranslation(["hotkeys"]);
  const hereKey: SheetKey | null = view === undefined ? null : VIEW_SECTION[view];
  const [query, setQuery] = useState("");
  const [selectedKey, setSelectedKey] = useState<SheetKey>(hereKey ?? "global");
  const searchRef = useRef<HTMLInputElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const tabRefs = useRef(new Map<SheetKey, HTMLButtonElement>());
  const idPrefix = useId();
  const tabId = (key: SheetKey) => `${idPrefix}-tab-${key}`;
  const panelId = `${idPrefix}-panel`;

  const sections = useMemo(() => sheetSections((key) => t(`hotkeys:${key}`)), [t]);
  const searching = query.trim() !== "";
  const shown = useMemo(() => searchSections(sections, query), [sections, query]);
  const selected = sections.find((section) => section.key === selectedKey);

  useEffect(() => {
    searchRef.current?.focus();
  }, []);

  // A new tab or a new query is a new list, read from its top.
  useEffect(() => {
    if (bodyRef.current !== null) bodyRef.current.scrollTop = 0;
  }, [selectedKey, query]);

  useEffect(() => {
    /** ← / → step through the tabs, but only while the search is empty: with text typed they are
     * the caret's. From a focused tab the focus follows, as a tablist's arrows do. */
    function stepTab(event: KeyboardEvent) {
      const keys = sections.map((section) => section.key);
      const at = keys.indexOf(selectedKey);
      const next = keys[(at + (event.code === "ArrowRight" ? 1 : keys.length - 1)) % keys.length];
      if (next === undefined) return;
      const onTab = [...tabRefs.current.values()].some((tab) => tab === document.activeElement);
      setSelectedKey(next);
      if (onTab) tabRefs.current.get(next)?.focus();
    }
    function handleKeyDown(event: KeyboardEvent) {
      // PgUp / PgDn page the body from anywhere in the sheet: a one-line field has no use for them.
      if (isPageKey(event)) {
        event.preventDefault();
        event.stopImmediatePropagation();
        pageBody(bodyRef.current, event.code === "PageDown" ? 1 : -1);
        return;
      }
      if (isArrowStep(event) && query === "") {
        event.preventDefault();
        event.stopImmediatePropagation();
        stepTab(event);
        return;
      }
      if (event.code !== "Escape") return;
      event.preventDefault();
      event.stopImmediatePropagation();
      // Esc empties a typed search first, so a second Esc is what closes the sheet.
      if (query !== "") setQuery("");
      else onClose();
    }
    window.addEventListener("keydown", handleKeyDown, { capture: true });
    return () => window.removeEventListener("keydown", handleKeyDown, { capture: true });
  }, [onClose, query, sections, selectedKey]);

  function pickTab(key: SheetKey) {
    setSelectedKey(key);
    setQuery("");
  }

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.modal} onClick={(e) => e.stopPropagation()} role="dialog" aria-label={t("hotkeys:title")}>
        {/* The header stays put; a wheel over it scrolls the body, since nothing up here scrolls. */}
        <div className={styles.header} onWheel={(e) => scrollBody(bodyRef.current, e.deltaY)}>
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
          <div role="tablist" aria-label={t("hotkeys:sectionTabsLabel")} className={styles.tabs}>
            {sections.map((section) => {
              const isSelected = !searching && section.key === selectedKey;
              return (
                <button
                  key={section.key}
                  ref={(element) => {
                    if (element === null) tabRefs.current.delete(section.key);
                    else tabRefs.current.set(section.key, element);
                  }}
                  type="button"
                  role="tab"
                  id={tabId(section.key)}
                  aria-selected={isSelected}
                  aria-controls={isSelected ? panelId : undefined}
                  tabIndex={section.key === selectedKey ? 0 : -1}
                  className={styles.tab}
                  onClick={() => pickTab(section.key)}
                >
                  {section.tab}
                  {section.key === hereKey && <span className={styles.here}>{t("hotkeys:tabHere")}</span>}
                </button>
              );
            })}
          </div>
        </div>
        <div ref={bodyRef} className={styles.body} data-testid="hotkeys-body">
          {!searching && selected !== undefined && (
            <div role="tabpanel" id={panelId} aria-labelledby={tabId(selected.key)}>
              <SectionRows rows={selected.rows} />
            </div>
          )}
          {searching && shown.length === 0 && (
            <p className={styles.noMatch}>{t("hotkeys:searchNoMatch", { query: query.trim() })}</p>
          )}
          {searching && shown.map((section) => (
            <section key={section.key} className={styles.result}>
              <h3 className={styles.sectionTitle}>{section.title}</h3>
              <SectionRows rows={section.rows} />
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}
