import { useEffect, useId, useRef } from "react";
import { useCommandSurfaceStore } from "@/stores/use-command-surface-store";
import type { TouchLabelKey } from "@/stores/use-command-surface-store";

/** A command with no key of its own, which a view offers the action bar and the palette. */
export interface TouchCommand {
  id: string;
  labelKey: TouchLabelKey;
  canRun: () => boolean;
  run: () => void;
}

/**
 * Publishes a touch command to the command surface for as long as the calling view is mounted —
 * beside its bindings, which `useHotkeys` publishes (`docs/spec/touch.md`). The latest `canRun` and
 * `run` are read through a ref, as a binding's context is.
 */
export function useTouchCommand(command: TouchCommand): void {
  const latest = useRef(command);
  const token = useId();
  useEffect(() => {
    latest.current = command;
  });
  const { id, labelKey } = command;
  useEffect(() => {
    const { publish, withdraw } = useCommandSurfaceStore.getState();
    publish(token, [{
      id,
      chord: null,
      label: { namespace: "touch", key: labelKey },
      section: "touch",
      group: null,
      hidden: false,
      canRun: () => latest.current.canRun(),
      run: () => latest.current.run(),
    }]);
    return () => withdraw(token);
  }, [token, id, labelKey]);
}
