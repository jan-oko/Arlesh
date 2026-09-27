import { useEffect, useId, useRef, useState } from "react";

import type { UseScopePicker } from "@/hooks/use-scope-picker";
import { refSortKey, sameScopeRef, type ScopeRef } from "@/utils/scope-ref";
import { movedIndex, scopePickerAction, SCOPE_PICKER_OWNED_CODES } from "@/utils/hotkeys/scope-picker-keys";
import {
  ascendKind,
  browseAnchor,
  cellContainsDate,
  cellsForView,
  currentDateIso,
  descendKind,
  isCellCurrent,
  viewHeader,
  type ScopeCell,
  type ViewKind,
} from "@/utils/scope-calendar";
import styles from "./ScopePicker.module.css";

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
  /** The date the opening view is anchored on (ISO). Defaults to today. */
  initialAnchor?: string;
  /** The current instant, injectable for tests. Defaults to now. */
  now?: Date;
  /** Restricts selection to cells wholly within this inclusive date range. */
  constraint?: ScopeConstraint;
  /** Locks the view to `initialKind`: hides ascend and disables double-click descend. */
  lockKind?: boolean;
  /** Puts the keyboard in the grid as soon as the picker opens. */
  autoFocus?: boolean;
  /** `Ctrl+Enter`: commits the selection, where the caller has an Apply to run. */
  onCommit?: () => void;
}

/** Which cell of the view the keyboard highlight is on, and the view it is on. */
interface ViewState {
  kind: ViewKind;
  anchor: string;
  /** The highlighted cell, or `null` for the view's default (see `defaultIndex`). */
  active: number | null;
}

/** Where the highlight starts in a view: the selection, else the present, else the first cell. */
function defaultIndex(cells: readonly ScopeCell[], picker: UseScopePicker, now: Date): number {
  const selected = cells.findIndex((cell) => isSelected(picker, cell.ref));
  if (selected !== -1) return selected;
  const current = cells.findIndex((cell) => isCellCurrent(cell, now));
  return current === -1 ? 0 : current;
}

/**
 * A date-picker-style calendar for choosing a scope. Navigates season → month → week → day →
 * part-of-day (double-click a cell to descend, ↑ to ascend, ‹/› to browse). Clicking a cell
 * applies the active selection mode via `picker`. `lockKind` pins the view to a single kind, for
 * callers where only that kind is a valid selection (e.g. a Habit's Recurrence anchor).
 *
 * **The keyboard** (`SCOPE_PICKER_KEYS`) works while focus is in the picker: the arrows move a
 * highlight over the cells, Space picks the highlighted one as a click would, Enter steps into it
 * as a double-click would, `[` `]` browse and `\` ascends — the Plan View's scope keys — and
 * `Ctrl+Enter` commits where the caller passes `onCommit`. The grid holds the focus and names the
 * highlighted cell with `aria-activedescendant`, so a cell that the constraint disables can still
 * be walked over, and the highlight survives every change of view.
 */
export default function ScopePicker({
  picker,
  initialKind = "season",
  initialAnchor,
  now = new Date(),
  constraint,
  lockKind = false,
  autoFocus = false,
  onCommit,
}: ScopePickerProps) {
  const [view, setView] = useState<ViewState>({ kind: initialKind, anchor: initialAnchor ?? currentDateIso(now), active: null });
  const gridRef = useRef<HTMLDivElement>(null);
  const idPrefix = useId();
  const { kind: viewKind, anchor } = view;

  const cells = cellsForView(viewKind, anchor);
  const parentKind = lockKind ? null : ascendKind(viewKind);
  const childKind = lockKind ? null : descendKind(viewKind);
  const active = Math.min(view.active ?? defaultIndex(cells, picker, now), cells.length - 1);

  useEffect(() => {
    if (autoFocus) gridRef.current?.focus();
  }, [autoFocus]);

  function browse(dir: 1 | -1) {
    setView({ kind: viewKind, anchor: browseAnchor(viewKind, anchor, dir), active });
  }

  function ascend() {
    if (parentKind === null) return;
    // The highlight lands on the cell you came up out of.
    const parentCells = cellsForView(parentKind, anchor);
    const from = parentCells.findIndex((cell) => cellContainsDate(cell, anchor));
    setView({ kind: parentKind, anchor, active: from === -1 ? null : from });
  }

  function descend(cell: ScopeCell) {
    if (childKind === null) return;
    setView({ kind: childKind, anchor: cell.startDate, active: null });
  }

  function pick(cell: ScopeCell, index: number) {
    if (!withinConstraint(cell, constraint)) return;
    picker.handleClick(cell.ref);
    setView({ kind: viewKind, anchor, active: index });
  }

  function onKeyDown(event: React.KeyboardEvent) {
    const action = scopePickerAction(event.nativeEvent);
    if (action === null || action === "close") return;
    // The period keys work anywhere in the picker; the cell keys only on the grid, so Enter and
    // Space on the ‹ › ↑ buttons still press those buttons.
    const onGrid = event.target === gridRef.current;
    const cell = cells[active];
    switch (action) {
      case "previousPeriod": browse(-1); break;
      case "nextPeriod": browse(1); break;
      case "up": ascend(); break;
      case "apply":
        if (onCommit === undefined) return;
        onCommit();
        break;
      case "pick":
        if (!onGrid) return;
        if (cell !== undefined) pick(cell, active);
        break;
      case "enter":
        if (!onGrid) return;
        if (cell !== undefined) descend(cell);
        break;
      default:
        if (!onGrid) return;
        setView({ kind: viewKind, anchor, active: movedIndex(active, action, cells.length) });
    }
    event.preventDefault();
  }

  return (
    <div className={styles.picker} onKeyDown={onKeyDown} data-owns-keys={SCOPE_PICKER_OWNED_CODES}>
      <div className={styles.header}>
        {!lockKind && (
          <button
            type="button"
            className={styles.navButton}
            aria-label="up"
            disabled={parentKind === null}
            onClick={ascend}
          >
            ↑
          </button>
        )}
        <button
          type="button"
          className={styles.navButton}
          aria-label="previous"
          onClick={() => browse(-1)}
        >
          ‹
        </button>
        <span className={styles.headerLabel}>{viewHeader(viewKind, anchor)}</span>
        <button
          type="button"
          className={styles.navButton}
          aria-label="next"
          onClick={() => browse(1)}
        >
          ›
        </button>
      </div>
      <div
        ref={gridRef}
        className={styles.grid}
        tabIndex={0}
        role="group"
        aria-label={viewHeader(viewKind, anchor)}
        aria-activedescendant={`${idPrefix}-${active}`}
      >
        {cells.map((cell, index) => {
          const selected = isSelected(picker, cell.ref);
          const inRange = isInRange(picker, cell.ref);
          const isCurrent = isCellCurrent(cell, now);
          const allowed = withinConstraint(cell, constraint);
          const classes = [styles.cell, inRange ? styles.inRange : "", index === active ? styles.active : ""];
          return (
            <button
              key={cell.label + cell.startDate}
              id={`${idPrefix}-${index}`}
              type="button"
              tabIndex={-1}
              className={classes.filter((name) => name !== "").join(" ")}
              aria-pressed={selected}
              aria-current={isCurrent ? "date" : undefined}
              disabled={!allowed}
              onClick={() => { pick(cell, index); gridRef.current?.focus(); }}
              onDoubleClick={() => descend(cell)}
            >
              {cell.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
