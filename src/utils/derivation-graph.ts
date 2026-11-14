import type { GraphEdge, GraphNode } from "@/data/derivation-graph";
import {
  GRAPH_BOX_HEIGHT, GRAPH_COLUMN_WIDTH, GRAPH_COLUMN_X, GRAPH_EDGES, GRAPH_NODES, GRAPH_ROW_PITCH, GRAPH_TOP,
} from "@/data/derivation-graph";

/** A box with its place in the drawing and the boxes it reads and is read by. */
export interface PlacedNode extends GraphNode {
  x: number;
  y: number;
  width: number;
  /** Ids of the boxes this one is computed from. */
  reads: string[];
  /** Ids of the boxes that read this one. */
  readBy: string[];
}

/** An arrow with its drawn path. */
export interface PlacedEdge extends GraphEdge {
  path: string;
}

/** The whole graph, placed. */
export interface PlacedGraph {
  nodes: PlacedNode[];
  edges: PlacedEdge[];
}

function edgePath(from: PlacedNode, to: PlacedNode): string {
  const fromY = from.y + GRAPH_BOX_HEIGHT / 2;
  const toY = to.y + GRAPH_BOX_HEIGHT / 2;
  if (to.col > from.col) {
    const startX = from.x + from.width;
    const endX = to.x - 4;
    const mid = (startX + endX) / 2;
    return `M${startX} ${fromY} C${mid} ${fromY} ${mid} ${toY} ${endX} ${toY}`;
  }
  if (to.col === from.col) {
    const bend = from.x - 34;
    return `M${from.x} ${fromY} C${bend} ${fromY} ${bend} ${toY} ${from.x} ${toY}`;
  }
  const startX = from.x + from.width / 2;
  const startY = from.y + GRAPH_BOX_HEIGHT;
  const endX = to.x + to.width + 4;
  const low = Math.max(from.y, to.y) + 60;
  return `M${startX} ${startY} C${startX} ${low} ${endX + 40} ${toY} ${endX} ${toY}`;
}

/** Lays the graph out: each box at its column and row, each arrow as a curve between two boxes. */
export function placeGraph(
  nodes: readonly GraphNode[] = GRAPH_NODES,
  edges: readonly GraphEdge[] = GRAPH_EDGES,
): PlacedGraph {
  const placed = new Map<string, PlacedNode>();
  for (const node of nodes) {
    placed.set(node.id, {
      ...node,
      x: GRAPH_COLUMN_X[node.col] ?? 0,
      y: GRAPH_TOP + node.row * GRAPH_ROW_PITCH,
      width: GRAPH_COLUMN_WIDTH[node.col] ?? 0,
      reads: [],
      readBy: [],
    });
  }
  const placedEdges: PlacedEdge[] = [];
  for (const edge of edges) {
    const from = placed.get(edge.from);
    const to = placed.get(edge.to);
    if (from === undefined || to === undefined) continue;
    from.readBy.push(to.id);
    to.reads.push(from.id);
    placedEdges.push({ ...edge, path: edgePath(from, to) });
  }
  return { nodes: [...placed.values()], edges: placedEdges };
}

/** A box and every box it is directly linked to. */
export function neighbourhood(node: PlacedNode): Set<string> {
  return new Set([node.id, ...node.reads, ...node.readBy]);
}

/** The labels of the boxes with these ids, in order, skipping ids the graph does not have. */
export function labelsOf(graph: PlacedGraph, ids: readonly string[]): string[] {
  return ids.flatMap((id) => graph.nodes.find((node) => node.id === id)?.label ?? []);
}
