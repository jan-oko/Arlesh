- **A tab can be torn into its own window.** Drag a tab out of the strip and it becomes a second
  window — a full window, with its own tab strip, its own tabs and its own filters — so two parts
  of the board can be on screen at once, one per monitor. The tab menu offers the same thing as
  **Move tab to new window**, and offers **Move tab to "…"** for every other open window, which is
  how a tab comes back. Closing a window's last tab closes that window; closing a window that is
  not the last one simply closes it, and only the final close is governed by *Close to tray*.

  Dragging works both ways: drop a tab anywhere on another window and it moves there, drop it
  anywhere that is not an Arlesh window and it becomes a window of its own. Dragging works on
  Wayland, where apps are not told where the pointer or their windows are.

  Every window is numbered in its title — `Arlesh 1`, `Arlesh 2 — Bugfixes` — and the tray's menu lists them by the same title, each with a check
  while it is on screen: click one to hide or show that window alone, where clicking the tray icon
  still hides or shows them all. A window keeps its number while it is open and gets it back when
  Arlesh reopens; a new window takes the lowest number not in use.

  From the keyboard: **Ctrl+N** opens a new window, beside Ctrl+T's new tab, starting at the
  subtree you are looking at. **Ctrl+Alt+N** takes the current tab into a new window — the same
  thing, but with what you are holding. Both are on the cheat-sheet.

  Your windows come back when you reopen Arlesh, at the size, the position and with the tabs you
  left them with. A window whose monitor is no longer connected reopens somewhere you can reach it
  rather than off screen.
