import { LIST_ROW_KINDS } from "@/utils/list-filter";
import type { ListRowKind } from "@/utils/list-filter";
import { YES_NO_DIMENSIONS } from "@/utils/filter-modes";
import type { YesNoDimension } from "@/utils/filter-modes";

/**
 * The Filter menu's letter keys (List View), read by physical key while focus is in the menu but
 * not in one of its search boxes. `t` / `c` / `e` toggle a row kind (Shift: show only that one);
 * `a` / `w` / `b` / `p` add a flag in the key's mode (plain All, Shift Any, Alt Not), switch a set
 * flag to that mode, or remove it when it is already in that mode;
 * `Ctrl+P` toggles Private Mode itself — taking over the global "Plan View" chord only while focus
 * is in the menu.
 */
export const ROW_KIND_KEYS: Readonly<Record<ListRowKind, string>> = {
  task: "KeyT",
  commitment: "KeyC",
  expectation: "KeyE",
};

export const FLAG_KEYS: Readonly<Record<YesNoDimension, string>> = {
  agentic: "KeyA",
  asynchronous: "KeyW",
  blocked: "KeyB",
  private: "KeyP",
};

/** The Zen View's key for its **Agent waits** switch: `d`, for delegated (any modifier but Ctrl
 * toggles it). */
export const ZEN_AGENT_WAITS_KEY = "KeyD";

/** The chord that toggles Private Mode from the menu, as a `data-owns-keys` token. */
export const PRIVATE_MODE_TOKEN = "Ctrl+KeyP";

/** Every key the menu handles itself — what it lists in `data-owns-keys`. */
export const FILTER_MENU_CODES: readonly string[] = [
  ...Object.values(ROW_KIND_KEYS), ...Object.values(FLAG_KEYS), ZEN_AGENT_WAITS_KEY, PRIVATE_MODE_TOKEN,
];

/** The letter keys the Filter menu takes in a view: its row kinds' and its flags'. */
export function filterMenuCodesFor(kinds: readonly ListRowKind[], flags: readonly YesNoDimension[]): string[] {
  return [...kinds.map((kind) => ROW_KIND_KEYS[kind]), ...flags.map((flag) => FLAG_KEYS[flag])];
}

/** The row kind a key code toggles, or `null`. */
export function rowKindForCode(code: string): ListRowKind | null {
  return LIST_ROW_KINDS.find((kind) => ROW_KIND_KEYS[kind] === code) ?? null;
}

/** The flag a key code adds, or `null`. */
export function flagForCode(code: string): YesNoDimension | null {
  return YES_NO_DIMENSIONS.find((flag) => FLAG_KEYS[flag] === code) ?? null;
}
