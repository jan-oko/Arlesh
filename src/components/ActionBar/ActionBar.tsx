import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import ActionIcon from "@/components/ActionIcon/ActionIcon";
import BottomSheet from "@/components/BottomSheet/BottomSheet";
import CommandList from "@/components/CommandPalette/CommandList";
import { allSurfaceCommands, firstRunnable, useCommandSurfaceStore } from "@/stores/use-command-surface-store";
import type { SurfaceCommand } from "@/stores/use-command-surface-store";
import { usePaletteStore } from "@/stores/use-palette-store";
import { useSelectionSurfaceStore } from "@/stores/use-selection-surface-store";
import { useViewStore } from "@/stores/use-view-store";
import { useBoardReadOnly } from "@/hooks/use-board-read-only";
import { childKindsFor, createChildIds } from "@/utils/touch/child-kinds";
import { LONG_PRESS_MS } from "@/utils/touch/gestures";
import { gateWrites } from "@/utils/touch/writes";
import { actionContextFor, actionSlotsFor } from "@/utils/touch/action-bar";
import type { ActionSlot } from "@/utils/touch/action-bar";
import styles from "./ActionBar.module.css";

/** A slot as drawn: what it runs (or the commands its sheet lists), or nothing when it cannot act. */
interface DrawnSlot {
  slot: ActionSlot;
  command: SurfaceCommand | null;
  menu: SurfaceCommand[];
}

function drawSlot(slot: ActionSlot, commands: readonly SurfaceCommand[]): DrawnSlot {
  if (slot.kind === "menu") {
    const menu = slot.commandIds.flatMap((id) => commands.filter((command) => command.id === id && command.canRun()));
    return { slot, command: null, menu };
  }
  return { slot, command: firstRunnable(commands, slot.commandIds), menu: [] };
}

/**
 * The context action bar (`docs/spec/touch.md`): the handful of things the selection most often
 * wants, then More for the palette. Every slot runs a binding of the hotkey registry through the
 * command surface, so it does exactly what the key does; a slot that cannot act now is drawn
 * disabled rather than hidden, so the bar does not shift under the thumb.
 */
export default function ActionBar() {
  const { t } = useTranslation("touch");
  const view = useViewStore((s) => s.view);
  const kinds = useSelectionSurfaceStore((s) => s.kinds);
  const tables = useCommandSurfaceStore((s) => s.tables);
  // Read so the bar re-asks its slots whenever a view re-renders: a guard reads the latest context.
  useCommandSurfaceStore((s) => s.revision);
  const openPalette = usePaletteStore((s) => s.open);
  const [openMenu, setOpenMenu] = useState<DrawnSlot | null>(null);
  const [kindPicker, setKindPicker] = useState(false);
  const holdTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Set when a hold on Child opened the picker, so the click that follows the lift is not a tap.
  const held = useRef(false);

  const readOnly = useBoardReadOnly() !== null;
  const commands = gateWrites(allSurfaceCommands(tables), readOnly);
  const slots = actionSlotsFor(actionContextFor(view, kinds)).map((slot) => drawSlot(slot, commands));

  const { t: tKinds } = useTranslation("nodeKinds");
  const [selectedKind] = kinds;
  /** What a new child of the one selected node can be, and the command that makes each. */
  const childKinds = kinds.length !== 1 || selectedKind === undefined ? [] : childKindsFor(selectedKind).flatMap((kind) => {
    const command = firstRunnable(commands, createChildIds(kind));
    return command === null ? [] : [{ kind, command }];
  });

  function clearHold() {
    if (holdTimer.current !== null) clearTimeout(holdTimer.current);
    holdTimer.current = null;
  }

  /** A long-press on Child opens the kind picker; every other slot has no hold. */
  function holdHandlers(drawn: DrawnSlot) {
    if (drawn.slot.key !== "child" || drawn.command === null || childKinds.length === 0) return {};
    return {
      onPointerDown: () => {
        clearHold();
        held.current = false;
        holdTimer.current = setTimeout(() => {
          holdTimer.current = null;
          held.current = true;
          if (typeof navigator.vibrate === "function") navigator.vibrate(10);
          setKindPicker(true);
        }, LONG_PRESS_MS);
      },
      onPointerUp: clearHold,
      onPointerLeave: clearHold,
      onPointerCancel: clearHold,
      onContextMenu: (event: { preventDefault: () => void }) => event.preventDefault(),
    };
  }

  function press(drawn: DrawnSlot) {
    if (held.current) {
      held.current = false;
      return;
    }
    if (drawn.slot.kind === "menu") {
      setOpenMenu(drawn);
      return;
    }
    drawn.command?.run();
  }

  return (
    <>
      <nav className={styles.bar} aria-label={t("actionBarLabel")}>
        {slots.map((drawn) => (
          <button
            key={drawn.slot.key}
            type="button"
            className={styles.slot}
            disabled={drawn.slot.kind === "menu" ? drawn.menu.length === 0 : drawn.command === null}
            onClick={() => press(drawn)}
            {...holdHandlers(drawn)}
          >
            <span className={styles.glyph}><ActionIcon name={drawn.slot.icon} /></span>
            {t(drawn.slot.labelKey)}
          </button>
        ))}
        <button type="button" className={styles.slot} onClick={openPalette}>
          <span className={styles.glyph}><ActionIcon name="more" /></span>
          {t("actionMore")}
        </button>
      </nav>
      {kindPicker && (
        <BottomSheet title={t("childKindTitle")} onClose={() => setKindPicker(false)}>
          <ul className={styles.kinds}>
            {childKinds.map(({ kind, command }) => (
              <li key={kind}>
                <button type="button" className={styles.kindItem} onClick={() => { setKindPicker(false); command.run(); }}>
                  {tKinds(kind)}
                </button>
              </li>
            ))}
          </ul>
        </BottomSheet>
      )}
      {openMenu !== null && (
        <BottomSheet title={t(openMenu.slot.labelKey)} onClose={() => setOpenMenu(null)}>
          <CommandList commands={openMenu.menu} onRun={(command) => { setOpenMenu(null); command.run(); }} />
        </BottomSheet>
      )}
    </>
  );
}
