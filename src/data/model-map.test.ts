import { describe, expect, it } from "vitest";
import { GRAPH_CARD_OF } from "@/data/derivation-graph";
import { MODEL_MAP_CARDS, MODEL_MAP_GROUPS } from "@/data/model-map";

describe("the model map content", () => {
  // The counts of the page this replaced (`docs/model-map.html`), written out so a lost group or card fails here.
  it("has the 8 groups and 38 concept cards the HTML page had", () => {
    expect(MODEL_MAP_GROUPS).toHaveLength(8);
    expect(MODEL_MAP_GROUPS.flatMap((group) => group.cards)).toHaveLength(38);
    expect(MODEL_MAP_CARDS.size).toBe(38);
  });

  it("numbers its groups 1 to 8 in order", () => {
    expect(MODEL_MAP_GROUPS.map((group) => group.number)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });

  it("gives every card all four facts", () => {
    for (const card of MODEL_MAP_CARDS.values()) {
      expect(card.is).not.toBe("");
      expect(card.why).not.toBe("");
      expect(card.without).not.toBe("");
      expect(card.lives).not.toBe("");
    }
  });

  it("points every graph box at a card that exists", () => {
    for (const title of Object.values(GRAPH_CARD_OF)) expect(MODEL_MAP_CARDS.has(title)).toBe(true);
  });
});
