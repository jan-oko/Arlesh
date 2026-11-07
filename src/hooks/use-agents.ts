import { useCallback, useEffect, useState } from "react";
import {
  applyAgentAction, fetchAgents, issueAgentPin, onAgentsChanged, setAgentAccountLocked,
} from "@/api/agents";
import type { AgentAction, AgentsOverview, IssuedPin } from "@/api/agents";
import { onBoardChanged } from "@/api/board";
import { getErrorMessage } from "@/api/errors";
import { fetchMcpAccessCatalogue } from "@/api/mcp-access";
import type { McpCatalogueNode } from "@/api/mcp-access";

const EMPTY: AgentsOverview = { agents: [], accounts: [] };
const NO_NODES: McpCatalogueNode[] = [];

/** The agents for the settings page, and the edits the user makes by hand. */
export interface Agents {
  overview: AgentsOverview;
  /** Every stored node, to name an agent's subtree. */
  nodes: McpCatalogueNode[];
  isLoading: boolean;
  /** The last failure to read or change, or `null`. Never thrown. */
  error: string | null;
  /** The PIN last asked for, or `null`. */
  pin: IssuedPin | null;
  act: (id: number, action: AgentAction) => Promise<void>;
  lockAccount: (label: string, locked: boolean) => Promise<void>;
  requestPin: () => Promise<void>;
}

/**
 * The agents and accounts, kept current: read on mount, and again each time the backend says the
 * agents changed (from this window, another, or an agent over the MCP) or the board did. A failed
 * edit is recorded in `error` and shown, never dropped.
 */
export function useAgents(): Agents {
  const [overview, setOverview] = useState<AgentsOverview>(EMPTY);
  const [nodes, setNodes] = useState<McpCatalogueNode[]>(NO_NODES);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pin, setPin] = useState<IssuedPin | null>(null);

  const load = useCallback(async (clearError = true) => {
    try {
      const [next, catalogue] = await Promise.all([fetchAgents(), fetchMcpAccessCatalogue()]);
      setOverview(next);
      setNodes(catalogue.nodes);
      if (clearError) setError(null);
    } catch (err: unknown) {
      setError(getErrorMessage(err));
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    let subscribed = true;
    const stops: Array<() => void> = [];
    const keep = (stop: () => void) => { if (subscribed) stops.push(stop); else stop(); };
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
    void onAgentsChanged(() => { void load(); }).then(keep);
    void onBoardChanged(() => { void load(); }).then(keep);
    return () => {
      subscribed = false;
      stops.forEach((stop) => stop());
    };
  }, [load]);

  const edit = useCallback(async (write: () => Promise<void>) => {
    setError(null);
    try {
      await write();
    } catch (err: unknown) {
      setError(getErrorMessage(err));
    }
    // Read again either way, but leave a failed edit's message standing.
    await load(false);
  }, [load]);

  const act = useCallback(
    (id: number, action: AgentAction) => edit(() => applyAgentAction(id, action)),
    [edit],
  );
  const lockAccount = useCallback(
    (label: string, locked: boolean) => edit(() => setAgentAccountLocked(label, locked)),
    [edit],
  );
  const requestPin = useCallback(async () => {
    try {
      setPin(await issueAgentPin());
      setError(null);
    } catch (err: unknown) {
      setError(getErrorMessage(err));
    }
  }, []);

  return { overview, nodes, isLoading, error, pin, act, lockAccount, requestPin };
}
