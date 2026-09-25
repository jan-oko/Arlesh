import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import McpEndpointSection from "./McpEndpointSection";
import { useMcpEndpoint } from "@/hooks/use-mcp-endpoint";
import type { McpEndpoint } from "@/hooks/use-mcp-endpoint";
import type { McpEndpointStatus } from "@/api/mcp-endpoint";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) =>
      options === undefined ? key : `${key}:${JSON.stringify(options)}`,
  }),
}));

vi.mock("@/hooks/use-mcp-endpoint");

function status(overrides: Partial<McpEndpointStatus> = {}): McpEndpointStatus {
  return {
    listener: { state: "listening", address: "127.0.0.1:4747" },
    port: 4747, configured_port: 4747, env_override: null,
    ...overrides,
  };
}

function endpoint(overrides: Partial<McpEndpoint> = {}): McpEndpoint {
  return {
    status: status(), isBusy: false, error: null,
    restart: vi.fn(() => Promise.resolve()), setPort: vi.fn(() => Promise.resolve()),
    ...overrides,
  };
}

beforeEach(() => {
  vi.mocked(useMcpEndpoint).mockReset();
});

describe("McpEndpointSection", () => {
  it("says which address the endpoint is listening on", () => {
    vi.mocked(useMcpEndpoint).mockReturnValue(endpoint());
    render(<McpEndpointSection />);

    expect(screen.getByRole("status")).toHaveTextContent("127.0.0.1:4747");
    expect(screen.getByLabelText("mcp.endpoint.port")).toHaveValue("4747");
  });

  it("says why the endpoint is not listening, and restarts it", () => {
    const state = endpoint({
      status: status({ listener: { state: "failed", reason: "Address already in use (os error 98)" } }),
    });
    vi.mocked(useMcpEndpoint).mockReturnValue(state);
    render(<McpEndpointSection />);

    expect(screen.getByRole("status")).toHaveTextContent("mcp.endpoint.failed");
    expect(screen.getByRole("status")).toHaveTextContent("Address already in use (os error 98)");

    fireEvent.click(screen.getByRole("button", { name: "mcp.endpoint.restart" }));

    expect(state.restart).toHaveBeenCalledTimes(1);
  });

  it("shows the status a restart leaves behind", () => {
    vi.mocked(useMcpEndpoint).mockReturnValue(endpoint({
      status: status({ listener: { state: "failed", reason: "in use" } }),
    }));
    const { rerender } = render(<McpEndpointSection />);

    vi.mocked(useMcpEndpoint).mockReturnValue(endpoint());
    rerender(<McpEndpointSection />);

    expect(screen.getByRole("status")).toHaveTextContent("mcp.endpoint.listening");
    expect(screen.getByRole("status")).not.toHaveTextContent("in use");
  });

  it("applies a new port, and only a valid, changed one", () => {
    const state = endpoint();
    vi.mocked(useMcpEndpoint).mockReturnValue(state);
    render(<McpEndpointSection />);
    const apply = screen.getByRole("button", { name: "mcp.endpoint.apply" });
    const field = screen.getByLabelText("mcp.endpoint.port");

    expect(apply).toBeDisabled();
    fireEvent.change(field, { target: { value: "70000" } });
    expect(apply).toBeDisabled();
    expect(screen.getByText("mcp.endpoint.invalidPort")).toBeInTheDocument();

    fireEvent.change(field, { target: { value: "4848" } });
    fireEvent.click(apply);

    expect(state.setPort).toHaveBeenCalledWith(4848);
  });

  it("says when ARLESH_MCP_PORT overrides the field", () => {
    vi.mocked(useMcpEndpoint).mockReturnValue(endpoint({
      status: status({ port: 5151, env_override: 5151, listener: { state: "listening", address: "127.0.0.1:5151" } }),
    }));
    render(<McpEndpointSection />);

    expect(screen.getByText(/mcp\.endpoint\.envOverride/)).toHaveTextContent("5151");
  });

  it("shows why an action failed", () => {
    vi.mocked(useMcpEndpoint).mockReturnValue(endpoint({ error: "could not save the MCP port" }));
    render(<McpEndpointSection />);

    expect(screen.getByRole("alert")).toHaveTextContent("could not save the MCP port");
  });
});
