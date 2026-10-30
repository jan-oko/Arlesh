import { afterEach, describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import "@/i18n";
import ServerBanner from "./ServerBanner";
import { useClientModeStore } from "@/stores/use-client-mode-store";
import type { ModeStatus, ServerStatus } from "@/api/client-mode";

function client(server: Partial<ServerStatus>): ModeStatus {
  return {
    mode: "client",
    first_run: false,
    api_version: 1,
    standalone_available: true,
    server: {
      url: "http://box:4750",
      reachable: true,
      last_sync: null,
      read_only: null,
      server_api_version: 1,
      ...server,
    },
  };
}

describe("ServerBanner", () => {
  afterEach(() => useClientModeStore.setState({ status: null }));

  it("shows nothing Standalone", () => {
    const { container } = render(<ServerBanner />);
    expect(container).toBeEmptyDOMElement();
  });

  it("shows nothing while the server can be written to", () => {
    useClientModeStore.setState({ status: client({}) });
    const { container } = render(<ServerBanner />);
    expect(container).toBeEmptyDOMElement();
  });

  it("says the server is unreachable and when the board was last synced", () => {
    useClientModeStore.setState({
      status: client({ reachable: false, read_only: "server_unreachable", last_sync: "2026-10-30T09:15:00" }),
    });
    render(<ServerBanner />);
    expect(screen.getByRole("status")).toHaveTextContent(/Server unreachable/);
    expect(screen.getByRole("status")).toHaveTextContent(/Last synced/);
  });

  it("names the side to update on a version mismatch", () => {
    useClientModeStore.setState({ status: client({ read_only: "update_server" }) });
    render(<ServerBanner />);
    expect(screen.getByRole("status")).toHaveTextContent(/Update the server/);
  });
});
