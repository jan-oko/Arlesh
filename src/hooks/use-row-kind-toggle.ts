import { useTranslation } from "react-i18next";
import { useListFilterStore } from "@/stores/use-list-filter-store";
import { useMindmapStore } from "@/stores/use-mindmap-store";
import { useViewStore, zenStripForKind } from "@/stores/use-view-store";
import { rowKindToggleRefusal, rowKindsApply } from "@/utils/list-filter";
import type { ListRowKind, RowKindRefusal } from "@/utils/list-filter";
import { rowKindsFor } from "@/utils/filter-layout";

/**
 * The row-kind switches of the active view's Filter menu, for the selector, its letter keys and the
 * filter search — with a refusal said in a toast.
 *
 * The List View's are its three row kinds, kept in its list filter. The Zen View's are its two
 * strips, Commitments and Expectations, kept in the tab's view state (`zenCommitments`,
 * `zenExpectations`): the same switches, keys and search results, on the Zen View's own toggles.
 * Tasks are the Zen View's grid, always shown, so it offers no Tasks switch and nothing is refused.
 */
export interface RowKindToggle {
  /** The kinds this view switches — none outside the List and Zen Views. */
  kinds: readonly ListRowKind[];
  isShown: (kind: ListRowKind) => boolean;
  /** Why toggling `kind` is refused right now, or `null` when it is not. */
  refusal: (kind: ListRowKind) => RowKindRefusal | null;
  /** Shows or hides one kind — refused for the List View's last kind shown, or under its
   * Expectations option. */
  toggle: (kind: ListRowKind) => void;
  /** Shows that kind alone — refused under the List View's Expectations option. */
  showOnly: (kind: ListRowKind) => void;
}

export function useRowKindToggle(): RowKindToggle {
  const { t } = useTranslation("listView");
  const view = useViewStore((s) => s.view);
  const zenCommitments = useViewStore((s) => s.zenCommitments);
  const zenExpectations = useViewStore((s) => s.zenExpectations);
  const toggleZenStrip = useViewStore((s) => s.toggleZenStrip);
  const showOnlyZenStrip = useViewStore((s) => s.showOnlyZenStrip);
  const listFilter = useListFilterStore((s) => s.filter);
  const toggleKind = useListFilterStore((s) => s.toggleKind);
  const showOnlyKind = useListFilterStore((s) => s.showOnlyKind);
  const showToast = useMindmapStore((s) => s.showToast);
  const kinds = rowKindsFor(view);

  if (view === "zen") {
    return {
      kinds,
      isShown: (kind) => {
        const strip = zenStripForKind(kind);
        return strip === "commitments" ? zenCommitments : strip === "expectations" ? zenExpectations : true;
      },
      refusal: () => null,
      toggle: (kind) => {
        const strip = zenStripForKind(kind);
        if (strip !== null) toggleZenStrip(strip);
      },
      showOnly: (kind) => {
        const strip = zenStripForKind(kind);
        if (strip !== null) showOnlyZenStrip(strip);
      },
    };
  }

  return {
    kinds,
    isShown: (kind) => listFilter.kinds.includes(kind),
    refusal: (kind) => rowKindToggleRefusal(listFilter, kind),
    toggle: (kind) => {
      const refusal = rowKindToggleRefusal(listFilter, kind);
      if (refusal === null) toggleKind(kind);
      else showToast({ nodeId: "", message: t(`rowKindRefused.${refusal}`) });
    },
    showOnly: (kind) => {
      if (rowKindsApply(listFilter.preset)) showOnlyKind(kind);
      else showToast({ nodeId: "", message: t("rowKindRefused.expectationsOption") });
    },
  };
}
