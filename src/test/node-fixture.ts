
import { storedRowId } from "@/test/stored-id";

/**
 * The `rowId` a test fixture's node carries, spread into the fixture: `{ rowId: storedRowId(12) }` for a
 * fixture spelled `task-12`, and nothing for any other spelling — `root`, a `-virtual` Habit node.
 *
 * Tests only. It lets a fixture keep naming nodes the way the tree builder spells them without
 * repeating the number beside every id; production code never recovers a row from an id, it
 * reads `rowIdOf(node)`.
 */
export function fixtureRowId(id: string): { rowId?: string } {
  const spelled = /^[a-z_]+-([0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[0-9a-f]{4}-[0-9a-f]{12})$/.exec(id);
  if (spelled?.[1] !== undefined) return { rowId: spelled[1] };
  const match = /^[a-z_]+-(\d+)$/.exec(id);
  const digits = match?.[1];
  return digits === undefined ? {} : { rowId: storedRowId(Number(digits)) };
}
