import type { KeyboardEvent } from "react";
import { useTranslation } from "react-i18next";
import { useFilterStore } from "@/stores/use-filter-store";
import { useMindmapStore } from "@/stores/use-mindmap-store";
import { useFilterEntries } from "@/hooks/use-filter-entries";
import { useRowKindToggle } from "@/hooks/use-row-kind-toggle";
import { useSetPrivateMode } from "@/hooks/use-private-mode";
import { YES_VALUE, modeFromModifiers } from "@/utils/filter-modes";
import type { YesNoDimension } from "@/utils/filter-modes";
import { flagForCode, rowKindForCode } from "@/utils/filter-menu-keys";
import type { ListRowKind } from "@/utils/list-filter";

/** Whether the key was pressed in a text box, where letters must type. */
function inTextBox(event: KeyboardEvent): boolean {
  return event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement;
}

/**
 * The Filter menu's keys (see `filter-menu-keys.ts`), as a keydown handler for the menu: `Ctrl+P`
 * in every view, the letters in the List View. A key typed into one of its search boxes is left to
 * type.
 */
export function useFilterMenuKeys(lettersEnabled: boolean): (event: KeyboardEvent) => void {
  const { t } = useTranslation("filter");
  const privateMode = useFilterStore((s) => s.filter.privateMode);
  const setPrivateMode = useSetPrivateMode();
  const showToast = useMindmapStore((s) => s.showToast);
  const rowKinds = useRowKindToggle();
  const entries = useFilterEntries();

  function onRowKind(kind: ListRowKind, event: KeyboardEvent) {
    if (event.shiftKey) rowKinds.showOnly(kind);
    else rowKinds.toggle(kind);
  }

  /** A flag key: added in the pill modes, or — once added — cycled as a click on its pill would. */
  function onFlag(flag: YesNoDimension, event: KeyboardEvent) {
    if (flag === "private" && !privateMode) { showToast({ nodeId: "", message: t("privateModeOff") }); return; }
    const value = YES_VALUE[flag];
    const added = entries.entries(flag).some((entry) => entry.value === value);
    if (added) entries.cycle(flag, value);
    else entries.add(flag, value, modeFromModifiers(event));
  }

  return (event) => {
    if (inTextBox(event) || event.metaKey) return;
    if (event.ctrlKey) {
      // Ctrl+P: Private Mode itself. The only Ctrl chord the menu takes (see `PRIVATE_MODE_TOKEN`).
      if (event.code !== "KeyP" || event.altKey || event.shiftKey) return;
      event.preventDefault();
      setPrivateMode(!privateMode);
      return;
    }
    if (!lettersEnabled) return;
    const kind = rowKindForCode(event.code);
    const flag = flagForCode(event.code);
    if (kind === null && flag === null) return;
    event.preventDefault();
    if (kind !== null) onRowKind(kind, event);
    if (flag !== null) onFlag(flag, event);
  };
}
