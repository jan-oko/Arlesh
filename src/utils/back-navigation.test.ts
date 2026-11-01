import { describe, expect, it, vi } from "vitest";
import { stepBack, type BackActions } from "@/utils/back-navigation";

function actions(applies: Partial<Record<"dismissSheet" | "leaveSubtree" | "upScope", boolean>>): BackActions {
  return {
    dismissSheet: vi.fn(() => applies.dismissSheet === true),
    leaveSubtree: vi.fn(() => applies.leaveSubtree === true),
    upScope: vi.fn(() => applies.upScope === true),
    exit: vi.fn(),
  };
}

describe("stepBack", () => {
  it("closes a sheet before anything else", () => {
    const a = actions({ dismissSheet: true, leaveSubtree: true, upScope: true });
    stepBack(a);
    expect(a.leaveSubtree).not.toHaveBeenCalled();
    expect(a.exit).not.toHaveBeenCalled();
  });

  it("leaves a stepped-into node before going up a scope", () => {
    const a = actions({ leaveSubtree: true, upScope: true });
    stepBack(a);
    expect(a.upScope).not.toHaveBeenCalled();
    expect(a.exit).not.toHaveBeenCalled();
  });

  it("goes up a scope when there is nothing nearer", () => {
    const a = actions({ upScope: true });
    stepBack(a);
    expect(a.exit).not.toHaveBeenCalled();
  });

  it("exits only at the root", () => {
    const a = actions({});
    stepBack(a);
    expect(a.exit).toHaveBeenCalledOnce();
  });
});
