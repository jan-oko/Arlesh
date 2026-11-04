import { useCallback } from "react";
import { useTranslation } from "react-i18next";
import { usePendingWrite } from "@/hooks/use-pending-write";
import { useReadOnlyNotice } from "@/hooks/use-read-only-notice";
import { usePlanClampStore } from "@/stores/use-plan-clamp-store";
import { planContainmentConflicts } from "@/api/tasks";
import type { DescendantPlans, PlanClampTarget } from "@/api/tasks";
import { writtenWith } from "@/utils/answer-fields";
import type { ScopeKey } from "@/api/scopes";
import { keyForRef } from "@/utils/scope-key";
import { getErrorMessage } from "@/api/errors";
import { withAtomicGesture } from "@/api/gesture";
import { isRefusedStep, runGesture } from "@/api/multi-node-gestures";
import type { GestureStep } from "@/api/multi-node-gestures";
import type { PendingToast } from "@/stores/use-mindmap-store";
import type { TaskListRow } from "@/utils/list-filter";
import type { ScopeInterval } from "@/utils/scope-interval";
import type { ScopeRef } from "@/utils/scope-ref";
import { planRefusal } from "@/utils/plan-triage";
import type { TakeOutTarget } from "@/utils/plan-take-out";

/** A scope work can be planned to: its key, its window once resolved, and its name for the toasts. */
export interface PlanDestination {
  id: ScopeKey;
  window: ScopeInterval | null;
  label: string;
}

interface PlanMoveOptions {
  /** The scope being filled, once it is known. */
  targetScopeId: ScopeKey | null;
  /** That scope's window, once it is resolved. */
  targetWindow: ScopeInterval | null;
  /** The scope in words, for the refusal messages. */
  targetLabel: string;
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
  /**
   * Takes every row back out of the scope: plans it to `target`'s scope — the one whose work the
   * candidates side shows — or clears its Plan where there is none (see `takeOutTarget`). The
   * containment rules hold for the new scope exactly as for planning into one.
   */
  takeOut: (rows: readonly TaskListRow[], target: TakeOutTarget<PlanDestination>) => Promise<string[]>;
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
}

function emptyOutcome(): BatchOutcome {
  return { moved: [], refused: [], failed: [], unbacklogged: [] };
}

