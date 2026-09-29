import type { KeyboardEvent } from "react";
import { useTranslation } from "react-i18next";
import { useFilterStore } from "@/stores/use-filter-store";
import { useListFilterStore } from "@/stores/use-list-filter-store";
import { useMindmapStore } from "@/stores/use-mindmap-store";
import { useFilterEntries } from "@/hooks/use-filter-entries";
import { useRowKindToggle } from "@/hooks/use-row-kind-toggle";
import { useSetPrivateMode } from "@/hooks/use-private-mode";
import { YES_VALUE, modeFromModifiers } from "@/utils/filter-modes";
import type { YesNoDimension } from "@/utils/filter-modes";
import { flagForCode, rowKindForCode } from "@/utils/filter-menu-keys";
import type { ListRowKind } from "@/utils/list-filter";
import type { View } from "@/stores/use-view-store";
import { flagsFor, rowKindsFor } from "@/utils/filter-layout";

/** Whether the key was pressed in a text box, where letters must type. */
function inTextBox(event: KeyboardEvent): boolean {
  return event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement;
}

/**
 * The Filter menu's keys (see `filter-menu-keys.ts`), as a keydown handler for the menu: `Ctrl+P`
 * in every view, and the letters for whatever row kinds and flags `view` offers — all of them in
 * the List View, `c` / `e` (its strips) and `a` (Agentic) in the Zen View. A key typed into one of
 * its search boxes is left to type.
 */
export function useFilterMenuKeys(view: View): (event: KeyboardEvent) => void {
  const { t } = useTranslation("filter");
  const privateMode = useFilterStore((s) => s.filter.privateMode);
  const setPrivateMode = useSetPrivateMode();
  const showToast = useMindmapStore((s) => s.showToast);
  const rowKinds = useRowKindToggle();
  const entries = useFilterEntries();
  const setPillMode = useListFilterStore((s) => s.setPillMode);

  function onRowKind(kind: ListRowKind, event: KeyboardEvent) {
    if (event.shiftKey) rowKinds.showOnly(kind);
    else rowKinds.toggle(kind);
  }

  /**
   * A flag key names a mode — plain All, Shift Any, Alt Not. An unset flag is added in it; a set one
   * is switched to it, or removed when it is already in it (a click on the pill still cycles).
   */
  function onFlag(flag: YesNoDimension, event: KeyboardEvent) {
    if (flag === "private" && !privateMode) { showToast({ nodeId: "", message: t("privateModeOff") }); return; }
    const value = YES_VALUE[flag];
    const mode = modeFromModifiers(event);
    const current = entries.entries(flag).find((entry) => entry.value === value);
    if (current === undefined) entries.add(flag, value, mode);
    else if (current.mode === mode) entries.remove(flag, value);
    else setPillMode(flag, value, mode);
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
    const kindCandidate = rowKindForCode(event.code);
    const flagCandidate = flagForCode(event.code);
    const kind = kindCandidate !== null && rowKindsFor(view).includes(kindCandidate) ? kindCandidate : null;
    const flag = flagCandidate !== null && flagsFor(view).includes(flagCandidate) ? flagCandidate : null;
    if (kind === null && flag === null) return;
    event.preventDefault();
    if (kind !== null) onRowKind(kind, event);
    if (flag !== null) onFlag(flag, event);
  };
}
