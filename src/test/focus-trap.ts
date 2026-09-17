import { expect } from "vitest";
import userEvent from "@testing-library/user-event";

/** Enough presses to walk any dialog in the app right round and back to where it started. */
const MAX_PRESSES = 40;

/**
 * Asserts that keyboard focus cannot leave `modal` in either direction.
 *
 * The walk is deliberately blind to how the trap is built: it tabs from wherever focus happens to
 * be, checks after every press that focus is still inside the dialog, and requires the cycle to
 * come back round to the control it started on — which is the wrap the user feels when Tab past
 * the last control lands on the first, and Shift+Tab before the first lands on the last.
 *
 * Render something focusable outside the dialog before calling this, or there is nowhere for focus
 * to escape to and the assertion proves nothing.
 */
export async function expectFocusTrapped(modal: HTMLElement): Promise<void> {
  await expectTabCycleStaysInside(modal, false);
  await expectTabCycleStaysInside(modal, true);
}

async function expectTabCycleStaysInside(modal: HTMLElement, backwards: boolean): Promise<void> {
  const user = userEvent.setup();
  const direction = backwards ? "Shift+Tab" : "Tab";

  // A first press from outside is the trap pulling focus in; from inside it is just the next stop.
  await user.tab({ shift: backwards });
  const start = document.activeElement;
  expect(start, `${direction} did not move focus into the dialog`).not.toBeNull();
  expect(modal.contains(start), `${direction} left the dialog`).toBe(true);

  for (let press = 1; press <= MAX_PRESSES; press++) {
    await user.tab({ shift: backwards });
    expect(modal.contains(document.activeElement), `${direction} #${press} left the dialog`).toBe(true);
    if (document.activeElement === start) return;
  }

  expect.fail(`${direction} never came back round to where the cycle started`);
}

/**
 * The dialog box inside a rendered modal. Every modal in the app is an overlay wrapping a single
 * box, and the box — not the overlay — is what the trap is attached to.
 */
export function dialogIn(container: HTMLElement): HTMLElement {
  const dialog = container.firstElementChild?.firstElementChild;
  if (!(dialog instanceof HTMLElement)) throw new Error("no dialog box found inside the rendered overlay");
  return dialog;
}
