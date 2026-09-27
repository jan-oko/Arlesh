import { Fragment, useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { useFilterStore } from "@/stores/use-filter-store";
import { useListFilterStore } from "@/stores/use-list-filter-store";
import { useViewStore } from "@/stores/use-view-store";
import { useFilterDimensions } from "@/hooks/use-filter-dimensions";
import { useFilterEntries } from "@/hooks/use-filter-entries";
import { useFilterMenuKeys } from "@/hooks/use-filter-menu-keys";
import { FILTER_MENU_CODES, PRIVATE_MODE_TOKEN } from "@/utils/filter-menu-keys";
import { PLAN_VIEW_STATUS_MODE } from "@/utils/filter-tree";
import { filterMenuRows, isSearchedDimension, offeredDimensions } from "@/utils/filter-layout";
import type { FilterRowId } from "@/utils/filter-layout";
import FilterRow from "./FilterRow";
import FilterSwitches from "./FilterSwitches";
import FixedValueRow from "./FixedValueRow";
import InlineSearch from "./InlineSearch";
import styles from "./FilterPopover.module.css";

/**
 * The Filter menu, opened from the top-bar Filter button or `Alt+F`: the switch block, then one
 * compact labelled row per dimension, in untitled groups split by a thin rule. An added value stays
 * in its row wearing its chip's mode, in step with the top-bar chips. The List View lists its own
 * dimensions; every other view filters by tag. In the List View, letter keys act while focus is in
 * the menu (see `filter-menu-keys.ts`); focus moves into it when it opens.
 */
export default function FilterPopover() {
  const { t } = useTranslation(["filter", "common"]);
  const statusMode = useFilterStore((s) => s.filter.statusMode);
  const privateMode = useFilterStore((s) => s.filter.privateMode);
  const reset = useFilterStore((s) => s.reset);
  const listReset = useListFilterStore((s) => s.reset);
  const privatePills = useListFilterStore((s) => s.filter.pills.private);
  const removePill = useListFilterStore((s) => s.removePill);
  const view = useViewStore((s) => s.view);
  const catalogue = useFilterDimensions();
  const entries = useFilterEntries();
  const onKeyDown = useFilterMenuKeys(view === "list");
  const menuRef = useRef<HTMLDivElement>(null);

  // Focus lands in the menu when it opens, so its letter keys work at once — from Alt+F too.
  useEffect(() => { menuRef.current?.focus(); }, []);

  function rowBody(row: FilterRowId) {
    if (row !== "yesNo" && isSearchedDimension(row)) {
      return <InlineSearch dimension={row} catalogue={catalogue} entries={entries} label={catalogue.rowLabel(row)} />;
    }
    return <FixedValueRow dimensions={offeredDimensions(row, privateMode)} catalogue={catalogue} entries={entries} />;
  }

  return (
    <div
      ref={menuRef}
      tabIndex={-1}
      className={styles.popover}
      role="dialog"
      aria-label={t("common:filter")}
      data-owns-keys={view === "list" ? FILTER_MENU_CODES.join(" ") : PRIVATE_MODE_TOKEN}
      onKeyDown={onKeyDown}
    >
      <FilterSwitches view={view} statusMode={view === "plan" ? PLAN_VIEW_STATUS_MODE : statusMode} />
      {filterMenuRows(view).map((group, index) => (
        <Fragment key={index}>
          <hr className={styles.separator} />
          {group.map((row) => (
            <FilterRow key={row} label={catalogue.rowLabel(row)}>{rowBody(row)}</FilterRow>
          ))}
        </Fragment>
      ))}
      <div className={styles.foot}>
        <button
          type="button"
          className={styles.reset}
          onClick={() => {
            reset();
            if (view === "list") listReset();
            // Reset turns Private Mode off, which takes the Private pill with it in every view.
            else for (const pill of privatePills) removePill("private", pill.value);
          }}
        >
          {t("reset")}
        </button>
      </div>
    </div>
  );
}
