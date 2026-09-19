import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import CommitmentScopePrompt from "./CommitmentScopePrompt";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { dir: () => "ltr" } }),
}));

vi.mock("@/api/scopes", () => ({
  getScope: vi.fn().mockResolvedValue({
    id: 1, kind: "day", start_date: "2026-01-05", end_date: "2026-01-05",
    start_datetime: null, end_datetime: null, part: null,
  }),
  getOrCreateScope: vi.fn(),
}));

beforeEach(() => { vi.clearAllMocks(); });

describe("CommitmentScopePrompt", () => {
  it("cancels with null, so the retype it is holding open never happens", () => {
    const onResolve = vi.fn();
    render(<CommitmentScopePrompt title="Asleep by 23:00" onResolve={onResolve} />);
    fireEvent.click(screen.getByRole("button", { name: "cancel" }));
    expect(onResolve).toHaveBeenCalledWith(null);
  });

  it("cancels on Escape too", () => {
    const onResolve = vi.fn();
    render(<CommitmentScopePrompt title="Asleep by 23:00" onResolve={onResolve} />);
    fireEvent.keyDown(screen.getByText("commitmentNeedsScopeBody"), { key: "Escape" });
    expect(onResolve).toHaveBeenCalledWith(null);
  });

  it("says to pick a window rather than resolving with nothing", () => {
    const onResolve = vi.fn();
    render(<CommitmentScopePrompt title="Asleep by 23:00" onResolve={onResolve} />);
    fireEvent.click(screen.getByRole("button", { name: "save" }));
    expect(onResolve).not.toHaveBeenCalled();
    expect(screen.getByText("commitmentNeedsScopeMissing")).toBeInTheDocument();
  });
});
