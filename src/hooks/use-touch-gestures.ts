import { useEffect, useRef, type RefObject } from "react";
import {
  DOUBLE_TAP_MS, LONG_PRESS_MS, classifyRelease, isSecondTap, isStill,
  type TouchSample,
} from "@/utils/touch/gestures";

/** What a view does with each gesture on one of its nodes (`id`), or on empty space (`null`). */
export interface TouchGestureHandlers {
  onTap: (id: string | null) => void;
  onDoubleTap: (id: string | null) => void;
  /** A finger held still on a node and lifted: the node's palette. */
  onLongPress: (id: string) => void;
  onFlickUp: (id: string | null) => void;
  onSwipe: (id: string | null, direction: "left" | "right") => void;
  /**
   * Whether a tap on `id` waits out the double-tap window before it counts: the tap that deselects
   * the selected node must not fire when it turns out to be the first half of "go into".
   */
  defersTap: (id: string) => boolean;
  /**
   * A finger held on a node and then moved: the Mindmap's drag. Absent, holding and moving is
   * nothing. `start` is told where the finger went down; `move` and `end` where it is.
   */
  holdDrag?: {
    start: (id: string, x: number, y: number) => void;
    move: (x: number, y: number) => void;
    end: (x: number, y: number) => void;
  };
}

interface Options {
  /** The attribute a node's element carries its id in — `data-row-id`, `data-node-id`. */
  idAttribute: string;
  /** Off where there is no touchscreen: the listeners are not attached at all. */
  enabled: boolean;
  /** Whether a sideways move slides the row under the finger as feedback. */
  slidesRows?: boolean;
}

/** A touch on one of these is the control's own, and never a gesture of the surface around it. */
const OWN_TOUCH = "input, textarea, select, [contenteditable], [data-gesture-skip]";

/** How far a row slides with a sideways finger, at most. */
const MAX_SLIDE_PX = 96;

interface Press {
  start: TouchSample;
  last: TouchSample;
  id: string | null;
  element: HTMLElement | null;
  held: boolean;
  dragging: boolean;
}

/** Narrows a listener's event without a cast — an SVG and an HTML container share one listener. */
function isTouchEvent(event: Event): event is TouchEvent {
  return "touches" in event && "changedTouches" in event;
}

/** A touch listener as `addEventListener` takes it on either kind of element. */
function forTouch(listener: (event: TouchEvent) => void): (event: Event) => void {
  return (event) => { if (isTouchEvent(event)) listener(event); };
}

function sample(touch: Touch, time: number): TouchSample {
  return { x: touch.clientX, y: touch.clientY, t: time };
}

/**
 * Recognises the single-finger gestures of `docs/spec/touch.md` on a view's container and hands
 * each to the view with the id of the node it landed on. Delegated: one set of listeners on the
 * container, the node found by `idAttribute`, so a row needs no wiring of its own.
 *
 * A recognised tap or swipe takes the touch's synthetic mouse events and click with it
 * (`preventDefault` on `touchend`), so a row's own click handler does not select it a second time.
 * A touch that starts on a field, or on a control marked `data-gesture-skip` (a status button), is
 * left entirely to that control.
 */
