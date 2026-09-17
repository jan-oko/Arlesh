import { useEffect, useRef } from "react";
import type { RefObject } from "react";

/**
 * What Tab can land on. Disabled controls and `tabindex="-1"` are excluded because the browser
 * skips them too — the trap has to agree with native tab order or it would fight it.
 */
const FOCUSABLE_SELECTOR = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  '[tabindex]:not([tabindex="-1"])',
].join(", ");

function focusableWithin(container: HTMLElement): HTMLElement[] {
  return [...container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)];
}

/**
 * Keeps Tab and Shift+Tab inside one container, so a modal's keyboard focus cannot walk out into
 * the page behind it and leave the user tabbing through the whole app to get back.
 *
 * Attach the returned ref to the element that bounds the modal. Tab past the last control wraps to
 * the first, Shift+Tab before the first wraps to the last, and a Tab pressed while focus has
 * somehow escaped pulls it back in. A container with nothing focusable in it (every button
 * disabled, say) is left alone rather than swallowing the key.
 *
 * Only Tab is handled: Escape, Enter and everything else stay with whoever owns them.
 */
export function useFocusTrap<T extends HTMLElement = HTMLElement>(active = true): RefObject<T | null> {
  const ref = useRef<T | null>(null);

  useEffect(() => {
    if (!active) return;
    const container = ref.current;
    if (container === null) return;

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key !== "Tab" || container === null) return;
      const focusable = focusableWithin(container);
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (first === undefined || last === undefined) return;

      const current = document.activeElement;
      const isInside = current instanceof HTMLElement && container.contains(current);
      if (!isInside) {
        event.preventDefault();
        (event.shiftKey ? last : first).focus();
        return;
      }
      if (!event.shiftKey && current === last) {
        event.preventDefault();
        first.focus();
        return;
      }
      if (event.shiftKey && current === first) {
        event.preventDefault();
        last.focus();
      }
    }

    // Capture phase on the document, not the container: a Tab pressed after focus has escaped is
    // exactly the case the trap exists for, and that keydown never reaches the container.
    document.addEventListener("keydown", handleKeyDown, true);
    return () => document.removeEventListener("keydown", handleKeyDown, true);
  }, [active]);

  return ref;
}
