import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { TypedChildKind } from "@/utils/node-meta";
import { formatChord } from "@/utils/hotkeys/chord";
import { STEPS_TYPED_CHILD_CHORDS } from "@/utils/hotkeys/steps/create";
import { useInputCapture } from "@/hooks/use-input-capture";
import styles from "./StepCreateMenu.module.css";

interface Props {
  /** The kinds the Step's node can hold — only these are offered. */
  kinds: readonly TypedChildKind[];
  /** Creates one, exactly as its `Shift`+initial chord would with nothing selected. */
  onCreate: (kind: TypedChildKind) => void;
}

/** The chord that creates `kind`, as the cheat sheet writes it. */
function chordFor(kind: TypedChildKind): string {
  const entry = STEPS_TYPED_CHILD_CHORDS.find((candidate) => candidate.kind === kind);
  return entry === undefined ? "" : formatChord({ code: entry.code, shift: true });
}

/**
 * **The Step's visible "+".** A button beside the header card that opens a short menu of the kinds
 * this Step's node can hold, each with its `Shift`+initial chord beside it — so the menu teaches the
 * keys while it stands in for them. Choosing one goes through the same create as the chord, so the
 * new card is selected with its title open, and the view pages to it.
 *
 * A menu rather than one fixed kind: a Step can be a Domain, a Goal or a Tag, and they hold different
 * things. The List View's `+` creates a Task and nothing else, because a list row is only ever one.
 *
 * While open it holds the keyboard, as the app's other dropdowns do, so its arrows never walk the
 * cards behind it.
 */
export default function StepCreateMenu({ kinds, onCreate }: Props) {
  const { t } = useTranslation(["stepsView", "nodeKinds"]);
  const [open, setOpen] = useState(false);
  const [highlighted, setHighlighted] = useState(0);
  const triggerRef = useRef<HTMLButtonElement>(null);
  useInputCapture(open);

  function close(): void {
    setOpen(false);
    triggerRef.current?.focus();
  }

  function choose(kind: TypedChildKind): void {
    setOpen(false);
    onCreate(kind);
  }

  useEffect(() => {
    if (!open) return;
    function handleKeyDown(event: KeyboardEvent): void {
      if (event.key === "Escape") { event.preventDefault(); close(); return; }
      if (event.key === "ArrowDown") { event.preventDefault(); setHighlighted((i) => Math.min(i + 1, kinds.length - 1)); return; }
      if (event.key === "ArrowUp") { event.preventDefault(); setHighlighted((i) => Math.max(i - 1, 0)); return; }
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        const kind = kinds[highlighted];
        if (kind !== undefined) choose(kind);
      }
    }
    window.addEventListener("keydown", handleKeyDown, { capture: true });
    return () => window.removeEventListener("keydown", handleKeyDown, { capture: true });
  });

  if (kinds.length === 0) return null;

  return (
    <div className={styles.wrap}>
      <button
        ref={triggerRef}
        type="button"
        className={styles.trigger}
        aria-label={t("stepsView:addToStep")}
        title={t("stepsView:addToStep")}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => { setHighlighted(0); setOpen((wasOpen) => !wasOpen); }}
      >
        {"+"}
      </button>
      {open && (
        <>
          <div className={styles.backdrop} onClick={() => setOpen(false)} />
          <div className={styles.menu} role="menu" aria-label={t("stepsView:addToStep")}>
            {kinds.map((kind, index) => (
              <button
                key={kind}
                type="button"
                role="menuitem"
                className={`${styles.item}${index === highlighted ? ` ${styles.itemHighlighted}` : ""}`}
                onMouseEnter={() => setHighlighted(index)}
                onClick={() => choose(kind)}
              >
                <span>{t(`nodeKinds:${kind}`)}</span>
                <kbd className={styles.chord}>{chordFor(kind)}</kbd>
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
