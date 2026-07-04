import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import TopBar from "./TopBar";
import { useMindmapStore } from "@/stores/use-mindmap-store";
import { useFilterStore } from "@/stores/use-filter-store";
import { DEFAULT_FILTER } from "@/utils/filter-tree";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { resolvedLanguage: "en", dir: () => "ltr", changeLanguage: vi.fn() },
  }),
}));

vi.mock("@/api/domains", () => ({ DOMAIN_SUBTYPE: { TAG: "tag" }, listDomains: vi.fn().mockResolvedValue([]) }));

beforeEach(() => {
  useFilterStore.setState({ filter: { ...DEFAULT_FILTER } });
  useMindmapStore.setState({ subtreeRootId: null, subtreeNav: null });
});

describe("TopBar", () => {
  it("renders the settings and filter buttons, no back pills at root", () => {
    render(<TopBar />);
    expect(screen.getByRole("button", { name: "settings" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /filter/i })).toBeInTheDocument();
    expect(screen.queryByText("Parent")).not.toBeInTheDocument();
  });

  it("shows back-nav pills from the store when inside a subtree", () => {
    useMindmapStore.setState({
      subtreeRootId: "goal-1",
      subtreeNav: { rootTitle: "Arlesh", parentTitle: "Project X", parentSubtreeId: "domain-2" },
    });
    render(<TopBar />);
    expect(screen.getByText("Project X")).toBeInTheDocument(); // back one level
    expect(screen.getByText("Arlesh")).toBeInTheDocument(); // back to root (parentSubtreeId != null)
  });

  it("marks the filter button active when a filter is engaged", () => {
    useFilterStore.setState({ filter: { ...DEFAULT_FILTER, statusMode: "do" } });
    const { container } = render(<TopBar />);
    expect(container.querySelector("[class*='filterActive']")).not.toBeNull();
  });
});
