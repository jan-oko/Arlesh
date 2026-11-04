import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import "@/i18n";
import ServerPage from "./ServerPage";
import { connectToServer, testServer } from "@/api/client-mode";
import { deviceName, pairPoll, pairStart } from "@/api/devices";
import { useClientModeStore } from "@/stores/use-client-mode-store";

vi.mock("@/api/client-mode", () => ({
  keychainAvailable: vi.fn(() => Promise.resolve(true)),
  testServer: vi.fn(),
  connectToServer: vi.fn(() => Promise.resolve()),
  runStandalone: vi.fn(() => Promise.resolve()),
}));

vi.mock("@/api/devices", () => ({
  deviceName: vi.fn(() => Promise.resolve("jans-pixel")),
  pairStart: vi.fn(),
  pairPoll: vi.fn(),
  errorReason: vi.fn(() => null),
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

  describe("pairing", () => {
    function typeUrl(): void {
      fireEvent.change(screen.getByLabelText("Server URL"), { target: { value: "http://box:4750" } });
    }

    it("offers the device name, defaulted to the host or phone model, and needs a URL", async () => {
      render(<ServerPage />);

      expect(await screen.findByLabelText("Device name")).toHaveValue("jans-pixel");
      expect(deviceName).toHaveBeenCalled();
      expect(screen.getByRole("button", { name: "Pair with a PIN" })).toBeDisabled();
    });

    it("shows the PIN large and connects with the token the approval brings", async () => {
      vi.mocked(pairStart).mockResolvedValue({ id: "secret-id", pin: "004217", name: "Pixel", expires_at: "x" });
      vi.mocked(pairPoll)
        .mockResolvedValueOnce({ status: "pending", name: null, token: null })
        .mockResolvedValueOnce({ status: "approved", name: "pixel", token: "device-token" });
      render(<ServerPage />);
      typeUrl();
      fireEvent.change(await screen.findByLabelText("Device name"), { target: { value: "Pixel" } });

      vi.useFakeTimers({ shouldAdvanceTime: true });
      try {
        fireEvent.click(screen.getByRole("button", { name: "Pair with a PIN" }));
        expect(await screen.findByLabelText("PIN")).toHaveTextContent("004217");
        expect(pairStart).toHaveBeenCalledWith("http://box:4750", "Pixel");
        expect(screen.getByRole("status")).toHaveTextContent("arlesh-server pin approve 004217");

        await vi.advanceTimersByTimeAsync(5000);
        expect(connectToServer).not.toHaveBeenCalled();
        await vi.advanceTimersByTimeAsync(5000);
      } finally {
        vi.useRealTimers();
      }

      expect(pairPoll).toHaveBeenCalledWith("http://box:4750", "secret-id", "004217");
      await waitFor(() => expect(connectToServer).toHaveBeenCalledWith("http://box:4750", "device-token", false));
    });

    it("stops waiting when cancelled", async () => {
      vi.mocked(pairStart).mockResolvedValue({ id: "secret-id", pin: "004217", name: "Pixel", expires_at: "x" });
      render(<ServerPage />);
      typeUrl();
      await screen.findByLabelText("Device name");

      fireEvent.click(screen.getByRole("button", { name: "Pair with a PIN" }));
      fireEvent.click(await screen.findByRole("button", { name: "Cancel" }));

      expect(screen.queryByLabelText("PIN")).not.toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Pair with a PIN" })).toBeEnabled();
    });

    it("says why when the server refuses to start a pairing", async () => {
      vi.mocked(pairStart).mockRejectedValue({ kind: "not_permitted", message: "too many requests from this address" });
      render(<ServerPage />);
      typeUrl();
      await screen.findByLabelText("Device name");

      fireEvent.click(screen.getByRole("button", { name: "Pair with a PIN" }));

      expect(await screen.findByRole("alert")).toHaveTextContent("too many requests from this address");
    });
  });
});
