import { useState } from "react";
import { useTranslation } from "react-i18next";
import Select from "@/components/Select/Select";
import Switch from "@/components/Switch/Switch";
import ScopePicker from "@/components/ScopePicker/ScopePicker";
import type { UseScopePicker } from "@/hooks/use-scope-picker";
import type { ViewKind } from "@/utils/scope-calendar";
import type { ScopeRef } from "@/utils/scope-ref";
import type { PlanScopeCursor } from "@/utils/plan-scope";
import { PLAN_SCOPE_KINDS, cursorRef, isPlanScopeKind, upRefusalKey } from "@/utils/plan-scope";
import type { UpRefusal } from "@/utils/plan-scope";
import styles from "./PlanScopeBar.module.css";

const UP = "↑";
const PREVIOUS = "‹";
const NEXT = "›";

interface Props {
  cursor: PlanScopeCursor;
  /** The scope in words, or an empty string while it is still being materialized. */
  label: string;
  showBacklogged: boolean;
  onSetKind: (kind: ViewKind) => void;
  onStep: (direction: 1 | -1) => void;
  onJumpTo: (ref: ScopeRef) => void;
  /** The kind one rung up, or `null` where there is none — a Season — or it is not known yet. */
  parentKind: ViewKind | null;
  /** Why Up is unavailable, or `null` when it is available — what the disabled button says. */
  upRefusal: UpRefusal | null;
  onUp: () => void;
  onToggleBacklogged: () => void;
}

/**
 * The header of a planning pass: which kind of scope is being filled, which one, the two steps
 * either side of it, and whether work that was set aside is on the table.
 *
 * The jump picker is the app's own Scope Picker, **locked to the kind being filled**: the kind is
 * the selector's question, and descending into a week from the month view would answer it a second
 * way, leaving the selector beside it saying something else. It also holds no selection state of
 * its own — the scope being filled *is* the selection, so the picker is handed the cursor and its
 * clicks go straight back out as a jump.
 */
export default function PlanScopeBar({
  cursor, label, showBacklogged, onSetKind, onStep, onJumpTo, parentKind, upRefusal, onUp, onToggleBacklogged,
}: Props) {
  const { t } = useTranslation("planView");
  const [pickerOpen, setPickerOpen] = useState(false);

  function selectKind(value: string): void {
    if (isPlanScopeKind(value)) onSetKind(value);
  }

  const picker: UseScopePicker = {
    mode: "single",
    single: cursorRef(cursor),
    range: { start: null, end: null },
    handleClick: (ref) => { onJumpTo(ref); setPickerOpen(false); },
    adjustEndpoint: () => {},
    reset: () => {},
    seed: () => {},
    resolve: () => Promise.resolve(null),
  };

  const upTitle = upRefusal === null && parentKind !== null
    ? t("upScopeTo", { kind: t(`kind.${parentKind}`) })
    : t(upRefusalKey(upRefusal ?? "resolving"));

  return (
    <header className={styles.bar}>
      <Select
        value={cursor.kind}
        options={PLAN_SCOPE_KINDS.map((value) => ({ value, label: t(`kind.${value}`) }))}
        onChange={selectKind}
        ariaLabel={t("scopeKind")}
      />

      <div className={styles.stepper}>
        {/* The title sits on a wrapper: a disabled button receives no pointer events, and the
            reason it is disabled is exactly what the hover has to say. */}
        <span title={upTitle}>
          <button
            type="button"
            className={styles.step}
            aria-label={t("upScope")}
            disabled={upRefusal !== null}
            onClick={onUp}
          >
            {UP}
          </button>
        </span>
        <button type="button" className={styles.step} aria-label={t("previousScope")} onClick={() => onStep(-1)}>
          {PREVIOUS}
        </button>
        <div className={styles.anchor}>
          <button
            type="button"
            className={styles.scope}
            title={t("jumpToScope")}
            onClick={() => setPickerOpen((open) => !open)}
          >
            {label === "" ? t("resolvingScope") : label}
          </button>
          {pickerOpen && (
            <>
              <div className={styles.backdrop} onClick={() => setPickerOpen(false)} />
              <div className={styles.picker}>
                {/* `initialAnchor`, not `now`: the picker opens on the scope the bar is showing,
                    while "which cell is current" stays the real instant. They were one prop until
                    the picker learned to mark the current part of day, and conflating them here
                    would have marked a browsed-to week as the current one. */}
                <ScopePicker picker={picker} initialKind={cursor.kind} initialAnchor={cursor.date} lockKind />
              </div>
            </>
          )}
        </div>
        <button type="button" className={styles.step} aria-label={t("nextScope")} onClick={() => onStep(1)}>
          {NEXT}
        </button>
      </div>

      {/* Backlog means "deliberately not now", and a planning pass is also when you reconsider
          that — so the work is off the table by default and one switch away from being on it. */}
      <Switch checked={showBacklogged} onChange={onToggleBacklogged} label={t("showBacklogged")} />
    </header>
  );
}
