import { useId, useState } from "react";
import type { KeyboardEvent, MouseEvent } from "react";
import { useTranslation } from "react-i18next";
import { useFilterStore } from "@/stores/use-filter-store";
import { useViewStore } from "@/stores/use-view-store";
import { useInputCapture } from "@/hooks/use-input-capture";
import { useFilterDimensions } from "@/hooks/use-filter-dimensions";
import { useFilterEntries } from "@/hooks/use-filter-entries";
import { useFilterSearchGroups } from "@/hooks/use-filter-search-groups";
import { modeFromModifiers } from "@/utils/filter-modes";
import type { ModifierKeys } from "@/utils/filter-modes";
import { searchFilterCatalogue, switchStateAfterPick } from "@/utils/filter-search";
import type { SearchResult, SwitchResult } from "@/utils/filter-search";
import SearchModalShell from "@/components/SearchModalShell/SearchModalShell";
import styles from "./FilterSearchModal.module.css";

interface Props {
  onClose: () => void;
}

/**
 * `Ctrl+F`: one "Add filter…" search over every filter the view supports. Empty, it browses them
 * all, grouped; typing narrows by a dimension's name (old names included) or a value's. **↑ ↓**
 * move, and **Enter** or a click adds — All, **Shift** Any, **Alt** Not — then clears the query and
 * stays open. The switches (Private, Archived, Backlog) are one result each wearing their state.
 * It edits the same per-tab filter as the Filter menu and the chips.
 */
export default function FilterSearchModal({ onClose }: Props) {
  useInputCapture();
  const { t } = useTranslation("filter");
  const listId = useId();
  const view = useViewStore((s) => s.view);
  const setPrivateMode = useFilterStore((s) => s.setPrivateMode);
  const setArchivedMode = useFilterStore((s) => s.setArchivedMode);
  const setBacklogMode = useFilterStore((s) => s.setBacklogMode);
  const catalogue = useFilterDimensions();
  const entries = useFilterEntries();
  const groups = useFilterSearchGroups(view, catalogue, entries);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);

  const sections = searchFilterCatalogue(groups, query);
  const results = sections.flatMap((section) => section.results);
  const clampedActive = Math.min(active, Math.max(0, results.length - 1));

  function pickSwitch(result: SwitchResult, keys: ModifierKeys) {
    const next = switchStateAfterPick(result.target, result.state, keys);
    if (result.target === "private") setPrivateMode(next === "include");
    else if (result.target === "archived") setArchivedMode(next);
    else setBacklogMode(next);
  }

  function pick(result: SearchResult, keys: ModifierKeys) {
    if (result.kind === "switch") {
      pickSwitch(result, keys);
    } else {
      entries.add(result.dimension, result.value, modeFromModifiers(keys));
    }
    setQuery("");
    setActive(0);
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Escape") { event.preventDefault(); onClose(); return; }
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const step = event.key === "ArrowDown" ? 1 : -1;
      setActive(Math.max(0, Math.min(results.length - 1, clampedActive + step)));
      return;
    }
    const result = results[clampedActive];
    if (event.key !== "Enter" || result === undefined) return;
    event.preventDefault();
    pick(result, event);
  }

  function stateText(result: SwitchResult): string {
    if (result.target === "private") return t(`search.privateState.${result.state}`);
    return t(`search.switchState.${result.state}`);
  }

  function stateClass(result: SwitchResult): string {
    if (result.state === "include") return `${styles.state} ${styles.stateInclude}`;
    if (result.state === "exclude") return `${styles.state} ${styles.stateExclude}`;
    return styles.state ?? "";
  }

  // Each section's first option index in the flat list the arrow keys walk.
  const sectionStarts = sections.map((_, position) =>
    sections.slice(0, position).reduce((count, section) => count + section.results.length, 0));
  const nothingMatches = results.length === 0 && sections.every((section) => !section.typeToSearch);
  const placeholder = view === "list" ? t("search.placeholder") : t("search.placeholderTags");

  return (
    <SearchModalShell
      label={t("search.dialogLabel")}
      placeholder={placeholder}
      query={query}
      onQueryChange={(next) => { setQuery(next); setActive(0); }}
      onKeyDown={onKeyDown}
      onClose={onClose}
      listId={listId}
      {...(results.length > 0 ? { activeOptionId: `${listId}-${clampedActive}` } : {})}
    >
      <div className={styles.results} role="listbox" id={listId} aria-label={t("search.dialogLabel")}>
        {sections.map((section, position) => (
          <div key={section.key} role="group" aria-label={section.label}>
            <div className={styles.heading} role="presentation">
              {section.label}
              {section.typeToSearch && <span className={styles.typeToSearch}>{t("search.typeToSearch")}</span>}
            </div>
            {section.results.map((result, offset) => {
              const own = (sectionStarts[position] ?? 0) + offset;
              const isActive = own === clampedActive;
              return (
                <div
                  key={result.kind === "switch" ? `switch-${result.target}` : `${result.dimension}-${result.value}`}
                  id={`${listId}-${own}`}
                  role="option"
                  aria-selected={isActive}
                  className={`${styles.option}${isActive ? ` ${styles.active}` : ""}`}
                  onMouseDown={(event) => event.preventDefault()}
                  onMouseEnter={() => setActive(own)}
                  onClick={(event: MouseEvent) => pick(result, event)}
                >
                  <span className={styles.label}>
                    {result.kind === "value" && result.color !== null && (
                      <span className={styles.dot} style={{ background: result.color }} aria-hidden="true" />
                    )}
                    {result.label}
                  </span>
                  {result.kind === "switch" && <span className={stateClass(result)}>{stateText(result)}</span>}
                  {isActive && <kbd className={styles.enter} aria-hidden="true">{t("search.hintKeys.all")}</kbd>}
                </div>
              );
            })}
          </div>
        ))}
        {nothingMatches && (
          <div className={styles.empty}>{query.trim() === "" ? t("search.nothingLeft") : t("search.noResults")}</div>
        )}
      </div>
      <div className={styles.hint}>
        <kbd>{t("search.hintKeys.all")}</kbd> {t("search.hintAll")} · <kbd>{t("search.hintKeys.any")}</kbd> {t("search.hintAny")}
        {" · "}<kbd>{t("search.hintKeys.not")}</kbd> {t("search.hintNot")} · {t("search.hintSwitch")}
      </div>
    </SearchModalShell>
  );
}
