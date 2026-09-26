import { useFilterStore } from "@/stores/use-filter-store";
import { useListFilterStore } from "@/stores/use-list-filter-store";
import type { FilterDimension } from "@/utils/filter-modes";
import type { PillFilter, PillMode } from "@/utils/list-filter";

/**
 * The tab's added filter values, one API over both of the stores they live in: tags in the shared
 * filter, the List View's pill dimensions in its own. Tag ids travel as strings.
 */
export interface FilterEntries {
  /** The values added to a dimension, in the order they were added. */
  entries: (dimension: FilterDimension) => readonly PillFilter[];
  add: (dimension: FilterDimension, value: string, mode: PillMode) => void;
  cycle: (dimension: FilterDimension, value: string) => void;
  remove: (dimension: FilterDimension, value: string) => void;
}

/** A tag id written as a string, or `null` when the string is not one. */
function tagIdOf(value: string): number | null {
  const id = Number.parseInt(value, 10);
  return Number.isNaN(id) ? null : id;
}

/** The Filter menu's, the filter search's and the chips' one way to read and change added values. */
export function useFilterEntries(): FilterEntries {
  const tagFilters = useFilterStore((s) => s.filter.tagFilters);
  const addTagFilter = useFilterStore((s) => s.addTagFilter);
  const cycleTagFilter = useFilterStore((s) => s.cycleTagFilter);
  const removeTagFilter = useFilterStore((s) => s.removeTagFilter);
  const pills = useListFilterStore((s) => s.filter.pills);
  const addPill = useListFilterStore((s) => s.addPill);
  const cyclePill = useListFilterStore((s) => s.cyclePill);
  const removePill = useListFilterStore((s) => s.removePill);

  function onTag(value: string, act: (tagId: number) => void) {
    const tagId = tagIdOf(value);
    if (tagId !== null) act(tagId);
  }

  return {
    entries: (dimension) => {
      if (dimension !== "tag") return pills[dimension];
      return tagFilters.map((tf) => ({ value: String(tf.tagId), mode: tf.mode }));
    },
    add: (dimension, value, mode) => {
      if (dimension === "tag") onTag(value, (tagId) => addTagFilter(tagId, mode));
      else addPill(dimension, value, mode);
    },
    cycle: (dimension, value) => {
      if (dimension === "tag") onTag(value, cycleTagFilter);
      else cyclePill(dimension, value);
    },
    remove: (dimension, value) => {
      if (dimension === "tag") onTag(value, removeTagFilter);
      else removePill(dimension, value);
    },
  };
}
