import type { CSSProperties } from "react";
import { useTranslation } from "react-i18next";
import { useFilterStore } from "@/stores/use-filter-store";
import { useListFilterStore } from "@/stores/use-list-filter-store";
import { useViewStore } from "@/stores/use-view-store";
import { useFilterDisplay } from "@/hooks/use-filter-display";
import { PILL_DIMENSIONS, PILL_MODE_SYMBOL, NEXT_PILL_MODE } from "@/utils/list-filter";
import type { PillDimension, PillMode } from "@/utils/list-filter";
import { modeColorVar, tintBackground } from "@/utils/pill-color";
import styles from "./FilterChips.module.css";

interface ChipDescriptor {
  key: string;
  label: string;
  mode: PillMode;
  color: string | null;
  onCycle: () => void;
  onRemove: () => void;
}

interface ChipStyle extends CSSProperties {
  "--chip-mode-color": string;
  "--chip-tint": string | undefined;
}

/** Resolves a List-View-exclusive pill's display label and (where one exists) aspect color. */
function pillDisplay(
  dimension: PillDimension,
  value: string,
  display: ReturnType<typeof useFilterDisplay>,
): { label: string; color: string | null } {
  switch (dimension) {
    case "antecedent":
    case "dependency":
      return { label: display.nodeLabel(value), color: display.nodeColor(value) };
    case "taskStatus":
      return { label: display.displayTaskStatus(value), color: null };
    case "goalStatus":
      return { label: display.displayGoalStatus(value), color: null };
    case "projectStatus":
      return { label: display.displayProjectStatus(value), color: null };
    case "verdict":
      return { label: display.displayVerdict(value), color: null };
    case "scopeState":
      return { label: display.displayScopeState(value), color: null };
    case "blocked":
      return { label: display.displayBlocked(value), color: null };
    case "agentic":
      return { label: display.displayAgentic(value), color: null };
  }
}

/** The always-visible row of active-filter chips (moved out of the popover so what's filtered is
 * visible without opening anything). Click anywhere on a chip to cycle Any → All → Exclude; the
 * embedded × removes it. Chip color always encodes mode; the background additionally tints toward
 * the value's aspect color where one is resolvable (tags, antecedent, dependency). */
export default function FilterChips() {
  const { t } = useTranslation("filter");
  const filter = useFilterStore((s) => s.filter);
  const setTagFilterMode = useFilterStore((s) => s.setTagFilterMode);
  const removeTagFilter = useFilterStore((s) => s.removeTagFilter);

  const view = useViewStore((s) => s.view);
  const listFilter = useListFilterStore((s) => s.filter);
  const setPillMode = useListFilterStore((s) => s.setPillMode);
  const removePill = useListFilterStore((s) => s.removePill);

  const display = useFilterDisplay();

  const chips: ChipDescriptor[] = filter.tagFilters.map((tf) => ({
    key: `tag-${tf.tagId}`,
    label: display.tagName(tf.tagId),
    mode: tf.mode,
    color: display.tagColor(tf.tagId),
    onCycle: () => setTagFilterMode(tf.tagId, NEXT_PILL_MODE[tf.mode]),
    onRemove: () => removeTagFilter(tf.tagId),
  }));

  if (view === "list") {
    for (const dimension of PILL_DIMENSIONS) {
      for (const pill of listFilter.pills[dimension]) {
        const { label, color } = pillDisplay(dimension, pill.value, display);
        chips.push({
          key: `${dimension}-${pill.value}`,
          label,
          mode: pill.mode,
          color,
          onCycle: () => setPillMode(dimension, pill.value, NEXT_PILL_MODE[pill.mode]),
          onRemove: () => removePill(dimension, pill.value),
        });
      }
    }
  }

  if (chips.length === 0) return null;

  return (
    <div className={styles.row}>
      {chips.map((chip) => {
        const chipStyle: ChipStyle = {
          "--chip-mode-color": modeColorVar(chip.mode),
          "--chip-tint": tintBackground(chip.color),
        };
        return (
          <div
            key={chip.key}
            role="button"
            tabIndex={0}
            className={styles.chip}
            style={chipStyle}
            title={t(`tagMode.${chip.mode}`)}
            onClick={chip.onCycle}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") { e.preventDefault(); chip.onCycle(); }
            }}
          >
            <span className={styles.symbol} aria-hidden="true">{PILL_MODE_SYMBOL[chip.mode]}</span>
            <span className={styles.label}>{chip.label}</span>
            <button
              type="button"
              className={styles.remove}
              aria-label={t("removeTagFilter")}
              onClick={(e) => { e.stopPropagation(); chip.onRemove(); }}
            >
              ×
            </button>
          </div>
        );
      })}
    </div>
  );
}
