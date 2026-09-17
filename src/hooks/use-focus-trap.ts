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
 * Every trapped container currently on screen, in the order they appeared. Dialogs stack — a
 * confirmation can open over an editor that is still mounted behind it — and only the one on top
 * may hold focus. Without this the dialog underneath would see focus land in the dialog above,
 * decide it had escaped, and yank it back down into itself.
 */
const trapStack: HTMLElement[] = [];

/**
 * The trap that currently owns Tab: the last one opened that is still on screen. Containers that
 * have been detached without their hook unmounting are skipped, so a stale entry cannot leave
 * every dialog underneath it standing down forever.
 */
function topmostTrap(): HTMLElement | undefined {
  for (let i = trapStack.length - 1; i >= 0; i--) {
    const candidate = trapStack[i];
    if (candidate !== undefined && candidate.isConnected) return candidate;
  }
  return undefined;
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
 *
 * Dialogs stack, so only the most recently opened trap is live; the ones underneath stand down
 * until it closes, rather than fighting it for focus.
 */
export function useFocusTrap<T extends HTMLElement = HTMLElement>(active = true): RefObject<T | null> {
  const ref = useRef<T | null>(null);

  useEffect(() => {
    if (!active) return;
    const container = ref.current;
    if (container === null) return;

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key !== "Tab" || container === null) return;
      if (topmostTrap() !== container) return; // a dialog is open over this one
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

    trapStack.push(container);
    // Capture phase on the document, not the container: a Tab pressed after focus has escaped is
    // exactly the case the trap exists for, and that keydown never reaches the container.
    document.addEventListener("keydown", handleKeyDown, true);
    return () => {
      const at = trapStack.lastIndexOf(container);
      if (at !== -1) trapStack.splice(at, 1);
      document.removeEventListener("keydown", handleKeyDown, true);
    };
  }, [active]);

  return ref;
}
