import { useEffect } from "react";
import type { RefObject } from "react";

/**
 * How an inline picker popover closes, the same way everywhere: a **click outside** it or
 * **Enter** commits, **Escape** cancels. Escape is stopped here so it closes the picker and not
 * the editor the picker sits in.
 *
 * Listened for on the document, in the capture phase, so a picker nested in a modal still hears
 * the click that lands on the modal's own body.
 */
export function usePopoverDismiss(
  ref: RefObject<HTMLElement | null>,
  open: boolean,
  onCommit: () => void,
  onCancel: () => void,
): void {
  useEffect(() => {
    if (!open) return;
    function onMouseDown(event: MouseEvent) {
      const target = event.target;
      if (target instanceof Node && ref.current !== null && !ref.current.contains(target)) onCommit();
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.stopPropagation();
        event.preventDefault();
        onCancel();
      } else if (event.key === "Enter") {
        event.stopPropagation();
        event.preventDefault();
        onCommit();
      }
    }
    document.addEventListener("mousedown", onMouseDown, true);
    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      document.removeEventListener("mousedown", onMouseDown, true);
      document.removeEventListener("keydown", onKeyDown, true);
    };
  }, [ref, open, onCommit, onCancel]);
}
