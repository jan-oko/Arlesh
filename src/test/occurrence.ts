import type { HabitOrigin } from "@/api/node-id";
import type { NodeCapabilities } from "@/api/mindmap";
import { NO_CYCLE } from "@/api/flows";
import { storedRowId } from "@/test/stored-id";

/** What a test says about the occurrence it draws; everything else takes a plain default. */
interface OccurrenceFixture {
  habitId?: number;
  itemType?: HabitOrigin["item_type"];
  itemId?: number;
  /** `0` is the "no cycle" pair: the nil UUID. */
  cycleId?: number;
  index?: number;
  startDate?: string;
  windowEnd?: string;
}

/** A Habit occurrence's `origin`, for a node fixture that draws one. */
export function occurrenceOrigin({
  habitId = 1, itemType = "flow_task", itemId = 1, cycleId = 0, index = 0,
  startDate = "2026-01-05", windowEnd = "2026-01-06T00:00:00",
}: OccurrenceFixture = {}): HabitOrigin {
  return {
    kind: "habit",
    habit_id: storedRowId(habitId),
    iteration_scope: {
      index, start_date: startDate, window_end: windowEnd, scope_id: { kind: "day", date: startDate },
      kind: "day", status: "active",
    },
    item_type: itemType,
    item_id: storedRowId(itemId),
    cycle_id: cycleId === 0 ? NO_CYCLE : storedRowId(cycleId),
  };
}

/**
 * The fields a node fixture takes to draw a Habit occurrence: a UUID row id, its origin, and what
 * the load's facts say it may be done to (`nodes::rules::capabilities`) — anything but be copied.
 */
export function occurrenceRow(fixture: OccurrenceFixture = {}): {
  rowId: string; origin: HabitOrigin; capabilities: NodeCapabilities;
} {
  const { habitId = 1, itemId = 1, cycleId = 0 } = fixture;
  const origin = occurrenceOrigin(fixture);
  return {
    capabilities: { delete: true, copy: false, drag: true, compound: true, dependencies: true },
    rowId: `00000000-0000-8000-8${String(origin.iteration_scope.index).padStart(3, "0")}-${String(habitId).padStart(4, "0")}${String(itemId).padStart(4, "0")}${String(cycleId).padStart(4, "0")}`,
    origin,
  };
}
