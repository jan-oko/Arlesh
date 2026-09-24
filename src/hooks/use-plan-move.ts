import { useCallback } from "react";
import { useTranslation } from "react-i18next";
import { updateTask } from "@/api/tasks";
import { resolveScope } from "@/api/scopes";
import type { ScopeKey } from "@/api/scopes";
import { keyForRef } from "@/utils/scope-key";
import { getErrorMessage } from "@/api/errors";
import { withGesture } from "@/api/gesture";
import type { PendingToast } from "@/stores/use-mindmap-store";
import type { TaskListRow } from "@/utils/list-filter";
import type { ScopeInterval } from "@/utils/scope-interval";
import type { ScopeRef } from "@/utils/scope-ref";
import type { ScopeWindows } from "@/utils/plan-triage";
import { isHabitOccurrence, planRefusal } from "@/utils/plan-triage";

interface PlanMoveOptions {
  /** The scope being filled, once it is known. */
  targetScopeId: ScopeKey | null;
  /** That scope's window, once it is resolved. */
  targetWindow: ScopeInterval | null;
  /** The scope in words, for the refusal messages. */
  targetLabel: string;
  /** Every window the containment check reads. */
  windows: ScopeWindows;
  reload: () => Promise<void>;
  showToast: (toast: PendingToast) => void;
}

/**
 * Planning tasks into the scope — or into one of its subscopes — and taking them back out.
 *
 * Each call resolves to the node ids that **actually moved**, so the caller can advance its cursor
 * over what left the pane and leave it alone on a refusal: a selection that walked on from work
 * that did not move would be the view quietly disagreeing with the toast beside it.
 */
export interface PlanMoveHandles {
  /** Plans every row into the scope being filled. */
  planInto: (rows: readonly TaskListRow[]) => Promise<string[]>;
  /**
   * Plans every row into one **subscope** — a week of the month, a day of the week, a band of the
   * day. The cell's key is derived on the way in, so a bucket nobody has ever planned into needs
   * nothing to exist first.
   */
  planIntoSubscope: (rows: readonly TaskListRow[], ref: ScopeRef, label: string, partial: boolean) => Promise<string[]>;
  /** Clears every row's Plan. */
  unplan: (rows: readonly TaskListRow[]) => Promise<string[]>;
}

/** The two things this hook ever writes, as the names one `Ctrl+Z` will reverse. */
type PlanGestureKey = "undo:gestures.plan" | "undo:gestures.unplan";

/** What one batch did, so the view can say it in one sentence. */
interface BatchOutcome {
  moved: string[];
  /** Rows the containment rules turned away, with which bound turned each one away. */
  refused: Array<{ row: TaskListRow; bound: "ownTimeScope" | "parentPlan" }>;
  /** Rows the backend refused, which is a different thing from a rule this view could name. */
  failed: Array<{ row: TaskListRow; message: string }>;
  /** Rows that came out of the Backlog on the way in. */
  unbacklogged: TaskListRow[];
  /** Habit occurrences in the batch, which cannot be planned yet — set aside before anything else. */
  occurrences: TaskListRow[];
}

function emptyOutcome(): BatchOutcome {
  return { moved: [], refused: [], failed: [], unbacklogged: [], occurrences: [] };
}

/**
 * Splits a batch into the rows a Plan can be written to and the Habit **occurrences**, which have
 * no stored row to carry one until occurrences become rows of their own. They are taken out
 * *first*, before the containment check: an occurrence refused for its Time Scope would be told to
 * widen a window it has no editor for.
 */
function setAsideOccurrences(rows: readonly TaskListRow[]): { plannable: TaskListRow[]; occurrences: TaskListRow[] } {
  const plannable: TaskListRow[] = [];
  const occurrences: TaskListRow[] = [];
  for (const row of rows) {
    if (isHabitOccurrence(row.node)) occurrences.push(row); else plannable.push(row);
  }
  return { plannable, occurrences };
}

