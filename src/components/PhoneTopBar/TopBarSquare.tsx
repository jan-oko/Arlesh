import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { runFirst } from "@/hooks/use-view-gestures";
import { usePaletteStore } from "@/stores/use-palette-store";
import { LONG_PRESS_MS } from "@/utils/touch/gestures";
import styles from "./PhoneTopBar.module.css";

/** `Ctrl+O`, the node search that re-roots the tab. */
const OPEN_COMMAND_IDS: readonly string[] = ["global.openSearch"];

/**
 * The free square at the end of the phone top bar (`docs/spec/touch.md`): a **tap** opens
 * Open (`Ctrl+O`'s node search) and a **long-press** opens the command palette, once the finger
 * lifts as a node's long-press does.
 */
export default function TopBarSquare() {
  const { t } = useTranslation("touch");
  const openPalette = usePaletteStore((s) => s.open);
  const holdTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const held = useRef(false);
  // Whether a press is still on the square: sliding off cancels it, so the lift elsewhere is no tap.
  const pressed = useRef(false);

  function clearHold() {
    if (holdTimer.current !== null) clearTimeout(holdTimer.current);
    holdTimer.current = null;
  }

  useEffect(() => clearHold, []);

  function onPointerDown() {
    pressed.current = true;
    held.current = false;
    clearHold();
    holdTimer.current = setTimeout(() => {
      holdTimer.current = null;
      held.current = true;
      if (typeof navigator.vibrate === "function") navigator.vibrate(10);
    }, LONG_PRESS_MS);
  }

  function onPointerUp() {
    clearHold();
    if (!pressed.current) return;
    pressed.current = false;
    if (held.current) {
      held.current = false;
      openPalette();
      return;
    }
    runFirst(OPEN_COMMAND_IDS);
  }

  function onPointerCancel() {
    clearHold();
    pressed.current = false;
    held.current = false;
  }

  return (
    <div
      role="button"
      tabIndex={0}
      className={styles.square}
      aria-label={t("topBarSquare")}
      title={t("topBarSquare")}
      onPointerDown={onPointerDown}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
      onPointerLeave={onPointerCancel}
      onKeyDown={(event) => { if (event.key === "Enter") runFirst(OPEN_COMMAND_IDS); }}
      onContextMenu={(event) => event.preventDefault()}
    />
  );
}
