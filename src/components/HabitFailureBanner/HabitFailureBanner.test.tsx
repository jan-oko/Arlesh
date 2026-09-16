import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import HabitFailureBanner from "./HabitFailureBanner";

describe("HabitFailureBanner", () => {
  it("lists every failed flow by title", () => {
    render(
      <HabitFailureBanner
        failedFlows={[{ id: 7, title: "Standup" }, { id: 8, title: "Retro" }]}
        onDismiss={vi.fn()}
      />,
    );
    expect(screen.getByText("Standup")).toBeInTheDocument();
    expect(screen.getByText("Retro")).toBeInTheDocument();
  });

  it("renders nothing when there are no failed flows", () => {
    const { container } = render(<HabitFailureBanner failedFlows={[]} onDismiss={vi.fn()} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("calls onDismiss when the dismiss control is clicked", () => {
    const onDismiss = vi.fn();
    render(<HabitFailureBanner failedFlows={[{ id: 7, title: "Standup" }]} onDismiss={onDismiss} />);
    // i18next is not initialised under test, so `t` echoes the key — with the namespace prefix
    // when the key crosses into a namespace other than the component's default.
    screen.getByRole("button", { name: "common:dismiss" }).click();
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });
});
