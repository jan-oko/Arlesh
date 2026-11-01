import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import "@/i18n";
import FirstRunChooser from "./FirstRunChooser";

describe("FirstRunChooser", () => {
  it("offers this device only, or a server", () => {
    const onStandalone = vi.fn();
    const onServer = vi.fn();
    render(<FirstRunChooser onStandalone={onStandalone} onServer={onServer} />);

    fireEvent.click(screen.getByRole("button", { name: /This device only/ }));
    fireEvent.click(screen.getByRole("button", { name: /Connect to a server/ }));

    expect(onStandalone).toHaveBeenCalledOnce();
    expect(onServer).toHaveBeenCalledOnce();
  });
});
