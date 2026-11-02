import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import "@/i18n";
import ServerPage from "./ServerPage";
import { connectToServer, testServer } from "@/api/client-mode";
import { useClientModeStore } from "@/stores/use-client-mode-store";

vi.mock("@/api/client-mode", () => ({
  keychainAvailable: vi.fn(() => Promise.resolve(true)),
  testServer: vi.fn(),
  connectToServer: vi.fn(() => Promise.resolve()),
  runStandalone: vi.fn(() => Promise.resolve()),
}));

function fill(): void {
  fireEvent.change(screen.getByLabelText("Server URL"), { target: { value: "http://box:4750" } });
  fireEvent.change(screen.getByLabelText("Token"), { target: { value: "secret" } });
}

beforeEach(() => {
  vi.clearAllMocks();
  useClientModeStore.setState({ status: null });
});

describe("ServerPage", () => {
  it("shows the mode, URL, reachability, last sync and version state of a server", () => {
    useClientModeStore.setState({
      status: {
        mode: "client",
        first_run: false,
        api_version: 1,
        standalone_available: false,
        server: { url: "http://box:4750", reachable: false, last_sync: null, read_only: "update_server", server_api_version: 0 },
      },
    });
    render(<ServerPage />);
    const line = screen.getByRole("status", { name: "Server status" });
    expect(line).toHaveTextContent("Mode: Server");
    expect(line).toHaveTextContent("Server: http://box:4750");
    expect(line).toHaveTextContent("Cannot be reached");
    expect(line).toHaveTextContent("Not synced yet.");
    expect(line).toHaveTextContent("The server is older than this app.");
  });

  it("connects only once the server has tested compatible", async () => {
    vi.mocked(testServer).mockResolvedValue({
      health: { api_version: 1, version: "0.3.0", commit: "abc" },
      read_only: null,
    });
    render(<ServerPage />);
    fill();
    const connect = screen.getByRole("button", { name: "Connect and restart" });
    expect(connect).toBeDisabled();

    fireEvent.click(screen.getByRole("button", { name: "Test" }));
    await waitFor(() => expect(connect).toBeEnabled());
    fireEvent.click(connect);

    await waitFor(() => expect(connectToServer).toHaveBeenCalledWith("http://box:4750", "secret", false));
  });

  it("names the side to update and does not connect to an incompatible server", async () => {
    vi.mocked(testServer).mockResolvedValue({
      health: { api_version: 2, version: "0.4.0", commit: "abc" },
      read_only: "update_app",
    });
    render(<ServerPage />);
    fill();

    fireEvent.click(screen.getByRole("button", { name: "Test" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/Update the app/);
    expect(screen.getByRole("button", { name: "Connect and restart" })).toBeDisabled();
  });
});
