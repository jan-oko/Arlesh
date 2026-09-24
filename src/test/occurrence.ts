import type { HabitOrigin } from "@/api/node-id";

/** What a test says about the occurrence it draws; everything else takes a plain default. */
interface OccurrenceFixture {
  habitId?: number;
  itemType?: HabitOrigin["item_type"];
  itemId?: number;
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
    habit_id: habitId,
    iteration_scope: {
      index, start_date: startDate, window_end: windowEnd, scope_id: `day:${startDate}`,
      kind: "day", status: "active",
    },
    item_type: itemType,
    item_id: itemId,
    cycle_id: cycleId,
  };
}

/** The fields a node fixture takes to draw a Habit occurrence: a UUID row id and its origin. */
export function occurrenceRow(fixture: OccurrenceFixture = {}): { rowId: string; origin: HabitOrigin } {
  const origin = occurrenceOrigin(fixture);
  return {
    rowId: `00000000-0000-5000-8${String(origin.iteration_scope.index).padStart(3, "0")}-${String(origin.habit_id).padStart(4, "0")}${String(origin.item_id).padStart(4, "0")}${String(origin.cycle_id).padStart(4, "0")}`,
    origin,
  };
}
