import { useCallback, useEffect, useMemo, useState } from "react";
import { getOrCreateForRef } from "@/api/scopes";
import type { Scope } from "@/api/scopes";
import { getErrorMessage } from "@/api/errors";
import { useScopeLabels } from "@/hooks/use-scope-labels";
import { useViewStore } from "@/stores/use-view-store";
import { formatScope } from "@/utils/scope-format";
import type { ViewKind } from "@/utils/scope-calendar";
import type { ScopeRef } from "@/utils/scope-ref";
import type { PlanScopeCursor } from "@/utils/plan-scope";
import { cursorAtNow, cursorForKind, cursorFromRef, cursorRef, parentRefs, stepCursor } from "@/utils/plan-scope";
import type { UpRefusal } from "@/utils/plan-scope";

/** The scope a Plan pass is filling, and the ways to move to another one. */
export interface PlanScopeHandles {
  /** Where the pass is standing on the calendar. */
  cursor: PlanScopeCursor;
  /** The materialized scope row, once it exists; `null` while it is being created or resolved. */
  scope: Scope | null;
  /** The scope in words, for the header. */
  label: string;
  /** Why the scope could not be materialized, if it could not. */
  error: string | null;
  /** Fills a different kind of scope: the one holding this one, or the one holding now inside it. */
  setKind: (kind: ViewKind) => void;
  /** Walks one whole scope later (`1`) or earlier (`-1`). */
  step: (direction: 1 | -1) => void;
  /** Jumps to a cell picked in the calendar. A cell no pass can fill is ignored. */
  jumpTo: (ref: ScopeRef) => void;
  /**
   * The kind one rung up, which is what `goUp` would fill; `null` where there is no rung up (a
   * Season) or while the scope is still being materialized.
   */
  parentKind: ViewKind | null;
  /** Why there is no Up right now, or `null` when there is one. The button and the key both say it. */
  upRefusal: UpRefusal | null;
  /** Fills the parent scope instead. Does nothing where `upRefusal` is set. */
  goUp: () => void;
}

function todayIso(now: Date): string {
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/** Materializes a cursor's cell, creating the scope row on demand — the same get-or-create the
 * Scope Picker resolves a selection through, and the same one a drop into a subscope goes through. */
async function materialize(cursor: PlanScopeCursor): Promise<Scope> {
  return getOrCreateForRef(cursorRef(cursor));
}

/**
 * Owns the scope a Plan pass is filling.
 *
 * The **kind** is the tab's, and persists with it; the **place** is working state and is not
 * written down. A pass therefore opens on the current scope of the kind you last filled — the week
 * you were filling on Friday is not the week you want on Monday, and restoring it would put you
 * to work on the past without saying so.
 *
 * Stepping walks from the materialized scope's own `start_date` rather than from wherever the
 * cursor happened to be inside it, so a month stepped from the 31st lands on the next month rather
 * than on whatever a naive month-addition overflows to.
 */
export function usePlanScope(now: Date = new Date()): PlanScopeHandles {
  const kind = useViewStore((s) => s.planScopeKind);
  const setPlanScopeKind = useViewStore((s) => s.setPlanScopeKind);
  const labels = useScopeLabels();
  const [cursor, setCursor] = useState<PlanScopeCursor>(() =>
    cursorAtNow(kind, todayIso(now), now.getHours()),
  );
  // The answer is stored **with the cursor it answers**, rather than being cleared when the cursor
  // moves: clearing it would be a setState in an effect body, and a stale answer left on screen for
  // one frame would label the new scope with the old scope's name. Comparing by reference works
  // because every cursor move makes a new object, and the seed one never changes.
  const [answer, setAnswer] = useState<{ cursor: PlanScopeCursor; scope: Scope | null; error: string | null } | null>(null);

  useEffect(() => {
    let active = true;
    void materialize(cursor).then(
      (resolved) => {
        if (active) setAnswer({ cursor, scope: resolved, error: null });
      },
      (failure: unknown) => {
        if (active) setAnswer({ cursor, scope: null, error: getErrorMessage(failure) });
      },
    );
    return () => {
      active = false;
    };
  }, [cursor]);

  const current = answer !== null && answer.cursor === cursor ? answer : null;
  const scope = current?.scope ?? null;
  const error = current?.error ?? null;

  // Lands on the scope of the new kind that holds this one, or the one holding now inside it — see
  // `cursorForKind`. The selector and the letter keys both come through here, so they cannot land
  // in two different places.
  const nowIso = todayIso(now);
  const nowHour = now.getHours();
  const setKind = useCallback(
    (next: ViewKind) => {
      setPlanScopeKind(next);
      setCursor((current) => cursorForKind(current, scope, next, cursorAtNow(next, nowIso, nowHour)));
    },
    [setPlanScopeKind, scope, nowIso, nowHour],
  );

  const anchorDate = scope?.start_date;
  const step = useCallback(
    (direction: 1 | -1) => {
      setCursor((current) => stepCursor({ ...current, date: anchorDate ?? current.date }, direction));
    },
    [anchorDate],
  );

  const jumpTo = useCallback((ref: ScopeRef) => {
    setCursor((current) => cursorFromRef(ref, current.part) ?? current);
  }, []);

  // Up goes to the parent `parentRefs` names — for a week at a month's edge, the month holding its
  // first day. The candidates pane reads the same parent, so Up and "planned to the parent" agree.
  const up = useMemo(() => {
    const parent = scope === null ? undefined : parentRefs(scope)[0];
    return parent === undefined ? null : cursorFromRef(parent, cursor.part);
  }, [scope, cursor.part]);
  const goUp = useCallback(() => {
    if (up === null) return;
    // The kind changes, and the kind is the tab's — the selector beside the stepper reads it, so
    // going up has to say so there exactly as choosing the kind would.
    setPlanScopeKind(up.kind);
    setCursor(up);
  }, [up, setPlanScopeKind]);

  // The scope's window is deliberately **not** derived here. `resolve_scope` is the authority on
  // what a scope spans, and `useScopeWindows` is what asks it — for this scope alongside every
  // task's, through one cache, so the target and the windows it is compared against can never be
  // resolved two different ways.
  return {
    cursor,
    scope,
    label: scope === null ? "" : formatScope(scope, labels),
    error,
    setKind,
    step,
    jumpTo,
    parentKind: up?.kind ?? null,
    upRefusal: up !== null ? null : scope === null ? "resolving" : "top",
    goUp,
  };
}
