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

  it("names a commitment habit whose template holds goals, rather than leaving its repetitions quietly missing", () => {
    render(
      <HabitFailureBanner
        failedFlows={[]}
        unrenderableCommitmentFlows={[{ id: 11, title: "Asleep by 23:00" }]}
        onDismiss={vi.fn()}
      />,
    );
    expect(screen.getByText("Asleep by 23:00")).toBeInTheDocument();
  });

  it("renders nothing when neither condition holds", () => {
    const { container } = render(
      <HabitFailureBanner failedFlows={[]} unrenderableCommitmentFlows={[]} onDismiss={vi.fn()} />,
    );
    expect(container).toBeEmptyDOMElement();
  });
});