/**
 * The Plan View's one write: a task's Plan, set to a scope — the one being filled, one of its parts,
 * or the rung a take-out sends it back to — or cleared.
 *
 * **It is shown at once** (ADR 0012, decision 17): each row's own Plan is patched through the
 * window's lane, so the row appears in its new pane with the pending cue before the write is
 * answered, and a refusal puts it back with one toast.
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
  targetScopeId, targetWindow, targetLabel, showToast,
}: PlanMoveOptions): PlanMoveHandles {
  const { t } = useTranslation(["planView", "undo"]);
  const askPlanClamp = usePlanClampStore((state) => state.ask);
  const enqueue = usePendingWrite({ showToast });
  const readOnlyNotice = useReadOnlyNotice();

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

  /** One toast for one batch: its headline, when it has one. */
  const report = useCallback(
    (outcome: BatchOutcome, label: string, leftPane: boolean): void => {
      const lead = headline(outcome, label, leftPane);
      if (lead !== null) showToast(lead);
    },
    [headline, showToast],
  );

  /**
   * Puts one plan value for a batch in the window's lane, one write per row (ADR 0012, decision 17).
   *
   * Each row shows in its new pane at once, with the cue, by patching only its own `plan`: which
   * pane a row sits in is `effectivePlan`'s call, pinned by `plan-triage.json`, so nothing is copied.
   * The batch is still **one gesture**: the first write to go out runs it, the rest read their own
   * step's answer from the same run, so five rows are one request and one `Ctrl+Z`. A step the
   * backend refuses rolls back that row alone, with one toast.
   *
   * The clamp prompt cannot be asked before the patch without a read in front of it, so the
   * containment read runs in the write's closure. When it finds Tasks below that would be left
   * outside, the batch is held (decision 7: rolled back without a toast), the prompt opens, and on
   * its answer the same batch goes in again, acknowledged.
   *
   * Returns the ids of the rows that were put in the lane: what the view's cursor walks on from.
   */
  const write = useCallback(
    (
      rows: readonly TaskListRow[], plan: { start_id: ScopeKey; end_id: ScopeKey } | null, gesture: PlanGestureKey,
      refused: BatchOutcome["refused"], label: string, leftPane: boolean,
    ): string[] => {
      const planned = rows.flatMap((row) => (row.node.rowId === undefined ? [] : [{ row, id: row.node.rowId }]));
      if (planned.length === 0) {
        report({ ...emptyOutcome(), refused }, label, leftPane);
        return [];
      }

      const attempt = (settle: DescendantPlans | null): void => {
        let run: Promise<unknown[]> | null = null;
        let held: PlanClampTarget[] = [];
        let asked = false;

        /** The batch's one gesture, started by whichever of its writes goes out first. */
        const gestureOnce = (): Promise<unknown[]> => {
          run ??= (async () => {
            if (settle === null && plan !== null) {
              const found = await Promise.all(planned.map(({ id }) => planContainmentConflicts(id, plan)));
              held = found.flat();
              if (held.length > 0) throw Object.assign(new Error("Plans below would be left outside"), { kind: "needs_confirmation" });
            }
            const steps: GestureStep[] = planned.map(({ id }) => ({
              op: "update_task", id, request: { plan },
              ...(settle === null ? {} : { descendant_plans: settle }),
              may_be_refused: true,
            }));
            // Not `withGesture`: it waits for the lane to empty, and this runs from inside it. Nothing is
            // lost by the atomic one: the steps are `may_be_refused`, so a refusal still does not abort.
            const answers = await withAtomicGesture(t(gesture, { count: rows.length }), () => runGesture("plan-move", steps));
            // What the backend refused is rolled back and toasted by the lane, one row at a time.
            const outcome: BatchOutcome = { ...emptyOutcome(), refused };
            planned.forEach(({ row }, index) => {
              if (isRefusedStep(answers[index])) return;
              outcome.moved.push(row.node.id);
              if (plan !== null && row.node.backlogged === true) outcome.unbacklogged.push(row);
            });
            report(outcome, label, leftPane);
            return answers;
          })();
          return run;
        };

        const onConfirmation = (): void => {
          if (asked) return;
          asked = true;
          void askPlanClamp(held).then((choice) => { if (choice !== null) attempt(choice); });
        };

        planned.forEach(({ row }, index) => {
          const nodeId = row.node.id;
          enqueue({
            nodeId,
            label: "plan",
            patch: { kind: "fields", fields: { plan } },
            refuseReadOnly: () => {
              showToast({ nodeId, message: t("planView:moveFailed", { title: row.node.title, message: readOnlyNotice() }) });
            },
            refusalToast: (message) => t("planView:moveFailed", { title: row.node.title, message }),
            onConfirmation,
            send: async () => {
              const answer = (await gestureOnce())[index];
              if (isRefusedStep(answer)) return { outcome: "refused", message: answer.refused.message };
              return writtenWith({ plan });
            },
          });
        });
      };

      attempt(null);
      return planned.map(({ row }) => row.node.id);
    },
    [askPlanClamp, enqueue, readOnlyNotice, report, showToast, t],
  );

  /** Splits a batch on the two containment rules, then writes the half that passed. */
  const planIntoWindow = useCallback(
    async (
      rows: readonly TaskListRow[], scopeId: ScopeKey, label: string, leftPane: boolean,
      gesture: PlanGestureKey = "undo:gestures.plan",
    ): Promise<string[]> => {
      // A Habit occurrence is a row (ADR 0008) and is planned like any Task: into its overlay,
      // within its iteration's window, which the containment check below holds it to.
      const allowed: TaskListRow[] = [];
      const refused: BatchOutcome["refused"] = [];
      for (const row of rows) {
        const bound = planRefusal(row, scopeId);
        if (bound === null) allowed.push(row); else refused.push({ row, bound });
      }
      return write(allowed, { start_id: scopeId, end_id: scopeId }, gesture, refused, label, leftPane);
    },
    [write],
  );

  const planInto = useCallback(
    async (rows: readonly TaskListRow[]): Promise<string[]> => {
      if (targetScopeId === null || targetWindow === null) return [];
      return planIntoWindow(rows, targetScopeId, targetLabel, false);
    },
    [targetScopeId, targetWindow, targetLabel, planIntoWindow],
  );

  const planIntoSubscope = useCallback(
    async (rows: readonly TaskListRow[], ref: ScopeRef, label: string, partial: boolean): Promise<string[]> => {
      if (rows.length === 0) return [];
      let cell: { id: ScopeKey };
      try {
        const id = keyForRef(ref);
        cell = { id };
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
      return planIntoWindow(rows, cell.id, label, partial);
    },
    [planIntoWindow, showToast, t],
  );

  const takeOut = useCallback(
    async (rows: readonly TaskListRow[], target: TakeOutTarget<PlanDestination>): Promise<string[]> => {
      if (target.kind === "clear") {
        return write(rows, null, "undo:gestures.unplan", [], targetLabel, false);
      }
      // A Habit occurrence taken out to its own Cycle Plan's scope has its override cleared by the
      // backend, which compares the Plan written with the one its template gives it.
      const { id, window, label } = target.scope;
      if (window === null) return [];
      return planIntoWindow(rows, id, label, false, "undo:gestures.unplan");
    },
    [write, targetLabel, planIntoWindow],
  );

  return { planInto, planIntoSubscope, takeOut };
}
