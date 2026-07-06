import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import AnchorScopeField from "./AnchorScopeField";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { dir: () => "ltr" } }),
}));

vi.mock("@/hooks/use-scope-labels", () => ({
  useScopeLabels: () => ({
    unscoped: "Unscoped",
    unplanned: "Unplanned",
    week: (n: number) => `W${n}`,
    month: (m: number) => ["Jan", "Feb", "Mar", "Apr", "May", "June", "July"][m - 1] ?? "M",
    season: (name: string) => name,
    duration: (count: number, kind: string) => `${count} ${kind}`,
  }),
}));

describe("AnchorScopeField", () => {
  it("shows the formatted anchor for the given kind and date", () => {
    render(<AnchorScopeField kind="week" date="2026-07-05" onChange={vi.fn()} />);
    expect(screen.getByText(/^W\d+ 2026$/)).toBeInTheDocument();
  });

  it("opens a picker locked to the given kind", () => {
    render(<AnchorScopeField kind="week" date="2026-07-05" onChange={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "edit" }));
    expect(screen.queryByRole("button", { name: "up" })).not.toBeInTheDocument();
    expect(screen.getAllByText(/^Week \d+$/).length).toBeGreaterThan(0);
  });

  it("picking a cell and applying emits its start date", () => {
    const onChange = vi.fn();
    render(<AnchorScopeField kind="week" date="2026-07-05" onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: "edit" }));
    fireEvent.click(screen.getAllByText(/^Week \d+$/)[0]!);
    fireEvent.click(screen.getByRole("button", { name: "scopeApply" }));
    expect(onChange).toHaveBeenCalledWith(expect.any(String));
    expect(screen.queryByRole("button", { name: "scopeApply" })).not.toBeInTheDocument();
  });

  it("applying without a selection is a no-op", () => {
    const onChange = vi.fn();
    render(<AnchorScopeField kind="week" date="2026-07-05" onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: "edit" }));
    fireEvent.click(screen.getByRole("button", { name: "scopeApply" }));
    expect(onChange).not.toHaveBeenCalled();
  });
});
