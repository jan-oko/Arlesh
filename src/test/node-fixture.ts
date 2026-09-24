
/**
 * The `rowId` a test fixture's node carries, spread into the fixture: `{ rowId: 12 }` for a
 * fixture spelled `task-12`, and nothing for any other spelling — `root`, a `-virtual` Habit node.
 *
 * Tests only. It lets a fixture keep naming nodes the way the tree builder spells them without
 * repeating the number beside every id; production code never recovers a row from an id, it
 * reads `rowIdOf(node)`.
 */
export function fixtureRowId(id: string): { rowId?: number } {
  const match = /^[a-z_]+-(\d+)$/.exec(id);
  const digits = match?.[1];
  return digits === undefined ? {} : { rowId: Number(digits) };
}
