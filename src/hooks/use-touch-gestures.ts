import { useEffect, useRef, type RefObject } from "react";
import {
  DOUBLE_TAP_MS, LONG_PRESS_MS, classifyRelease, isSecondTap, isStill, isThreeFingerTap, isTwoFingerSwipeUp,
  type TouchSample, type TwoFingers,
} from "@/utils/touch/gestures";
import { FLY_OUT_MS, RETURN_AFTER_MS, slideOffset, slideOutcome } from "@/utils/touch/swipe-slide";

/** What a view does with each gesture on one of its nodes (`id`), or on empty space (`null`). */
export interface TouchGestureHandlers {
  onTap: (id: string | null) => void;
  onDoubleTap: (id: string | null) => void;
  /** A finger held still on a node and lifted: the node is selected; its quick action menu is the webview's `contextmenu`. */
  onLongPress: (id: string) => void;
  /** `target` is the element the finger went down on, for a view that asks where it was. */
  onFlickUp: (id: string | null, target: Element) => void;
  onSwipe: (id: string | null, direction: "left" | "right", target: Element) => void;
  /**
   * Whether a tap on `id` waits out the double-tap window before it counts: the tap that deselects
   * the selected node must not fire when it turns out to be the first half of "go into".
   */
  defersTap: (id: string) => boolean;
  /**
   * Whether swiping `id` in `direction` moves its element out of its place (a Plan card crossing
   * to the other pane). Such an element follows the finger all the way and, past the threshold,
   * flies out in the swipe's direction before `onSwipe` fires; any other only nudges. Absent, none do.
   */
  flysOut?: (id: string, direction: "left" | "right") => boolean;
  /**
   * A finger held on a node and then moved: the Mindmap's drag. Absent, holding and moving is
   * nothing. `start` is told where the finger went down; `move` and `end` where it is.
   */
  holdDrag?: {
    start: (id: string, x: number, y: number) => void;
    move: (x: number, y: number) => void;
    end: (x: number, y: number) => void;
  };
  /** Two fingers swiped up together, anywhere in the container. Never also a one-finger gesture. */
  onTwoFingerUp?: () => void;
  /** Three fingers tapped together, anywhere in the container. */
  onThreeFingerTap?: () => void;
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

/** Whether the person asked the system for less motion: then a card neither slides nor flies. */
function prefersReducedMotion(): boolean {
  return typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

interface Press {
  start: TouchSample;
  last: TouchSample;
  id: string | null;
  element: HTMLElement | null;
  target: Element;
  held: boolean;
  dragging: boolean;
  /** Whether the swipe in the direction the finger is going would fly this element out. */
  leaves: boolean;
}

/** A touch with two or more fingers in progress: a pinch, a two-finger swipe or a multi-finger tap. */
interface MultiTouch {
  startedAt: number;
  /** The most fingers that were down together. */
  fingers: number;
  /** Where each finger (by position in `touches`) first went down. */
  origins: TouchSample[];
  /** The first two fingers' latest positions, for the two-finger swipe. */
  firstTwoStart: TwoFingers | null;
  firstTwoLast: TwoFingers | null;
  /** The farthest any finger has strayed from where it went down. */
  farthest: number;
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
    let flyTimer: ReturnType<typeof setTimeout> | null = null;
    let returnTimer: ReturnType<typeof setTimeout> | null = null;

    function clearHold() {
      if (holdTimer !== null) clearTimeout(holdTimer);
      holdTimer = null;
    }

    function slide(element: HTMLElement | null, dx: number, leaves: boolean) {
      if ((!slidesRows && !leaves) || element === null || prefersReducedMotion()) return;
      element.style.transform = dx === 0 ? "" : `translateX(${slideOffset(dx, leaves)}px)`;
      element.style.transition = dx === 0 ? "transform 0.15s ease" : "none";
    }

    /** Springs an element back to its place, whether it was dragged or flown out. */
    function settle(element: HTMLElement) {
      element.style.transition = "transform 0.15s ease, opacity 0.15s ease";
      element.style.transform = "";
      element.style.opacity = "";
    }

    /**
     * Slides a committed element out the way it was swiped, then runs `done`. If the action leaves
     * the element in place (a refused move), it springs back a moment later. With reduced motion
     * there is no slide at all: `done` runs at once.
     */
    function flyOut(element: HTMLElement | null, direction: "left" | "right", done: () => void) {
      if (element === null || prefersReducedMotion()) { done(); return; }
      const distance = (element.offsetWidth || window.innerWidth) * (direction === "right" ? 1 : -1);
      element.style.transition = `transform ${FLY_OUT_MS}ms ease-in, opacity ${FLY_OUT_MS}ms ease-in`;
      element.style.transform = `translateX(${distance}px)`;
      element.style.opacity = "0";
      flyTimer = setTimeout(() => {
        flyTimer = null;
        done();
        returnTimer = setTimeout(() => { returnTimer = null; settle(element); }, RETURN_AFTER_MS);
      }, FLY_OUT_MS);
    }

    let multi: MultiTouch | null = null;

    function firstTwo(touches: TouchList, time: number): TwoFingers | null {
      const [a, b] = [touches[0], touches[1]];
      return a === undefined || b === undefined ? null : [sample(a, time), sample(b, time)];
    }

    function trackMulti(event: TouchEvent) {
      const count = event.touches.length;
      if (multi === null) {
        multi = { startedAt: event.timeStamp, fingers: count, origins: [], firstTwoStart: null, firstTwoLast: null, farthest: 0 };
      }
      multi.fingers = Math.max(multi.fingers, count);
      for (let index = 0; index < count; index += 1) {
        const touch = event.touches[index];
        if (touch !== undefined && multi.origins[index] === undefined) multi.origins[index] = sample(touch, event.timeStamp);
      }
      // The swipe is judged from the moment the second finger landed (a third finger voids it).
      if (count === 2 && multi.firstTwoStart === null) multi.firstTwoStart = firstTwo(event.touches, event.timeStamp);
      multi.firstTwoLast = firstTwo(event.touches, event.timeStamp);
    }

    function trackMultiMove(event: TouchEvent) {
      if (multi === null) return;
      for (let index = 0; index < event.touches.length; index += 1) {
        const touch = event.touches[index];
        const origin = multi.origins[index];
        if (touch !== undefined && origin !== undefined) {
          multi.farthest = Math.max(multi.farthest, Math.hypot(touch.clientX - origin.x, touch.clientY - origin.y));
        }
      }
      if (event.touches.length === 2) multi.firstTwoLast = firstTwo(event.touches, event.timeStamp);
    }

    /** Ends a multi-finger touch once the last finger is up: a tap of three, or a swipe of two. */
    function finishMulti(event: TouchEvent) {
      const finished = multi;
      multi = null;
      if (finished === null) return;
      const on = latest.current;
      if (isThreeFingerTap(finished.fingers, finished.farthest, event.timeStamp - finished.startedAt)) {
        on.onThreeFingerTap?.();
        return;
      }
      const { firstTwoStart: from, firstTwoLast: to } = finished;
      if (finished.fingers === 2 && from !== null && to !== null && isTwoFingerSwipeUp(from, to)) on.onTwoFingerUp?.();
    }

    function onTouchStart(event: TouchEvent) {
      lastTouchAt = event.timeStamp;
      if (event.touches.length !== 1) {
        // A second finger: this is a pinch, a two-finger swipe or a multi-finger tap, never a node
        // gesture: whatever the first finger had begun is cancelled, and the rest of this touch is
        // read only by `finishMulti`.
        clearHold();
        if (press !== null) slide(press.element, 0, press.leaves);
        press = null;
        trackMulti(event);
        return;
      }
      multi = null;
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
        target,
        held: false, dragging: false, leaves: false,
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
      trackMultiMove(event);
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
      if (Math.abs(dx) > 2 * Math.abs(press.last.y - press.start.y)) {
        const direction = dx > 0 ? "right" : "left";
        press.leaves = press.id !== null && latest.current.flysOut?.(press.id, direction) === true;
        slide(press.element, dx, press.leaves);
      }
    }

    function onTouchEnd(event: TouchEvent) {
      clearHold();
      if (multi !== null && event.touches.length === 0) finishMulti(event);
      const current = press;
      press = null;
      if (current === null || event.touches.length > 0) return;
      const touch = event.changedTouches[0];
      const end = touch === undefined ? current.last : sample(touch, event.timeStamp);
      const on = latest.current;
      const gesture = classifyRelease(current.start, end);
      const commits = gesture.kind === "swipe" && current.leaves && slideOutcome(end.x - current.start.x) === "commit";
      // A committed swipe keeps the element where the finger left it until it has flown out.
      if (!commits) slide(current.element, 0, current.leaves);

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

      if (gesture.kind === "none") return;
      // A tap on no node is the control's under it — a path header's segment, a pane's button.
      if (gesture.kind === "tap" && current.id === null) return;
      event.preventDefault();
      if (gesture.kind === "flickUp") { on.onFlickUp(current.id, current.target); return; }
      if (gesture.kind === "swipe") {
        const { id, target } = current;
        const direction = gesture.direction;
        if (commits) flyOut(current.element, direction, () => latest.current.onSwipe(id, direction, target));
        else on.onSwipe(id, direction, target);
        return;
      }

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
      multi = null;
      if (press !== null) slide(press.element, 0, press.leaves);
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
      if (flyTimer !== null) clearTimeout(flyTimer);
      if (returnTimer !== null) clearTimeout(returnTimer);
      for (const [type, listener, options] of listeners) container.removeEventListener(type, listener, options);
    };
  }, [containerRef, enabled, idAttribute, slidesRows]);
}
