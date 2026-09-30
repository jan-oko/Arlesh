import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import AgentCapacityIndicator from "./AgentCapacityIndicator";
import { setAgentCapacity } from "@/api/agent-capacity";
import { useAgentCapacityStore } from "@/stores/use-agent-capacity-store";
import { useDisplayStore } from "@/stores/use-display-store";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock("@/api/agent-capacity", () => ({
  setAgentCapacity: vi.fn(() => Promise.resolve({ at_capacity: false })),
}));

beforeEach(() => {
  vi.clearAllMocks();
  useDisplayStore.setState({ startHidesAgenticAtCapacity: true });
});

describe("AgentCapacityIndicator", () => {
  it("draws nothing while agents have room", () => {
    useAgentCapacityStore.setState({ atCapacity: false });
    render(<AgentCapacityIndicator />);

    expect(screen.queryByRole("button")).toBeNull();
  });

  it("says agents are at capacity, and that Start is hiding their tasks", () => {
    useAgentCapacityStore.setState({ atCapacity: true });
    render(<AgentCapacityIndicator />);

    const indicator = screen.getByRole("button", { name: "agentCapacity.clear" });
    expect(indicator.textContent).toContain("agentCapacity.indicator");
    expect(indicator.getAttribute("title")).toBe("agentCapacity.titleHiding");
  });

  it("says Start still shows them when the setting is off", () => {
    useAgentCapacityStore.setState({ atCapacity: true });
    useDisplayStore.setState({ startHidesAgenticAtCapacity: false });
    render(<AgentCapacityIndicator />);

    expect(screen.getByRole("button").getAttribute("title")).toBe("agentCapacity.titleShowing");
  });

  it("clears the lock on click", async () => {
    useAgentCapacityStore.setState({ atCapacity: true });
    render(<AgentCapacityIndicator />);

    fireEvent.click(screen.getByRole("button"));

    expect(setAgentCapacity).toHaveBeenCalledWith(false);
    await vi.waitFor(() => expect(screen.queryByRole("button")).toBeNull());
  });
});
