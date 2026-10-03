import { describe, expect, it } from "vitest";
import corpusJson from "@conformance/parenting.json";
import { fail, record, str } from "@/test/conformance-board";
import type { NodeKind } from "@/utils/tree-layout";
import { isNodeKind } from "@/utils/tree-layout";
import { isValidDropTarget } from "@/utils/node-meta";

/**
 * The parenting table has two evaluators: `isValidDropTarget`, which the Mindmap asks per pointer
 * move, and `nodes::rules::parenting::may_parent`, which every writer asks.
 * `conformance/parenting.json` writes the whole matrix down;
 * `src-tauri/tests/operations/parenting_conformance.rs` is this file's other half.
 */

function kinds(value: unknown, what: string): NodeKind[] {
  if (!Array.isArray(value)) fail(`${what} is not an array`);
  return value.map((entry, index) => {
    const kind = str(entry, `${what}[${index}]`);
    return isNodeKind(kind) ? kind : fail(`${what}[${index}] is not a node kind: ${kind}`);
  });
}

const top = record(corpusJson, "the corpus");
const allKinds = kinds(top.kinds, "`kinds`");
const parents = record(top.parents, "`parents`");

describe("parenting conformance corpus", () => {
  it("names the parents of every kind, even when it has none", () => {
    expect(Object.keys(parents).sort()).toEqual([...allKinds].sort());
  });

  for (const child of allKinds) {
    it(`a ${child} hangs under exactly the kinds the corpus names`, () => {
      const allowed = kinds(parents[child], `parents.${child}`);
      for (const parent of allKinds) {
        expect(isValidDropTarget(child, parent), `${child} under ${parent}`).toBe(allowed.includes(parent));
      }
    });
  }
});
