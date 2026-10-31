import type { HabitChildKind } from "@/api/flows";

/**
 * A row hung on a Habit occurrence that a subtree copy could not carry: the occurrence is derived,
 * the copied Habit regenerates its own, and there is nothing for the row to hang on in the copy.
 * Titled so the paste can name it (`src-tauri/src/duplicate/mod.rs`).
 */
export interface LeftBehindChild {
  child_type: HabitChildKind;
  child_id: number;
  /** Its display title (an Info's body). */
  title: string;
}

/** What a subtree copy answers: the copy's root, and the occurrence children it left behind. */
export interface DuplicatedSubtree<T> {
  copy: T;
  left_behind: LeftBehindChild[];
}

const HABIT_CHILD_KINDS: readonly HabitChildKind[] = ["task", "goal", "commitment", "info", "expectation"];

function isLeftBehindChild(value: unknown): value is LeftBehindChild {
  if (typeof value !== "object" || value === null) return false;
  const childType: unknown = Reflect.get(value, "child_type");
  return HABIT_CHILD_KINDS.some((kind) => kind === childType)
    && typeof Reflect.get(value, "child_id") === "number"
    && typeof Reflect.get(value, "title") === "string";
}

/** What a copy a gesture made left behind: its answer's `left_behind`, or nothing. */
export function leftBehindOf(answer: unknown): LeftBehindChild[] {
  if (typeof answer !== "object" || answer === null) return [];
  const list: unknown = Reflect.get(answer, "left_behind");
  return Array.isArray(list) ? list.filter(isLeftBehindChild) : [];
}
