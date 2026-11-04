import { useEffect, useRef } from "react";
import type { KeyboardEvent } from "react";
import { useTranslation } from "react-i18next";
import { tileColumns } from "@/utils/plan-tiles";
import styles from "./PlanView.module.css";

/** One tile: a subscope bucket of the split planned pane, as a large touch target. */
export interface DropTile {
  /** The bucket's `key` — what `data-plan-section` carries, so the drag reads it as a bucket. */
  key: string;
  label: string;
}

interface Props {
  tiles: readonly DropTile[];
  /** `drag`: a card is being carried over the tiles. `pick`: a swiped card waits for a tap. */
  mode: "drag" | "pick";
  /** The tile under the finger, lit. */
  over: string | null;
  /** The tile the carried card already sits in: dimmed, and dropping or tapping there cancels. */
  dimmed: string | null;
  onPick: (key: string) => void;
  onCancel: () => void;
}

/**
 * The phone's drop overlay (`docs/spec/touch.md`, decided with the user, 2026-11-02): it covers the
 * **planned pane only** and holds one large tile per bucket, label only, in calendar order, filling
 * the half-pane (3 in a row; 4 to 6 in two rows; 7 as 4 + 3). The tiles carry `data-plan-section`,
 * so the finger's drag reads them as the buckets, and they replace the buckets underneath as
 * targets. In `pick` mode a tap places the swiped card, and a tap anywhere else, Android's back
 * (the `dialog` role is what `dismissTopSheet` delivers Escape to) or the dimmed tile cancels.
 */
export default function PlanDropOverlay({ tiles, mode, over, dimmed, onPick, onCancel }: Props) {
  const { t } = useTranslation("planView");
  const ref = useRef<HTMLDivElement>(null);
  const picking = mode === "pick";

  useEffect(() => {
    if (!picking) return;
    ref.current?.focus({ preventScroll: true });
    function outside(event: PointerEvent) {
      if (event.target instanceof Element && event.target.closest("[data-plan-tile]") !== null) return;
      onCancel();
    }
    document.addEventListener("pointerdown", outside, true);
    return () => document.removeEventListener("pointerdown", outside, true);
  }, [picking, onCancel]);

  function onKeyDown(event: KeyboardEvent<HTMLElement>): void {
    if (event.key !== "Escape") return;
    event.stopPropagation();
    onCancel();
  }

  return (
    <div
      ref={ref}
      className={styles.dropOverlay}
      data-plan-overlay={mode}
      {...(picking ? { role: "dialog", "aria-modal": true, tabIndex: -1, onKeyDown } : {})}
      aria-label={t("dropOverlay")}
    >
      <div className={styles.tileGrid} style={{ gridTemplateColumns: `repeat(${String(tileColumns(tiles.length))}, minmax(0, 1fr))` }}>
        {tiles.map((tile) => (
          <button
            key={tile.key}
            type="button"
            tabIndex={picking ? 0 : -1}
            className={`${styles.tile}${over === tile.key ? ` ${styles.tileOver}` : ""}${dimmed === tile.key ? ` ${styles.tileDimmed}` : ""}`}
            data-plan-section={tile.key}
            data-plan-tile=""
            aria-disabled={dimmed === tile.key}
            onClick={picking ? () => (dimmed === tile.key ? onCancel() : onPick(tile.key)) : undefined}
          >
            {tile.label}
          </button>
        ))}
      </div>
    </div>
  );
}