export function useTouchGestures(
  containerRef: RefObject<HTMLElement | SVGElement | null>,
  handlers: TouchGestureHandlers,
  { idAttribute, enabled, slidesRows = false }: Options,
): void {
  const latest = useRef(handlers);
  useEffect(() => {
    latest.current = handlers;
  });

  useEffect(() => {
    const container = containerRef.current;
    if (!enabled || container === null) return;

    let press: Press | null = null;
    let holdTimer: ReturnType<typeof setTimeout> | null = null;
    let tapTimer: ReturnType<typeof setTimeout> | null = null;
    let lastTap: (TouchSample & { id: string | null }) | null = null;
    let lastTouchAt = -Infinity;

    function clearHold() {
      if (holdTimer !== null) clearTimeout(holdTimer);
      holdTimer = null;
    }

    function slide(element: HTMLElement | null, dx: number) {
      if (!slidesRows || element === null) return;
      const clamped = Math.max(-MAX_SLIDE_PX, Math.min(MAX_SLIDE_PX, dx));
      element.style.transform = dx === 0 ? "" : `translateX(${clamped}px)`;
      element.style.transition = dx === 0 ? "transform 0.15s ease" : "none";
    }

    function onTouchStart(event: TouchEvent) {
      lastTouchAt = event.timeStamp;
      if (event.touches.length !== 1) {
        // A second finger: this is a pinch or a two-finger swipe, never a node gesture.
        clearHold();
        if (press !== null) slide(press.element, 0);
        press = null;
        return;
      }
      const touch = event.touches[0];
      const target = event.target;
      if (touch === undefined || !(target instanceof Element) || target.closest(OWN_TOUCH) !== null) {
        press = null;
        return;
      }
      const nodeElement = target.closest(`[${idAttribute}]`);
      const id = nodeElement !== null && container?.contains(nodeElement) === true
        ? nodeElement.getAttribute(idAttribute)
        : null;
      const start = sample(touch, event.timeStamp);
      press = {
        start, last: start, id,
        element: nodeElement instanceof HTMLElement ? nodeElement : null,
        held: false, dragging: false,
      };
      clearHold();
      if (id === null) return;
      holdTimer = setTimeout(() => {
        if (press === null) return;
        press.held = true;
        // The hold's only feedback while the finger is still down; what it opens waits for the lift.
        if (typeof navigator.vibrate === "function") navigator.vibrate(10);
      }, LONG_PRESS_MS);
    }

    function onTouchMove(event: TouchEvent) {
      const touch = event.touches[0];
      if (press === null || touch === undefined || event.touches.length !== 1) return;
      press.last = sample(touch, event.timeStamp);
      if (isStill(press.start, press.last)) return;
      clearHold();
      const drag = latest.current.holdDrag;
      if (press.held && drag !== undefined && press.id !== null) {
        if (!press.dragging) drag.start(press.id, press.start.x, press.start.y);
        press.dragging = true;
        drag.move(press.last.x, press.last.y);
        return;
      }
      const dx = press.last.x - press.start.x;
      if (Math.abs(dx) > 2 * Math.abs(press.last.y - press.start.y)) slide(press.element, dx);
    }

    function onTouchEnd(event: TouchEvent) {
      clearHold();
      const current = press;
      press = null;
      if (current === null || event.touches.length > 0) return;
      slide(current.element, 0);
      const touch = event.changedTouches[0];
      const end = touch === undefined ? current.last : sample(touch, event.timeStamp);
      const on = latest.current;

      if (current.dragging) {
        event.preventDefault();
        on.holdDrag?.end(end.x, end.y);
        return;
      }
      if (current.held && current.id !== null) {
        event.preventDefault();
        on.onLongPress(current.id);
        return;
      }

      const gesture = classifyRelease(current.start, end);
      if (gesture.kind === "none") return;
      // A tap on no node is the control's under it — a path header's segment, a pane's button.
      if (gesture.kind === "tap" && current.id === null) return;
      event.preventDefault();
      if (gesture.kind === "flickUp") { on.onFlickUp(current.id); return; }
      if (gesture.kind === "swipe") { on.onSwipe(current.id, gesture.direction); return; }

      if (lastTap !== null && lastTap.id === current.id && isSecondTap(lastTap, end)) {
        if (tapTimer !== null) clearTimeout(tapTimer);
        tapTimer = null;
        lastTap = null;
        on.onDoubleTap(current.id);
        return;
      }
      lastTap = { ...end, id: current.id };
      if (current.id !== null && on.defersTap(current.id)) {
        const id = current.id;
        tapTimer = setTimeout(() => { tapTimer = null; latest.current.onTap(id); }, DOUBLE_TAP_MS);
        return;
      }
      on.onTap(current.id);
    }

    function onTouchCancel() {
      clearHold();
      if (press !== null) slide(press.element, 0);
      if (press?.dragging === true) latest.current.holdDrag?.end(press.last.x, press.last.y);
      press = null;
    }

    // A long-press makes the webview raise its own context menu; a touch's gestures are ours.
    function onContextMenu(event: Event) {
      if (event.timeStamp - lastTouchAt < 2000) event.preventDefault();
    }

    const listeners: ReadonlyArray<[string, (event: Event) => void, AddEventListenerOptions]> = [
      ["touchstart", forTouch(onTouchStart), { passive: true }],
      ["touchmove", forTouch(onTouchMove), { passive: true }],
      // Not passive: a recognised gesture cancels the touch's synthetic mouse events and click.
      ["touchend", forTouch(onTouchEnd), { passive: false }],
      ["touchcancel", onTouchCancel, {}],
      ["contextmenu", onContextMenu, { capture: true }],
    ];
    for (const [type, listener, options] of listeners) container.addEventListener(type, listener, options);
    return () => {
      clearHold();
      if (tapTimer !== null) clearTimeout(tapTimer);
      for (const [type, listener, options] of listeners) container.removeEventListener(type, listener, options);
    };
  }, [containerRef, enabled, idAttribute, slidesRows]);
}
