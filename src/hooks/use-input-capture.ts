import { useEffect, useId } from "react";
import { useInputCaptureStore } from "@/stores/use-input-capture-store";

/**
 * Marks the calling component as capturing the keyboard, suppressing the view-level hotkeys.
 *
 * Modals call this with no argument: the mount itself is the signal, so there is no flag left
 * behind when the component stops rendering. Inline editors, which stay mounted around their input,
 * pass whether they are currently editing.
 */
export function useInputCapture(active = true): void {
  const token = useId();
  const acquire = useInputCaptureStore((s) => s.acquire);
  const release = useInputCaptureStore((s) => s.release);

  useEffect(() => {
    if (!active) return;
    acquire(token);
    return () => release(token);
  }, [active, token, acquire, release]);
}

/** Whether any modal or inline editor is currently on screen. */
export function useIsInputCaptured(): boolean {
  return useInputCaptureStore((s) => s.captors.size > 0);
}
