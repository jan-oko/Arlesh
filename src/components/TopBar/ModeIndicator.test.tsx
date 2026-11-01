import { afterEach, describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import "@/i18n";
import ModeIndicator from "./ModeIndicator";
import { useClientModeStore } from "@/stores/use-client-mode-store";

afterEach(() => useClientModeStore.setState({ status: null }));

function client(reachable: boolean): void {
  useClientModeStore.setState({
    status: {
      mode: "client",
      first_run: false,
      api_version: 1,
      standalone_available: true,
      server: { url: "http://box:4750", reachable, last_sync: null, read_only: null, server_api_version: 1 },
    },
  });
}

describe("ModeIndicator", () => {
  it("shows nothing until the mode is read, then names this device Standalone", () => {
    const { container, rerender } = render(<ModeIndicator />);
    expect(container).toBeEmptyDOMElement();

    useClientModeStore.setState({
      status: { mode: "standalone", first_run: false, api_version: 1, standalone_available: true, server: null },
    });
    rerender(<ModeIndicator />);
    expect(screen.getByText("This device")).toBeInTheDocument();
  });

  it("says whether the server is reachable", () => {
    client(true);
    const { unmount } = render(<ModeIndicator />);
    expect(screen.getByRole("status")).toHaveAccessibleName("Connected to http://box:4750");
    unmount();

    client(false);
    render(<ModeIndicator />);
    expect(screen.getByRole("status")).toHaveAccessibleName("Cannot reach http://box:4750");
  });
});
