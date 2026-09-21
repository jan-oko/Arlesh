import type { Binding } from "@/utils/hotkeys/chord";

/** What reading ahead acts on. */
export interface ListScrollContext {
  /** Scrolls the list a fixed step down (1) or up (-1), leaving the selection where it is. */
  onScrollList: (direction: 1 | -1) => void;
}

/**
 * The physical keys that scroll the list. Exported because the viewport has to watch for their
 * *release* as well: the scroll runs while the key is held, so the binding table and the hook that
 * moves the viewport must name the same two keys rather than each spelling them out.
 */
export const SCROLL_DOWN_CODE = "KeyJ";
/** See {@link SCROLL_DOWN_CODE}. */
export const SCROLL_UP_CODE = "KeyK";

// Reading ahead without giving up your place: these move the viewport and nothing else, so the
// selection stays put even once it has scrolled out of sight. `allowRepeat: false` because the
// press only *starts* the motion — holding the key is then carried by an animation loop at a
// fixed speed (see use-list-scroll), and letting auto-repeat through as well would have the
// repeats restarting a scroll that is already running.
export const LIST_SCROLL_BINDINGS: readonly Binding<ListScrollContext>[] = [
  {
    id: "listView.scrollDown", section: "listView", chord: { code: SCROLL_DOWN_CODE },
    labelKey: "scrollList", allowRepeat: false, run: (c) => c.onScrollList(1),
  },
  {
    id: "listView.scrollUp", section: "listView", chord: { code: SCROLL_UP_CODE },
    labelKey: "scrollList", allowRepeat: false, run: (c) => c.onScrollList(-1),
  },
];
