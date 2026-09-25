import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import McpAccessPage from "./McpAccessPage";
import { useMcpRoots } from "@/hooks/use-mcp-roots";
import type { McpRoots } from "@/hooks/use-mcp-roots";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, options?: { title?: string }) => (options?.title === undefined ? key : `${key}:${options.title}`),
  }),
}));

vi.mock("@/hooks/use-mcp-roots");
// The endpoint section has its own test; here it only has to render quietly.
vi.mock("@/hooks/use-mcp-endpoint", () => ({
  useMcpEndpoint: () => ({ status: null, isBusy: false, error: null, restart: vi.fn(), setPort: vi.fn() }),
}));

function roots(overrides: Partial<McpRoots> = {}): McpRoots {
  return {
    roots: [], candidates: [], isLoading: false, error: null,
    addRoot: vi.fn(() => Promise.resolve()), removeRoot: vi.fn(() => Promise.resolve()),
    ...overrides,
  };
}

beforeEach(() => {
  vi.mocked(useMcpRoots).mockReset();
});

describe("McpAccessPage", () => {
  it("says the MCP sees nothing while there are no roots", () => {
    vi.mocked(useMcpRoots).mockReturnValue(roots());
    render(<McpAccessPage />);

    expect(screen.getByText("settings:mcp.none")).toBeInTheDocument();
  });

  it("lists each root with its path and kind, and flags one the MCP cannot see", () => {
    vi.mocked(useMcpRoots).mockReturnValue(roots({
      roots: [
        { key: { node_kind: "domain", node_id: 2 }, title: "Arlesh", kind: "project", path: ["Growth"], visible: true },
        { key: { node_kind: "task", node_id: 7 }, title: "Diary", kind: "task", path: ["Growth", "Self"], visible: false },
      ],
    }));
    render(<McpAccessPage />);

    const list = screen.getByRole("list", { name: "settings:mcp.list" });
    expect(list).toHaveTextContent("Arlesh");
    expect(list).toHaveTextContent("Growth › Self");
    expect(list).toHaveTextContent("nodeKinds:project");
    expect(screen.getAllByText("settings:mcp.hidden")).toHaveLength(1);
  });

  it("removes a root from its ×", () => {
    const state = roots({
      roots: [{ key: { node_kind: "domain", node_id: 2 }, title: "Arlesh", kind: "project", path: [], visible: true }],
    });
    vi.mocked(useMcpRoots).mockReturnValue(state);
    render(<McpAccessPage />);

    fireEvent.click(screen.getByRole("button", { name: "settings:mcp.remove:Arlesh" }));

    expect(state.removeRoot).toHaveBeenCalledWith({ node_kind: "domain", node_id: 2 });
  });

  it("adds a root picked in the node search", () => {
    const state = roots({
      candidates: [{ id: "goal:10", title: "Ship v1", kind: "goal", path: ["Arlesh"] }],
    });
    vi.mocked(useMcpRoots).mockReturnValue(state);
    render(<McpAccessPage />);

    fireEvent.click(screen.getByRole("button", { name: "settings:mcp.add" }));
    const search = screen.getByPlaceholderText("common:searchNodesPlaceholder");
    fireEvent.change(search, { target: { value: "ship" } });
    fireEvent.keyDown(search, { key: "Enter" });

    expect(state.addRoot).toHaveBeenCalledWith("goal:10");
    expect(screen.queryByPlaceholderText("common:searchNodesPlaceholder")).not.toBeInTheDocument();
  });

  it("closes the node search on Escape without taking the settings with it", () => {
    vi.mocked(useMcpRoots).mockReturnValue(roots());
    const onOuterEscape = vi.fn();
    render(
      <div onKeyDown={(event) => { if (event.key === "Escape" && !event.defaultPrevented) onOuterEscape(); }}>
        <McpAccessPage />
      </div>,
    );

    fireEvent.click(screen.getByRole("button", { name: "settings:mcp.add" }));
    fireEvent.keyDown(screen.getByPlaceholderText("common:searchNodesPlaceholder"), { key: "Escape" });

    expect(screen.queryByPlaceholderText("common:searchNodesPlaceholder")).not.toBeInTheDocument();
    expect(onOuterEscape).not.toHaveBeenCalled();
  });

  it("shows why an edit failed", () => {
    vi.mocked(useMcpRoots).mockReturnValue(roots({ error: "task 9 not found" }));
    render(<McpAccessPage />);

    expect(screen.getByRole("alert")).toHaveTextContent("task 9 not found");
  });
});
