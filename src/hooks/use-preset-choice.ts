import { useTranslation } from "react-i18next";
import { useFilterStore } from "@/stores/use-filter-store";
import { useListFilterStore } from "@/stores/use-list-filter-store";
import { useViewStore } from "@/stores/use-view-store";
import { LIST_PRESET_VALUES, isListOnlyPreset } from "@/utils/list-filter";
import type { ListPreset } from "@/utils/list-filter";
import { lockedStatusMode } from "@/utils/view-preset";

/** The presets outside the List View: its Unblock and Expectations are its own. */
const SHARED_PRESETS: readonly ListPreset[] = LIST_PRESET_VALUES.filter((preset) => !isListOnlyPreset(preset));

export interface PresetChoice {
  /** The preset the view reads under: its locked one, the List View's own, or the tab's. */
  active: ListPreset;
  /** The presets the view offers, in order. */
  options: readonly ListPreset[];
  /** Why the preset cannot change here, or `null` where it can. */
  lockedReason: string | null;
  /** Chooses a preset; nothing happens in a view that locks its preset. */
  select: (preset: ListPreset) => void;
  /** Steps to the next (`1`) or previous (`-1`) option, wrapping — the two-finger swipe. */
  cycle: (direction: 1 | -1) => void;
}

/**
 * The preset control's rules, for the phone layout's preset chip and its sheet: which presets the
 * view offers, which one it reads under, and what choosing one writes. It reads exactly as the
 * desktop top bar's preset dropdown does — the Plan and Zen Views lock theirs (`lockedStatusMode`),
 * and the List View's own two options write the list's preset alone, leaving the shared one for
 * the Mindmap.
 */
export function usePresetChoice(): PresetChoice {
  const { t } = useTranslation(["planView", "zenView"]);
  const view = useViewStore((s) => s.view);
  const statusMode = useFilterStore((s) => s.filter.statusMode);
  const setStatusMode = useFilterStore((s) => s.setStatusMode);
  const listPreset = useListFilterStore((s) => s.filter.preset);
  const setListPreset = useListFilterStore((s) => s.setPreset);

  const locked = lockedStatusMode(view);
  const active: ListPreset = locked ?? (view === "list" && isListOnlyPreset(listPreset) ? listPreset : statusMode);
  const options = view === "list" ? LIST_PRESET_VALUES : SHARED_PRESETS;
  const lockedReason = view === "plan" ? t("planView:presetLocked") : view === "zen" ? t("zenView:presetLocked") : null;

  function select(preset: ListPreset): void {
    if (locked !== null) return;
    if (preset === "unblock" || preset === "expectations") {
      setListPreset(preset);
      return;
    }
    setStatusMode(preset);
    setListPreset(preset);
  }

  function cycle(direction: 1 | -1): void {
    const index = options.indexOf(active);
    const next = options[(index + direction + options.length) % options.length];
    if (next !== undefined) select(next);
  }

  return { active, options, lockedReason, select, cycle };
}
