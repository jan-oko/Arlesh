/**
 * A stored-style row id for a test fixture: a version 7 UUID whose last group is `n`, so
 * `storedRowId(12)` is `00000000-0000-7000-8000-000000000012`. Deterministic and readable; never
 * version 8, which marks a derived row.
 */
export function storedRowId(n: number): string {
  return `00000000-0000-7000-8000-${String(n).padStart(12, "0")}`;
}

/**
 * A derived-style row id for a test fixture (a Habit occurrence, a wait's check task): a version 8
 * UUID whose last group is `n`, so `derivedRowId(3)` is `00000000-0000-8000-8000-000000000003`.
 */
export function derivedRowId(n: number): string {
  return `00000000-0000-8000-8000-${String(n).padStart(12, "0")}`;
}
