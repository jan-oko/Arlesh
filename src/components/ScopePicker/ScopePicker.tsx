import { useState } from "react";

import type { UseScopePicker } from "@/hooks/use-scope-picker";
import { refSortKey, sameScopeRef, type ScopeRef } from "@/utils/scope-ref";
import {
  ascendKind,
  browseAnchor,
  cellContainsDate,
  cellsForView,
  descendKind,
  viewHeader,
  type ScopeCell,
  type ViewKind,
} from "@/utils/scope-calendar";
import styles from "./ScopePicker.module.css";

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function isSelected(picker: UseScopePicker, ref: ScopeRef): boolean {
  if (picker.mode === "single") {
    return picker.single !== null && sameScopeRef(picker.single, ref);
  }
  const { start, end } = picker.range;
  return (
    (start !== null && sameScopeRef(start, ref)) || (end !== null && sameScopeRef(end, ref))
  );
}

/** Whether a cell falls between the range endpoints (same kind), for highlighting the span. */
function isInRange(picker: UseScopePicker, ref: ScopeRef): boolean {
  if (picker.mode !== "range") return false;
  const { start, end } = picker.range;
  if (start === null || end === null || ref.kind !== start.kind) return false;
  const key = refSortKey(ref);
  return refSortKey(start) <= key && key <= refSortKey(end);
}

/** An inclusive date range that constrains which cells may be selected (e.g. a Plan's Time Scope). */
export interface ScopeConstraint {
  startDate: string;
  endDate: string;
}

function withinConstraint(cell: ScopeCell, constraint: ScopeConstraint | undefined): boolean {
  if (constraint === undefined) return true;
  return cell.startDate >= constraint.startDate && cell.endDate <= constraint.endDate;
}

interface ScopePickerProps {
  /** The selection state machine (from `useScopePicker`). */
  picker: UseScopePicker;
  /** The view to open at. Defaults to the coarsest (season). */
  initialKind?: ViewKind;
  /** Current date (ISO), injectable for tests. Defaults to today. */
  today?: string;
  /** Restricts selection to cells wholly within this inclusive date range. */
  constraint?: ScopeConstraint;
}

/**
 * A date-picker-style calendar for choosing a scope. Navigates season → month → week → day →
 * part-of-day (double-click a cell to descend, ↑ to ascend, ‹/› to browse). Clicking a cell
 * applies the active selection mode via `picker`.
 */
export default function ScopePicker({
  picker,
  initialKind = "season",
  today,
  constraint,
}: ScopePickerProps) {
  const [viewKind, setViewKind] = useState<ViewKind>(initialKind);
  const [anchor, setAnchor] = useState<string>(today ?? todayIso());
  const now = today ?? todayIso();

  const cells = cellsForView(viewKind, anchor);
  const parentKind = ascendKind(viewKind);
  const childKind = descendKind(viewKind);

  function onCellDoubleClick(cell: ScopeCell) {
    if (childKind === null) return;
    setViewKind(childKind);
    setAnchor(cell.startDate);
  }

  return (
    <div className={styles.picker}>
      <div className={styles.header}>
        <button
          type="button"
          className={styles.navButton}
          aria-label="up"
          disabled={parentKind === null}
          onClick={() => parentKind !== null && setViewKind(parentKind)}
        >
          ↑
        </button>
        <button
          type="button"
          className={styles.navButton}
          aria-label="previous"
          onClick={() => setAnchor(browseAnchor(viewKind, anchor, -1))}
        >
          ‹
        </button>
        <span className={styles.headerLabel}>{viewHeader(viewKind, anchor)}</span>
        <button
          type="button"
          className={styles.navButton}
          aria-label="next"
          onClick={() => setAnchor(browseAnchor(viewKind, anchor, 1))}
        >
          ›
        </button>
      </div>
      <div className={styles.grid}>
        {cells.map((cell) => {
          const selected = isSelected(picker, cell.ref);
          const inRange = isInRange(picker, cell.ref);
          const isToday = cellContainsDate(cell, now);
          const allowed = withinConstraint(cell, constraint);
          return (
            <button
              key={cell.label + cell.startDate}
              type="button"
              className={`${styles.cell}${inRange ? ` ${styles.inRange}` : ""}`}
              aria-pressed={selected}
              aria-current={isToday ? "date" : undefined}
              disabled={!allowed}
              onClick={() => picker.handleClick(cell.ref)}
              onDoubleClick={() => onCellDoubleClick(cell)}
            >
              {cell.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
