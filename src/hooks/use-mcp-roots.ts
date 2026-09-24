import { useCallback, useEffect, useMemo, useState } from "react";
import {
  addMcpRoot, fetchMcpAccessCatalogue, listMcpAccess, removeMcpRoot,
} from "@/api/mcp-access";
import type { McpAccessCatalogue, McpNodeKey, McpVisibility } from "@/api/mcp-access";
import { getErrorMessage } from "@/api/errors";
import { useMcpAccessStore } from "@/stores/use-mcp-access-store";
import { catalogueKeyOf, describeRoots, rootCandidates } from "@/utils/mcp-roots";
import type { McpRootRow } from "@/utils/mcp-roots";
import type { SearchableNode } from "@/utils/mindmap-tree";

const EMPTY_CATALOGUE: McpAccessCatalogue = { roots: [], nodes: [] };

export interface McpRoots {
  roots: McpRootRow[];
  /** Every node that could be added, for the node search. */
  candidates: SearchableNode[];
  isLoading: boolean;
  error: string | null;
  /** Adds the node a search result's id names. */
  addRoot: (candidateId: string) => Promise<void>;
  removeRoot: (key: McpNodeKey) => Promise<void>;
}

/**
 * The MCP roots for the settings page: what they are, what could be added, and the two edits.
 *
 * Each edit is one command and so one Gesture — Ctrl+Z reverses it like any board edit. After one
 * lands, the page re-reads its list and every open view is told to redraw its badges.
 */
export function useMcpRoots(): McpRoots {
  const [catalogue, setCatalogue] = useState<McpAccessCatalogue>(EMPTY_CATALOGUE);
  const [visible, setVisible] = useState<McpVisibility[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const rootsChanged = useMcpAccessStore((s) => s.rootsChanged);

  const load = useCallback(async () => {
    try {
      const [nextCatalogue, nextVisible] = await Promise.all([fetchMcpAccessCatalogue(), listMcpAccess()]);
      setCatalogue(nextCatalogue);
      setVisible(nextVisible);
      setError(null);
    } catch (err: unknown) {
      setError(getErrorMessage(err));
    } finally {
      setIsLoading(false);
    }
  }, []);

  // Fetching on mount is the effect's job; the state it sets arrives after the await, as the board's
  // own load does in `use-mindmap-data`.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  const edit = useCallback(async (write: () => Promise<void>) => {
    try {
      await write();
      rootsChanged();
      await load();
    } catch (err: unknown) {
      setError(getErrorMessage(err));
    }
  }, [load, rootsChanged]);

  const addRoot = useCallback(async (candidateId: string) => {
    const key = catalogueKeyOf(candidateId, catalogue.nodes);
    if (key === undefined) return;
    await edit(() => addMcpRoot(key));
  }, [catalogue.nodes, edit]);

  const removeRoot = useCallback((key: McpNodeKey) => edit(() => removeMcpRoot(key)), [edit]);

  const roots = useMemo(
    () => describeRoots(catalogue.roots, catalogue.nodes, visible),
    [catalogue, visible],
  );
  const candidates = useMemo(() => rootCandidates(catalogue.roots, catalogue.nodes), [catalogue]);

  return { roots, candidates, isLoading, error, addRoot, removeRoot };
}
