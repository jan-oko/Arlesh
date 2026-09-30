import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import AgentCapacityIndicator from "./AgentCapacityIndicator";
import { setAgentCapacity } from "@/api/agent-capacity";
import { useAgentCapacityStore } from "@/stores/use-agent-capacity-store";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock("@/api/agent-capacity", () => ({
  setAgentCapacity: vi.fn(() => Promise.resolve({ at_capacity: false })),
}));

beforeEach(() => {
  vi.clearAllMocks();
});

describe("AgentCapacityIndicator", () => {
  it("draws nothing while agents have room", () => {
    useAgentCapacityStore.setState({ atCapacity: false });
    render(<AgentCapacityIndicator />);

    expect(screen.queryByRole("button")).toBeNull();
  });

  it("says agents are at capacity, and what that blocks", () => {
    useAgentCapacityStore.setState({ atCapacity: true });
    render(<AgentCapacityIndicator />);

    const indicator = screen.getByRole("button", { name: "agentCapacity.clear" });
    expect(indicator.textContent).toContain("agentCapacity.indicator");
    expect(indicator.getAttribute("title")).toBe("agentCapacity.title");
  });

  it("clears the lock on click", async () => {
    useAgentCapacityStore.setState({ atCapacity: true });
    render(<AgentCapacityIndicator />);

    fireEvent.click(screen.getByRole("button"));

    expect(setAgentCapacity).toHaveBeenCalledWith(false);
    await vi.waitFor(() => expect(screen.queryByRole("button")).toBeNull());
  });
});
