import type { RefObject } from "react";
import { useTouchGestures } from "@/hooks/use-touch-gestures";
import type { TouchGestureHandlers } from "@/hooks/use-touch-gestures";
import { useHasTouch } from "@/hooks/use-media-query";
import { allSurfaceCommands, firstRunnable, useCommandSurfaceStore } from "@/stores/use-command-surface-store";
import { usePaletteStore } from "@/stores/use-palette-store";
import { useSelectModeStore } from "@/stores/use-select-mode-store";
import { ADVANCE_IDS, OPEN_EDITOR_IDS, TOGGLE_STARTED_IDS } from "@/utils/touch/command-ids";

/** What a view tells the shared gestures about its selection and its "go into". */
export interface ViewGestureOptions {
  /** The attribute its nodes carry their id in. */
  idAttribute: string;
  /** Off while the view draws no nodes (loading, an error), so there is nothing to listen on. */
  ready: boolean;
  isSelected: (id: string) => boolean;
  select: (id: string) => void;
  deselect: () => void;
  /** The double-tap: the view's own "go into" (enter, step into, narrow Under, open in List). */
  goInto: (id: string) => void;
  /** Adds a node to the selection or takes it out — the Select toggle. Absent: a single selection. */
  toggleInSelection?: (id: string) => void;
  /** A swipe the view answers itself; returns whether it did. Unanswered, a swipe advances or starts. */
  onSwipe?: (id: string | null, direction: "left" | "right", target: Element) => boolean;
  /** A flick up the view answers itself; returns whether it did. Unanswered, it opens the editor. */
  onFlickUp?: (id: string | null, target: Element) => boolean;
  /** Whether a sideways move slides the row under the finger. */
  slidesRows?: boolean;
  holdDrag?: TouchGestureHandlers["holdDrag"];
}

/** Runs the first of `ids` that can act now — a gesture with no selection to wait for. */
export function runFirst(ids: readonly string[]): void {
  firstRunnable(allSurfaceCommands(useCommandSurfaceStore.getState().tables), ids)?.run();
}

/**
 * Runs the first of `ids` that can act, once the selection a gesture just made has reached the
 * bindings' context — a binding reads it through a ref its table refreshes after the render.
 */
export function runAfterSelect(ids: readonly string[]): void {
  setTimeout(() => runFirst(ids), 0);
}

/**
 * The gestures every view shares (`docs/spec/touch.md`), on whatever touchscreen is present: tap
 * selects and tapping the selection again deselects, double-tap goes into, long-press opens the
 * palette, a flick up opens the editor, and a swipe right advances while a swipe left sets Started.
 * Each acts by selecting the node and running the binding its key would — the same guard and the
 * same refusal — so a gesture can do nothing the keyboard cannot.
 */
export function useViewGestures(containerRef: RefObject<HTMLElement | SVGElement | null>, options: ViewGestureOptions): void {
  const hasTouch = useHasTouch();
  const openPalette = usePaletteStore((s) => s.open);

  function selectOnly(id: string | null): void {
    if (id !== null && !options.isSelected(id)) options.select(id);
  }

  const handlers: TouchGestureHandlers = {
    onTap: (id) => {
      if (id === null) return;
      const { toggleInSelection } = options;
      if (useSelectModeStore.getState().active && toggleInSelection !== undefined) {
        toggleInSelection(id);
        return;
      }
      if (options.isSelected(id)) options.deselect();
      else options.select(id);
    },
    onDoubleTap: (id) => { if (id !== null) options.goInto(id); },
    onLongPress: (id) => {
      selectOnly(id);
      openPalette();
    },
    onFlickUp: (id, target) => {
      if (options.onFlickUp?.(id, target) === true || id === null) return;
      selectOnly(id);
      runAfterSelect(OPEN_EDITOR_IDS);
    },
    onSwipe: (id, direction, target) => {
      if (options.onSwipe?.(id, direction, target) === true || id === null) return;
      selectOnly(id);
      runAfterSelect(direction === "right" ? ADVANCE_IDS : TOGGLE_STARTED_IDS);
    },
    // The selected node's tap waits: it may be the first half of a double-tap's "go into".
    defersTap: (id) => options.isSelected(id) && !useSelectModeStore.getState().active,
    ...(options.holdDrag === undefined ? {} : { holdDrag: options.holdDrag }),
  };

  useTouchGestures(containerRef, handlers, {
    idAttribute: options.idAttribute,
    enabled: hasTouch && options.ready,
    slidesRows: options.slidesRows ?? false,
  });
}