/**
 * The Plan View's one write: a task's Plan, set to a scope being filled or cleared.
 *
 * **A whole selection is one Gesture**, so planning five rows is one `Ctrl+Z`. It is a plain
 * {@link withGesture} rather than an atomic one deliberately: a batch that plans five of six has
 * done five things the user can see on the board, and taking them back because the sixth was
 * refused would undo work nobody asked to undo. An editor's Save is the opposite case and gets the
 * atomic one.
 *
 * **A containment failure refuses that row** rather than widening anything on the user's behalf.
 * `Plan ⊆ TimeScope` and `child.Plan ⊆ parent.Plan` both hold as written, and a task whose own
 * window is too narrow for the scope is a task whose window needs an editing decision — which is
 * the editor's job, not a triage gesture's. The refusal is raised here, before the write, so the
 * toast can name *which* bound stopped it; the backend checks the same two rules on the way in, so
 * a refusal this view somehow lets through is still refused, just less precisely.
 *
 * **Nothing is dropped in silence.** Every row that does not end up where it was sent is counted in
 * a toast — the refusals, the backend's own failures, a Backlog a plan took a task out of, and a
 * straddling subscope that carried its rows outside the scope you are filling and so off the pane.
 */
export function usePlanMove({
  targetScopeId, targetWindow, targetLabel, windows, reload, showToast,
}: PlanMoveOptions): PlanMoveHandles {
  const { t } = useTranslation(["planView", "undo"]);

  /**
   * The one thing a batch most needs to say, or `null` when it went exactly as asked.
   *
   * There is one toast slot, and four things a batch can have to say. They are ranked by how much
   * they change what you should do next: a backend failure is a bug or a lock, a refusal is work
   * that needs an editing decision, work that left the pane is work you would otherwise go looking
   * for, and a de-backlogged task is a fact about something that *did* happen.
   */
  const headline = useCallback(
    (outcome: BatchOutcome, label: string, leftPane: boolean): { nodeId: string; message: string } | null => {
      const first = outcome.failed[0];
      if (first !== undefined) {
        return { nodeId: first.row.node.id, message: t("planView:moveFailed", { title: first.row.node.title, message: first.message }) };
      }
      const refused = outcome.refused;
      const only = refused.length === 1 ? refused[0] : undefined;
      if (only !== undefined) {
        const key = only.bound === "ownTimeScope" ? "planView:refusedTimeScope" : "planView:refusedParentPlan";
        return { nodeId: only.row.node.id, message: t(key, { title: only.row.node.title, scope: label }) };
      }
      const head = refused[0];
      if (head !== undefined) {
        return {
          nodeId: head.row.node.id,
          message: t("planView:refusedSome", { count: refused.length, total: refused.length + outcome.moved.length, scope: label }),
        };
      }
      const movedFirst = outcome.moved[0];
      if (leftPane && movedFirst !== undefined) {
        return { nodeId: movedFirst, message: t("planView:plannedOutside", { scope: label }) };
      }
      const one = outcome.unbacklogged.length === 1 ? outcome.unbacklogged[0] : undefined;
      if (one !== undefined) {
        return { nodeId: one.node.id, message: t("planView:unbacklogged", { title: one.node.title, scope: label }) };
      }
      const many = outcome.unbacklogged[0];
      if (many !== undefined) {
        return { nodeId: many.node.id, message: t("planView:unbackloggedMany", { count: outcome.unbacklogged.length, scope: label }) };
      }
      return null;
    },
    [t],
  );

  /**
   * One toast for one batch: its headline, and — whatever the headline is — a sentence for any
   * Habit occurrence that was set aside. That sentence is never ranked away: an occurrence that did
   * not move with the rest would otherwise have been dropped in silence.
   */
  const report = useCallback(
    (outcome: BatchOutcome, label: string, leftPane: boolean): void => {
      const lead = headline(outcome, label, leftPane);
      const occurrence = outcome.occurrences[0];
      if (occurrence === undefined) {
        if (lead !== null) showToast(lead);
        return;
      }
      const note = outcome.occurrences.length === 1
        ? t("planView:occurrenceNotYet", { title: occurrence.node.title })
        : t("planView:occurrencesNotYet", { count: outcome.occurrences.length });
      showToast(lead === null
        ? { nodeId: occurrence.node.id, message: note }
        : { nodeId: lead.nodeId, message: `${lead.message} ${note}` });
    },
    [headline, showToast, t],
  );

  /** Writes one plan value across a batch, inside a single Gesture. */
  const write = useCallback(
    async (rows: readonly TaskListRow[], plan: { start_id: ScopeKey; end_id: ScopeKey } | null, gesture: PlanGestureKey): Promise<BatchOutcome> => {
      const outcome = emptyOutcome();
      if (rows.length === 0) return outcome;
      await withGesture(t(gesture, { count: rows.length }), async () => {
        for (const row of rows) {
          const id = row.node.rowId;
          if (id === undefined) continue;
          try {
            await updateTask(id, { plan });
          } catch (error: unknown) {
            outcome.failed.push({ row, message: getErrorMessage(error) });
            continue;
          }
          outcome.moved.push(row.node.id);
          if (plan !== null && row.node.backlogged === true) outcome.unbacklogged.push(row);
        }
      });
      if (outcome.moved.length > 0) await reload();
      return outcome;
    },
    [reload, t],
  );

  /** Splits a batch on the two containment rules, then writes the half that passed. */
  const planIntoWindow = useCallback(
    async (rows: readonly TaskListRow[], scopeId: ScopeKey, window: ScopeInterval, label: string, leftPane: boolean): Promise<string[]> => {
      const { plannable, occurrences } = setAsideOccurrences(rows);
      const allowed: TaskListRow[] = [];
      const refused: BatchOutcome["refused"] = [];
      for (const row of plannable) {
        const bound = planRefusal(row, window, windows);
        if (bound === null) allowed.push(row); else refused.push({ row, bound });
      }
      const outcome = await write(allowed, { start_id: scopeId, end_id: scopeId }, "undo:gestures.plan");
      outcome.refused.push(...refused);
      outcome.occurrences.push(...occurrences);
      report(outcome, label, leftPane);
      return outcome.moved;
    },
    [windows, write, report],
  );

  const planInto = useCallback(
    async (rows: readonly TaskListRow[]): Promise<string[]> => {
      if (targetScopeId === null || targetWindow === null) return [];
      return planIntoWindow(rows, targetScopeId, targetWindow, targetLabel, false);
    },
    [targetScopeId, targetWindow, targetLabel, planIntoWindow],
  );

  const planIntoSubscope = useCallback(
    async (rows: readonly TaskListRow[], ref: ScopeRef, label: string, partial: boolean): Promise<string[]> => {
      if (rows.length === 0) return [];
      // A batch of occurrences alone has nothing to write, so it is not worth a cell — and a cell
      // that could not be read would otherwise say so instead of the thing worth saying.
      const { plannable, occurrences } = setAsideOccurrences(rows);
      if (plannable.length === 0) {
        report({ ...emptyOutcome(), occurrences }, label, false);
        return [];
      }
      let cell: { id: ScopeKey; window: ScopeInterval };
      try {
        const id = keyForRef(ref);
        const resolved = await resolveScope(id);
        cell = { id, window: { start: resolved.start, end: resolved.end } };
      } catch (error: unknown) {
        const head = rows[0];
        if (head !== undefined) {
          showToast({ nodeId: head.node.id, message: t("planView:moveFailed", { title: head.node.title, message: getErrorMessage(error) }) });
        }
        return [];
      }
      // A straddling bucket reaches outside the scope being filled, so what lands in it is no
      // longer *in* this scope and leaves the pane. That is the triage's own rule, and the toast is
      // what keeps it from looking like the move failed.
      return planIntoWindow(rows, cell.id, cell.window, label, partial);
    },
    [planIntoWindow, report, showToast, t],
  );

  const unplan = useCallback(
    async (rows: readonly TaskListRow[]): Promise<string[]> => {
      const { plannable, occurrences } = setAsideOccurrences(rows);
      const outcome = await write(plannable, null, "undo:gestures.unplan");
      outcome.occurrences.push(...occurrences);
      report(outcome, targetLabel, false);
      return outcome.moved;
    },
    [write, report, targetLabel],
  );

  return { planInto, planIntoSubscope, unplan };
}
