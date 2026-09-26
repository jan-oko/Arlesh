import { useTranslation } from "react-i18next";
import { useFilterStore } from "@/stores/use-filter-store";
import { useListFilterStore } from "@/stores/use-list-filter-store";
import { useMindmapStore } from "@/stores/use-mindmap-store";

/**
 * Sets Private Mode. Turning it **off** removes the List View's Private / Not private filter — with
 * it off every private row is hidden already, so the pill would narrow nothing or empty the list —
 * and says so in a toast rather than dropping it silently.
 */
export function useSetPrivateMode(): (on: boolean) => void {
  const { t } = useTranslation("filter");
  const setPrivateMode = useFilterStore((s) => s.setPrivateMode);
  const privatePills = useListFilterStore((s) => s.filter.pills.private);
  const removePill = useListFilterStore((s) => s.removePill);
  const showToast = useMindmapStore((s) => s.showToast);

  return (on) => {
    setPrivateMode(on);
    if (on || privatePills.length === 0) return;
    for (const pill of privatePills) removePill("private", pill.value);
    showToast({ nodeId: "", message: t("privateFilterRemoved") });
  };
}
