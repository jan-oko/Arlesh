import { useCallback, useMemo, useState } from "react";
import type { PlacedGraph } from "@/utils/derivation-graph";
import { neighbourhood, placeGraph } from "@/utils/derivation-graph";

/** What the graph is showing: the placed boxes, what is hovered or pinned, and what that lights up. */
export interface DerivationGraphState {
  graph: PlacedGraph;
  hovered: string | null;
  /** Pinned boxes, in the order they were pinned. */
  selected: readonly string[];
  /** Ids of the boxes and arrows' ends in the focus: each focused box and its direct links. */
  active: ReadonlySet<string>;
  /** Ids of the linked boxes that are not themselves focused. */
  linked: ReadonlySet<string>;
  /** Whether an arrow touches a focused box. */
  isArrowActive: (from: string, to: string) => boolean;
  setHovered: (id: string | null) => void;
  toggle: (id: string) => void;
  clear: () => void;
}

/** The Help graph's interaction: hover or focus previews a box, a click or tap pins it. */
export function useDerivationGraph(): DerivationGraphState {
  const graph = useMemo(() => placeGraph(), []);
  const [hovered, setHovered] = useState<string | null>(null);
  const [selected, setSelected] = useState<readonly string[]>([]);

  const toggle = useCallback((id: string) => {
    setSelected((now) => (now.includes(id) ? now.filter((candidate) => candidate !== id) : [...now, id]));
  }, []);
  const clear = useCallback(() => setSelected([]), []);

  const focus = useMemo(() => [...selected, ...(hovered === null ? [] : [hovered])], [selected, hovered]);
  const { active, linked } = useMemo(() => {
    const on = new Set<string>();
    const lit = new Set<string>();
    for (const id of focus) {
      const node = graph.nodes.find((candidate) => candidate.id === id);
      if (node === undefined) continue;
      for (const neighbour of neighbourhood(node)) {
        on.add(neighbour);
        if (neighbour !== id) lit.add(neighbour);
      }
    }
    return { active: on, linked: lit };
  }, [focus, graph]);

  const isArrowActive = useCallback(
    (from: string, to: string) => focus.some((id) => id === from || id === to),
    [focus],
  );

  return { graph, hovered, selected, active, linked, isArrowActive, setHovered, toggle, clear };
}
