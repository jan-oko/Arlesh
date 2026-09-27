import { useTranslation } from "react-i18next";
import { useListFilterStore } from "@/stores/use-list-filter-store";
import { useMindmapStore } from "@/stores/use-mindmap-store";
import { rowKindToggleRefusal, rowKindsApply } from "@/utils/list-filter";
import type { ListRowKind } from "@/utils/list-filter";

/** Row-kind changes from the keyboard and the filter search, with a refusal said in a toast. */
export interface RowKindToggle {
  /** Shows or hides one kind — refused for the last kind shown, or under the Expectations option. */
  toggle: (kind: ListRowKind) => void;
  /** Shows that kind alone — refused under the Expectations option. */
  showOnly: (kind: ListRowKind) => void;
}

export function useRowKindToggle(): RowKindToggle {
  const { t } = useTranslation("listView");
  const listFilter = useListFilterStore((s) => s.filter);
  const toggleKind = useListFilterStore((s) => s.toggleKind);
  const showOnlyKind = useListFilterStore((s) => s.showOnlyKind);
  const showToast = useMindmapStore((s) => s.showToast);

  return {
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
