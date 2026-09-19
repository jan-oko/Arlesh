import { useCallback, useMemo, useRef, useState } from "react";
import { useTabsStore } from "@/stores/use-tabs-store";

/** Renaming a tab in the strip: which tab is being edited, and the three ways an edit ends. */
export interface TabRename {
  /** The tab whose label is currently an input, or `null` when none is. */
  editingId: string | null;
  start: (id: string) => void;
  /** Commits what was typed. A blank name takes the name off and restores the derived label. */
  commit: (id: string, name: string) => void;
  /** Abandons the edit, leaving the name exactly as it was. */
  cancel: () => void;
}

/**
 * The strip's rename edit.
 *
 * The cancel flag exists because the input commits on blur — losing focus mid-rename should keep
 * what you typed rather than throw it away — and Escape both cancels *and* takes focus off the
 * input. Without it the blur that Escape causes would write back the very value Escape refused.
 */
export function useTabRename(): TabRename {
  const renameTab = useTabsStore((s) => s.renameTab);
  const [editingId, setEditingId] = useState<string | null>(null);
  const cancelled = useRef(false);

  const start = useCallback((id: string) => {
    cancelled.current = false;
    setEditingId(id);
  }, []);

  const cancel = useCallback(() => {
    cancelled.current = true;
    setEditingId(null);
  }, []);

  const commit = useCallback(
    (id: string, name: string) => {
      if (cancelled.current) return;
      renameTab(id, name);
      setEditingId(null);
    },
    [renameTab],
  );

  return useMemo(() => ({ editingId, start, commit, cancel }), [editingId, start, commit, cancel]);
}
