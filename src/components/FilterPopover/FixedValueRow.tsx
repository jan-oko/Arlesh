import type { FilterDimension } from "@/utils/filter-modes";
import { NO_VALUE, isYesNoDimension } from "@/utils/filter-modes";
import { FLAG_KEYS, keyLetter } from "@/utils/filter-menu-keys";
import type { FilterDimensions } from "@/hooks/use-filter-dimensions";
import type { FilterEntries } from "@/hooks/use-filter-entries";
import ValuePill from "./ValuePill";
import styles from "./FilterPopover.module.css";

interface Props {
  /** The dimensions whose values the row lists — one, or the three of the Yes / no row. */
  dimensions: readonly FilterDimension[];
  catalogue: FilterDimensions;
  entries: FilterEntries;
}

/** A row of a dimension's fixed values, each added and cycled in place (see `ValuePill`). */
export default function FixedValueRow({ dimensions, catalogue, entries }: Props) {
  return (
    <div className={styles.pills}>
      {dimensions.flatMap((dimension) =>
        catalogue.options(dimension).map((option) => {
          const added = entries.entries(dimension).find((entry) => entry.value === option.value);
          const notLabel = isYesNoDimension(dimension)
            ? catalogue.valueLabel(dimension, NO_VALUE[dimension], "all")
            : undefined;
          return (
            <ValuePill
              key={`${dimension}-${option.value}`}
              dimension={dimension}
              label={option.label}
              color={option.color}
              mode={added?.mode ?? null}
              {...(notLabel === undefined ? {} : { notLabel })}
              {...(isYesNoDimension(dimension) ? { keyLetter: keyLetter(FLAG_KEYS[dimension]) } : {})}
              onAdd={(mode) => entries.add(dimension, option.value, mode)}
              onCycle={() => entries.cycle(dimension, option.value)}
              onRemove={() => entries.remove(dimension, option.value)}
            />
          );
        }),
      )}
    </div>
  );
}
