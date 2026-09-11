import { useEffect, useRef } from "react";
import type { Binding } from "@/utils/hotkeys/chord";
import { matchesChord } from "@/utils/hotkeys/chord";

/** Whether a shortcut should be suppressed because the event came from somewhere the user types. */
function isTypingTarget(target: EventTarget | null): boolean {
  return target instanceof HTMLElement &&
    (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable);
}

/**
 * Dispatches a keydown against an ordered binding table: the first entry whose chord matches and
 * whose guard passes wins. Order only matters between entries sharing a chord — strict chord
 * matching keeps everything else independent.
 *
 * Events originating in a text input are always ignored, since no binding should fire mid-typing.
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
      if (isTypingTarget(event.target)) return;
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
