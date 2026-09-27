import { useEffect, useRef } from "react";
import type { Binding } from "@/utils/hotkeys/chord";
import { matchesChord } from "@/utils/hotkeys/chord";

/** Whether a shortcut should be suppressed because the event came from somewhere the user types. */
function isTypingTarget(target: EventTarget | null): boolean {
  return target instanceof HTMLElement &&
    (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable);
}

/** The keys a focused control acts on by itself: activate, remove, move, dismiss. */
const CONTROL_KEYS: ReadonlySet<string> = new Set([
  "Enter", "NumpadEnter", "Space", "Delete", "Backspace", "Escape", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight",
]);

/**
 * Whether the event is a key pressed inside a region that handles its own keyboard — the Filter
 * menu and the filter chips, marked `data-owns-keys`. The region owns every control key (its pills
 * add on Enter and are removed with Delete; without this, Delete on a set pill would also delete the
 * selected node, since this listener runs first, in the capture phase), plus the key codes its
 * attribute lists — the Filter menu's letters (`KeyT`, `KeyA`, …), with or without Shift or Alt but
 * never with Ctrl or Meta, and any `Ctrl+Key…` token it lists (the menu's `Ctrl+KeyP`, which
 * therefore does not switch to the Plan View while focus is in the menu). Every other chord (Alt+F,
 * Alt+S, Ctrl+F) still reaches its binding.
 */
function isOwnedByRegion(event: KeyboardEvent): boolean {
  if (!(event.target instanceof Element)) return false;
  const region = event.target.closest("[data-owns-keys]");
  if (region === null) return false;
  if (CONTROL_KEYS.has(event.code)) return true;
  const owned = (region.getAttribute("data-owns-keys") ?? "").split(" ");
  if (event.metaKey) return false;
  if (event.ctrlKey) return !event.altKey && !event.shiftKey && owned.includes(`Ctrl+${event.code}`);
  return owned.includes(event.code);
}

/**
 * Dispatches a keydown against an ordered binding table: the first entry whose chord matches and
 * whose guard passes wins. Order only matters between entries sharing a chord — strict chord
 * matching keeps everything else independent.
 *
 * Events originating in a text input are always ignored, since no binding should fire mid-typing, and
 * so is a control key pressed inside a region marked `data-owns-keys` (see `isOwnedByRegion`).
 * Beyond that the hook holds no domain knowledge and no state of its own: gating on an open modal
 * or an active inline edit is the caller's job, expressed through `enabled`.
 */
export function useHotkeys<Ctx>(bindings: readonly Binding<Ctx>[], ctx: Ctx, enabled: boolean): void {
  // The context changes on nearly every render (fresh callbacks); a ref keeps the listener stable
  // instead of detaching and reattaching it each time.
  const ctxRef = useRef(ctx);
  useEffect(() => {
    ctxRef.current = ctx;
  });

  useEffect(() => {
    if (!enabled) return;

    function handleKeyDown(event: KeyboardEvent) {
      if (isTypingTarget(event.target) || isOwnedByRegion(event)) return;
      const context = ctxRef.current;
      const binding = bindings.find((candidate) => {
        if (!matchesChord(event, candidate.chord)) return false;
        if (event.repeat && candidate.allowRepeat === false) return false;
        return candidate.when === undefined || candidate.when(context);
      });
      if (binding === undefined) return;
      event.preventDefault();
      binding.run(context);
    }

    window.addEventListener("keydown", handleKeyDown, { capture: true });
    return () => window.removeEventListener("keydown", handleKeyDown, { capture: true });
  }, [bindings, enabled]);
}
