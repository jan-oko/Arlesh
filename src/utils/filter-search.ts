import type { OverrideMode } from "@/utils/filter-tree";
import type { FilterDimension, ModifierKeys } from "@/utils/filter-modes";
import type { FilterSwitch } from "@/utils/filter-layout";

/** A value that can be added to a dimension, as the menu and the search draw it. */
export interface FilterOption {
  value: string;
  label: string;
  /** A tag's or node's own color, for a dot and a tint. */
  color: string | null;
}

/** A value result: picking it adds `value` to `dimension`. */
export interface ValueResult extends FilterOption {
  kind: "value";
  dimension: FilterDimension;
  /** What the query is matched against — the label, and for a yes/no value its "Not" wording too. */
  matchText: string;
}

/**
 * A switch result — Archived, Backlog or Private. It is not added and does not drop out: it shows
 * its current state, and picking it sets that state (see {@link switchStateAfterPick}).
 */
export interface SwitchResult {
  kind: "switch";
  target: FilterSwitch;
  label: string;
  /** Private reads `include` when on and `inactive` when off; it has no `exclude`. */
  state: OverrideMode;
  matchText: string;
}

export type SearchResult = ValueResult | SwitchResult;

/** One heading's worth of the search: a dimension, the Yes / no group, or the switches. */
export interface SearchGroup {
  key: string;
  label: string;
  /** Other names the heading answers to — the old names Antecedent and Dependency. */
  aliases: readonly string[];
  /** Searches every node, so it lists nothing until you type (Under, Depends on). */
  searchOnly: boolean;
  /** What can still be picked here: added values are already left out. */
  results: readonly SearchResult[];
}

/** A heading as the search draws it: its results, or a "type to search" note. */
export interface SearchSection {
  key: string;
  label: string;
  typeToSearch: boolean;
  results: SearchResult[];
}

/** A node search can match thousands; like `Ctrl+O`, it shows the first fifty. */
const SEARCH_ONLY_LIMIT = 50;

function normalise(text: string): string {
  return text.trim().toLocaleLowerCase();
}

/**
 * Narrows the catalogue to a query. Empty, it browses every heading, with the node searches shown
 * as a heading that asks you to type. Typing keeps a whole heading when its name (or an old name)
 * matches, and otherwise the results whose own text matches; headings left empty drop out.
 */
export function searchFilterCatalogue(groups: readonly SearchGroup[], query: string): SearchSection[] {
  const q = normalise(query);
  const sections: SearchSection[] = [];
  for (const group of groups) {
    if (q === "") {
      sections.push({
        key: group.key,
        label: group.label,
        typeToSearch: group.searchOnly,
        results: group.searchOnly ? [] : [...group.results],
      });
      continue;
    }
    const headingHit = [group.label, ...group.aliases].some((name) => normalise(name).includes(q));
    const matched = headingHit ? [...group.results] : group.results.filter((r) => normalise(r.matchText).includes(q));
    const results = group.searchOnly ? matched.slice(0, SEARCH_ONLY_LIMIT) : matched;
    if (results.length > 0) sections.push({ key: group.key, label: group.label, typeToSearch: false, results });
  }
  return sections;
}

/**
 * The state a switch moves to when picked with `keys` held: **Enter / click** sets Archived and
 * Backlog to **include** and Private **on**; **Alt** sets Archived and Backlog to **exclude** and
 * Private **off**; Shift reads as a plain pick. Picking the state a switch is already in clears it
 * back to what the preset says — the search's way back, as Delete is on a set pill.
 */
export function switchStateAfterPick(target: FilterSwitch, current: OverrideMode, keys: ModifierKeys): OverrideMode {
  const asked: OverrideMode = keys.altKey ? (target === "private" ? "inactive" : "exclude") : "include";
  if (asked === current) return "inactive";
  return asked;
}
