import type { CSSProperties } from "react";
import { useTranslation } from "react-i18next";
import { useViewStore } from "@/stores/use-view-store";
import { useFilterDimensions } from "@/hooks/use-filter-dimensions";
import { useFilterEntries } from "@/hooks/use-filter-entries";
import { PILL_DIMENSIONS, PILL_MODE_SYMBOL } from "@/utils/list-filter";
import type { PillMode } from "@/utils/list-filter";
import type { FilterDimension } from "@/utils/filter-modes";
import { isYesNoDimension } from "@/utils/filter-modes";
import { modeColorVar, tintBackground } from "@/utils/pill-color";
import styles from "./FilterChips.module.css";

interface ChipDescriptor {
  key: string;
  dimension: FilterDimension;
  value: string;
  label: string;
  mode: PillMode;
  color: string | null;
}

interface ChipStyle extends CSSProperties {
  "--chip-mode-color": string;
  "--chip-tint": string | undefined;
}

/** The dimensions whose chips show in a view: tags everywhere, the List View's own pills there only. */
function chipDimensions(view: string): readonly FilterDimension[] {
  return view === "list" ? ["tag", ...PILL_DIMENSIONS] : ["tag"];
}

/** The always-visible row of active-filter chips (moved out of the popover so what's filtered is
 * visible without opening anything). Click anywhere on a chip to cycle All → Any → Not (a yes/no
 * chip flips between "Blocked" and "Not blocked"); the embedded × removes it. Chip color always
 * encodes mode; the background additionally tints toward the value's own color where one is
 * resolvable (tags, Under, Depends on). */
export default function FilterChips() {
  const { t } = useTranslation("filter");
  const view = useViewStore((s) => s.view);
  const catalogue = useFilterDimensions();
  const entries = useFilterEntries();

  const chips: ChipDescriptor[] = chipDimensions(view).flatMap((dimension) =>
    entries.entries(dimension).map((entry) => ({
      key: `${dimension}-${entry.value}`,
      dimension,
      value: entry.value,
      label: catalogue.valueLabel(dimension, entry.value, entry.mode),
      mode: entry.mode,
      color: catalogue.valueColor(dimension, entry.value),
    })),
  );

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
        const dimensionName = isYesNoDimension(chip.dimension) ? t("rows.yesNo") : t(`rows.${chip.dimension}`);
        return (
          <div
            key={chip.key}
            role="button"
            tabIndex={0}
            className={styles.chip}
            style={chipStyle}
            title={t(`tagMode.${chip.mode}`)}
            aria-label={t("chipAria", { dimension: dimensionName, label: chip.label, mode: t(`tagMode.${chip.mode}`) })}
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
