import { describe, expect, it } from "vitest";
import { GRAPH_EDGES, GRAPH_NODES } from "@/data/derivation-graph";
import { neighbourhood, placeGraph } from "./derivation-graph";

describe("the derivation graph data", () => {
  // The counts of the page this replaced (the standalone HTML graph page), written out so a lost box fails here.
  it("has the 43 boxes and 81 arrows the HTML page had", () => {
    expect(GRAPH_NODES).toHaveLength(43);
    expect(GRAPH_EDGES).toHaveLength(81);
  });

  it("has unique ids and arrows that join existing boxes", () => {
    const ids = new Set(GRAPH_NODES.map((node) => node.id));
    expect(ids.size).toBe(43);
    for (const edge of GRAPH_EDGES) {
      expect(ids.has(edge.from)).toBe(true);
      expect(ids.has(edge.to)).toBe(true);
    }
  });

  it("draws every arrow", () => {
    expect(placeGraph().edges).toHaveLength(81);
  });
});

describe("placeGraph", () => {
  it("places a box at its column and row and records what it reads", () => {
    const graph = placeGraph(
      [
        { id: "a", label: "A", col: 0, row: 1, kind: "in", text: "", spec: "" },
        { id: "b", label: "B", col: 1, row: 0, kind: "dv", text: "", spec: "" },
      ],
      [{ from: "a", to: "b", far: false }],
    );
    const [a, b] = graph.nodes;
    expect(a?.x).toBe(16);
    expect(a?.y).toBe(22 + 34);
    expect(b?.reads).toEqual(["a"]);
    expect(a?.readBy).toEqual(["b"]);
    expect(graph.edges[0]?.path.startsWith("M192 ")).toBe(true);
  });

  it("neighbourhood is the box and both sides of its links", () => {
    const [a] = placeGraph(
      [
        { id: "a", label: "A", col: 0, row: 0, kind: "in", text: "", spec: "" },
        { id: "b", label: "B", col: 1, row: 0, kind: "dv", text: "", spec: "" },
      ],
      [{ from: "a", to: "b", far: false }],
    ).nodes;
    expect(a).toBeDefined();
    if (a !== undefined) expect([...neighbourhood(a)].sort()).toEqual(["a", "b"]);
  });
});
