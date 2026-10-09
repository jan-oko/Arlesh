import { LIST_ROW_KINDS } from "@/utils/list-filter";
import type { ListRowKind } from "@/utils/list-filter";
import { YES_NO_DIMENSIONS } from "@/utils/filter-modes";
import type { YesNoDimension } from "@/utils/filter-modes";

/**
 * The Filter menu's letter keys (List View), read by physical key while focus is in the menu but
 * not in one of its search boxes. `t` / `c` / `e` toggle a row kind (Shift: show only that one);
 * `a` / `w` / `b` / `p` add a flag in the key's mode (plain All, Shift Any, Alt Not), switch a set
 * flag to that mode, or remove it when it is already in that mode;
 * `o` toggles the On Agent pill; `r` the Zen View's Review pill; `g` cycles the Delegated pill; `Ctrl+P` toggles Private Mode itself — taking over the global "Plan View" chord only while focus
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

/** The key that toggles the **On Agent** pill, in every view that offers it. `d` is spoken for. */
export const ON_AGENT_KEY = "KeyO";

/** The key that toggles the Zen View's **Review** pill. Free there: the Zen View binds no `r`. */
export const REVIEW_KEY = "KeyR";

/** The key that cycles the **Delegated** pill (off → include → exclude), in every view — `g`, for
 * dele*g*ated, since `d` is spoken for. */
export const DELEGATED_KEY = "KeyG";

/** The chord that toggles Private Mode from the menu, as a `data-owns-keys` token. */
export const PRIVATE_MODE_TOKEN = "Ctrl+KeyP";

/** Every key the menu handles itself — what it lists in `data-owns-keys`. */
export const FILTER_MENU_CODES: readonly string[] = [
  ...Object.values(ROW_KIND_KEYS), ...Object.values(FLAG_KEYS), ON_AGENT_KEY, REVIEW_KEY, DELEGATED_KEY, PRIVATE_MODE_TOKEN,
];

/** The letter keys the Filter menu takes in a view: its row kinds', its flags' and the Delegated
 * pill's, which every view offers. */
export function filterMenuCodesFor(kinds: readonly ListRowKind[], flags: readonly YesNoDimension[]): string[] {
  return [...kinds.map((kind) => ROW_KIND_KEYS[kind]), ...flags.map((flag) => FLAG_KEYS[flag]), DELEGATED_KEY];
}

/** The row kind a key code toggles, or `null`. */
export function rowKindForCode(code: string): ListRowKind | null {
  return LIST_ROW_KINDS.find((kind) => ROW_KIND_KEYS[kind] === code) ?? null;
}

/** The flag a key code adds, or `null`. */
export function flagForCode(code: string): YesNoDimension | null {
  return YES_NO_DIMENSIONS.find((flag) => FLAG_KEYS[flag] === code) ?? null;
}
