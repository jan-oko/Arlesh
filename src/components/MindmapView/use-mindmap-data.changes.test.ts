import { describe, expect, it, vi } from "vitest";
import corpusJson from "@conformance/board-changes.json";
import type { MindmapLoad } from "@/api/mindmap";
import type { SharedBoard } from "@/stores/use-board-store";
import { fail, record, str } from "@/test/conformance-board";
import { applyBoardChanges, indexBoard } from "@/utils/board-changes";
import type { BoardChanges } from "@/utils/board-changes";
import { treeOfBoard } from "./use-mindmap-data";
import type { TreeInputs } from "./use-mindmap-data";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

/**
 * A window that takes in a board by applying changes draws the same tree as one that loaded it
 * whole, whatever order the rows are held in (ADR 0020, decision 12): nothing on the client reads
 * meaning into a collection's order except through a field.
 */

const inputs: TreeInputs = {
  scopeLabels: { week: (n: number) => `W${n}`, month: () => "M", season: (name: string) => name },
  checkPrefix: "Check: ",
  delegationWaitTitle: (title) => title,
  capacityReason: "capacity",
  carriesMissed: () => "missed",
  compoundReason: "compound",
  cooldownReason: () => "cooldown",
};

function isLoad(value: unknown): value is MindmapLoad {
  return typeof value === "object" && value !== null && Array.isArray(Reflect.get(value, "tasks"));
}

function load(text: string): MindmapLoad {
  const parsed: unknown = JSON.parse(text);
  return isLoad(parsed) ? parsed : fail("a board is not a MindmapLoad");
}

function changes(text: string): BoardChanges {
  const parsed: unknown = JSON.parse(text);
  return typeof parsed === "object" && parsed !== null ? parsed : fail("changes are not an object");
}

function shared(board: MindmapLoad): SharedBoard {
  return {
    load: board, now: "2026-11-13T12:00:00", personNames: new Map(),
    stamp: { read: 1, epoch: "e", seq: 1, revision: 1, at: 0 }, digests: indexBoard(board).digests,
  };
}

const cases = record(corpusJson, "the corpus").cases;
const all: unknown[] = Array.isArray(cases) ? cases : fail("`cases` is not an array");

describe("the tree of a board that changes were applied to", () => {
  all.forEach((raw, index) => {
    const one = record(raw, `cases[${index}]`);
    const name = str(one.name, "name");

    it(`${name}: is the tree of a fresh load of the board after`, () => {
      const before = indexBoard(load(str(one.before_json, "before_json")));
      const after = load(str(one.after_json, "after_json"));

      const applied = applyBoardChanges(before, changes(str(one.changes_json, "changes_json")));

      expect(JSON.stringify(treeOfBoard(shared(applied.load), inputs))).toBe(
        JSON.stringify(treeOfBoard(shared(after), inputs)),
      );
    });
  });

  it("is the same tree whatever order the rows of a collection are held in", () => {
    const board = load(str(record(all[0], "cases[0]").after_json, "after_json"));
    const shuffled: MindmapLoad = { ...board, tasks: [...board.tasks].reverse(), domains: [...board.domains].reverse() };

    expect(JSON.stringify(treeOfBoard(shared(shuffled), inputs))).toBe(JSON.stringify(treeOfBoard(shared(board), inputs)));
  });
});
