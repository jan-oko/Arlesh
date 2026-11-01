import { afterEach, describe, expect, it, vi } from "vitest";
import { dismissTopSheet } from "@/utils/dismiss-sheet";

afterEach(() => { document.body.innerHTML = ""; });

describe("dismissTopSheet", () => {
  it("does nothing and says so when no sheet is open", () => {
    expect(dismissTopSheet()).toBe(false);
  });

  it("sends Escape to the last dialog only", () => {
    document.body.innerHTML = '<div role="dialog" id="a"></div><div role="dialog" id="b"></div>';
    const first = vi.fn();
    const second = vi.fn();
    document.getElementById("a")?.addEventListener("keydown", first);
    document.getElementById("b")?.addEventListener("keydown", second);

    expect(dismissTopSheet()).toBe(true);
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledOnce();
  });
});
