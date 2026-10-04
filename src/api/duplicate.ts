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
