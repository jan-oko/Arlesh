import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import "@/i18n";
import DevicesPage from "./DevicesPage";
import { approveDevice, listDevices, revokeDevice, waitingDevice } from "@/api/devices";
import { useClientModeStore } from "@/stores/use-client-mode-store";

vi.mock("@/api/devices", () => ({
  listDevices: vi.fn(),
  waitingDevice: vi.fn(),
  approveDevice: vi.fn(),
  revokeDevice: vi.fn(() => Promise.resolve()),
}));

const DEVICES = [
  { name: "laptop", created_at: "2026-11-01T09:00:00", last_seen_at: "2026-11-01T10:00:00", current: true },
  { name: "phone", created_at: "2026-11-01T09:30:00", last_seen_at: null, current: false },
];

function asClient(mode: "client" | "standalone" = "client"): void {
  useClientModeStore.setState({
    status: { mode, first_run: false, api_version: 1, standalone_available: true, server: null },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(listDevices).mockResolvedValue(DEVICES);
  asClient();
});

describe("DevicesPage", () => {
  it("is only for a device connected to a server", () => {
    asClient("standalone");
    render(<DevicesPage />);

    expect(screen.getByText("Devices are managed on the server. Connect to a server first.")).toBeInTheDocument();
    expect(listDevices).not.toHaveBeenCalled();
  });

  it("lists the devices with when each was last seen and marks this one", async () => {
    render(<DevicesPage />);

    const list = await screen.findByRole("list", { name: "Devices" });
    const [laptop, phone] = within(list).getAllByRole("listitem");
    expect(laptop).toHaveTextContent("laptop");
    expect(laptop).toHaveTextContent("this device");
    expect(laptop).toHaveTextContent("Last seen");
    expect(phone).toHaveTextContent("phone");
    expect(phone).toHaveTextContent("Not seen yet");
  });

  it("offers no revoke for this device", async () => {
    render(<DevicesPage />);
    await screen.findByText("phone");

    expect(screen.queryByRole("button", { name: "Revoke laptop" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Revoke phone" })).toBeInTheDocument();
  });

  it("revokes a device only after a confirmation", async () => {
    render(<DevicesPage />);
    fireEvent.click(await screen.findByRole("button", { name: "Revoke phone" }));
    expect(revokeDevice).not.toHaveBeenCalled();

    const ask = screen.getByRole("group", { name: /Revoke phone\?/ });
    fireEvent.click(within(ask).getByRole("button", { name: "Revoke" }));

    await waitFor(() => expect(revokeDevice).toHaveBeenCalledWith("phone"));
    await waitFor(() => expect(listDevices).toHaveBeenCalledTimes(2));
  });

  it("keeps the device when the confirmation is cancelled", async () => {
    render(<DevicesPage />);
    fireEvent.click(await screen.findByRole("button", { name: "Revoke phone" }));

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(revokeDevice).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Revoke phone" })).toBeInTheDocument();
  });

  it("shows the server's refusal of a revoke", async () => {
    vi.mocked(revokeDevice).mockRejectedValue({ kind: "not_permitted", message: "a device cannot revoke itself" });
    render(<DevicesPage />);
    fireEvent.click(await screen.findByRole("button", { name: "Revoke phone" }));

    fireEvent.click(within(screen.getByRole("group", { name: /Revoke phone\?/ })).getByRole("button", { name: "Revoke" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("a device cannot revoke itself");
  });

  it("approves a PIN under the suggested name, which can be edited", async () => {
    vi.mocked(waitingDevice).mockResolvedValue({ pin: "123456", name: "Pixel-8", expires_at: "x" });
    vi.mocked(approveDevice).mockResolvedValue("jans-pixel-2");
    render(<DevicesPage />);
    await screen.findByText("phone");

    const pin = screen.getByLabelText("PIN");
    fireEvent.change(pin, { target: { value: "123456" } });
    fireEvent.click(screen.getByRole("button", { name: "Look up" }));
    const name = await screen.findByLabelText("Name for the device");
    expect(name).toHaveValue("Pixel-8");
    fireEvent.change(name, { target: { value: "jans-pixel" } });
    fireEvent.click(screen.getByRole("button", { name: "Approve" }));

    await waitFor(() => expect(approveDevice).toHaveBeenCalledWith("123456", "jans-pixel"));
    expect(await screen.findByRole("status")).toHaveTextContent("Approved as jans-pixel-2.");
  });

  it("only looks up a whole PIN, and keeps digits only", async () => {
    render(<DevicesPage />);
    await screen.findByText("phone");
    const pin = screen.getByLabelText("PIN");

    fireEvent.change(pin, { target: { value: "12ab34" } });

    expect(pin).toHaveValue("1234");
    expect(screen.getByRole("button", { name: "Look up" })).toBeDisabled();
  });

  it("says when no device is waiting with the PIN", async () => {
    vi.mocked(waitingDevice).mockRejectedValue({ kind: "not_found", message: "no device is waiting with that PIN" });
    render(<DevicesPage />);
    await screen.findByText("phone");
    fireEvent.change(screen.getByLabelText("PIN"), { target: { value: "999999" } });

    fireEvent.click(screen.getByRole("button", { name: "Look up" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("no device is waiting with that PIN");
  });
});
