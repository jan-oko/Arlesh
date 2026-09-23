import { useEffect, useRef } from "react";
import type { UnlistenFn } from "@tauri-apps/api/event";
import { claimTab, onTabClaimed } from "@/api/board";
import { currentWindowLabel } from "@/api/window-label";
import { carriesTab, decodeTabDrag, tabDrop, TAB_DRAG_TYPE } from "@/utils/tab-drag";

/**
 * Makes this whole window a place a dragged tab can be dropped.
 *
 * The **whole** window, not just its strip, for two reasons. Dropping a tab anywhere on another
 * window is the gesture people make — nobody aims for a strip a few pixels tall. And a drop that
 * this window accepts is one the drag's source can tell apart from a drop on the desktop: a tab
 * released over the board it came from goes nowhere, where released over nothing it becomes a
 * window. See `tearsOff` in `utils/tab-drag`.
 *
 * The strip's own tabs handle a drop on themselves — a reorder, or a claim at a place — and mark it
 * handled; this only takes what they did not.
 */
export function useTabDropTarget(): void {
  useEffect(() => {
    function accept(event: DragEvent) {
      if (event.dataTransfer === null || !carriesTab([...event.dataTransfer.types])) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = "move";
    }

    function drop(event: DragEvent) {
      if (event.defaultPrevented || event.dataTransfer === null) return;
      if (!carriesTab([...event.dataTransfer.types])) return;
      event.preventDefault();
      claimDropped(event.dataTransfer.getData(TAB_DRAG_TYPE));
    }

    window.addEventListener("dragover", accept);
    window.addEventListener("drop", drop);
    return () => {
      window.removeEventListener("dragover", accept);
      window.removeEventListener("drop", drop);
    };
  }, []);
}

/** What a dropped tab turned out to be, for the window it was dropped on. */
export type DroppedTab =
  /** One of this window's own tabs. Off the strip it went nowhere; on it, it is a reorder. */
  | { kind: "own"; tabId: string }
  /** Another window's tab, which that window has been asked to hand over. */
  | { kind: "claimed" }
  /** Not a tab of ours at all. */
  | { kind: "ignored" };

/** Reads a drop's payload and, for another window's tab, asks that window for it. */
export function claimDropped(raw: string): DroppedTab {
  const payload = decodeTabDrag(raw);
  if (payload === null) return { kind: "ignored" };
  const own = currentWindowLabel();
  const drop = tabDrop(payload, own);
  if (drop.kind === "own") return { kind: "own", tabId: payload.tabId };
  void claimTab(drop.from, { tabId: drop.tabId, into: own }).catch((error: unknown) => {
    console.error("[arlesh] could not ask for the dragged tab:", error);
  });
  return { kind: "claimed" };
}

/**
 * Hands over a tab another window has asked for, because it was dragged there.
 *
 * `moveTab` is the menu's own move, so a dragged tab and a menu-moved tab leave the same way. A
 * claim for a tab this window no longer holds — torn off, closed, already handed over — finds
 * nothing to move and does nothing.
 */
export function useTabClaims(moveTab: (tabId: string, into: string) => void): void {
  // The latest move, read when a claim arrives. `moveTab` changes with every change to the strip,
  // and resubscribing each time would leave gaps a claim could fall into.
  const latest = useRef(moveTab);
  useEffect(() => {
    latest.current = moveTab;
  }, [moveTab]);

  useEffect(() => {
    let subscribed = true;
    let unlisten: UnlistenFn | null = null;

    void onTabClaimed((claim) => latest.current(claim.tabId, claim.into)).then((stop) => {
      if (subscribed) unlisten = stop;
      else stop();
    });

    return () => {
      subscribed = false;
      unlisten?.();
    };
  }, []);
}
