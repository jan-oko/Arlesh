/**
 * Closes the topmost sheet, the way Escape would: every modal already closes itself on Escape, so
 * the key is delivered to it rather than each modal learning a second way out. Answers whether a
 * sheet was there.
 */
export function dismissTopSheet(): boolean {
  const dialogs = document.querySelectorAll<HTMLElement>('[role="dialog"]');
  const top = dialogs[dialogs.length - 1];
  if (top === undefined) return false;
  top.dispatchEvent(
    new KeyboardEvent("keydown", { key: "Escape", code: "Escape", bubbles: true, cancelable: true }),
  );
  return true;
}
