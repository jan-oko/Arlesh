import type { CSSProperties } from "react";
import { useTranslation } from "react-i18next";
import { useFilterDimensions } from "@/hooks/use-filter-dimensions";
import { useFilterEntries } from "@/hooks/use-filter-entries";
import { useActiveFilters } from "@/hooks/use-active-filters";
import { PILL_MODE_SYMBOL } from "@/utils/list-filter";
import { modeColorVar, tintBackground } from "@/utils/pill-color";
import styles from "./FilterChips.module.css";

interface ChipStyle extends CSSProperties {
  "--chip-mode-color": string;
  "--chip-tint": string | undefined;
}

/** The always-visible row of active-filter chips (moved out of the popover so what's filtered is
 * visible without opening anything). Click anywhere on a chip to cycle All → Any → Not (a yes/no
 * chip flips between "Blocked" and "Not blocked"); the embedded × removes it. Chip color always
 * encodes mode; the background additionally tints toward the value's own color where one is
 * resolvable (tags, Under, Depends on). */
export default function FilterChips() {
  const { t } = useTranslation("filter");
  const catalogue = useFilterDimensions();
  const entries = useFilterEntries();
  const chips = useActiveFilters(catalogue, entries);

  if (chips.length === 0) return null;

  return (
    <div className={styles.row} data-owns-keys="">
      {chips.map((chip) => {
        const chipStyle: ChipStyle = {
          "--chip-mode-color": modeColorVar(chip.mode),
          "--chip-tint": tintBackground(chip.color),
        };
        const cycle = () => entries.cycle(chip.dimension, chip.value);
        const remove = () => entries.remove(chip.dimension, chip.value);
        return (
          <div
            key={`${chip.dimension}-${chip.value}`}
            role="button"
            tabIndex={0}
            className={styles.chip}
            style={chipStyle}
            title={t(`tagMode.${chip.mode}`)}
            aria-label={t("chipAria", { dimension: chip.dimensionLabel, label: chip.label, mode: t(`tagMode.${chip.mode}`) })}
            onClick={cycle}
            onKeyDown={(e) => {
              if (e.target !== e.currentTarget) return;
              if (e.key === "Enter" || e.key === " ") { e.preventDefault(); cycle(); }
              if (e.key === "Delete" || e.key === "Backspace") { e.preventDefault(); remove(); }
            }}
          >
            <span className={styles.symbol} aria-hidden="true">{PILL_MODE_SYMBOL[chip.mode]}</span>
            <span className={styles.label}>{chip.label}</span>
            <button
              type="button"
              className={styles.remove}
              aria-label={t("removeTagFilter")}
              onClick={(e) => { e.stopPropagation(); remove(); }}
            >
              ×
            </button>
          </div>
        );
      })}
    </div>
  );
}
