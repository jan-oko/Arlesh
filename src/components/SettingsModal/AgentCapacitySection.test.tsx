import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import AgentCapacitySection from "./AgentCapacitySection";
import { setAgentCapacity } from "@/api/agent-capacity";
import { useAgentCapacityStore } from "@/stores/use-agent-capacity-store";
import { useDisplayStore } from "@/stores/use-display-store";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock("@/api/agent-capacity", () => ({
  setAgentCapacity: vi.fn((atCapacity: boolean) => Promise.resolve({ at_capacity: atCapacity })),
}));

beforeEach(() => {
  vi.clearAllMocks();
  useAgentCapacityStore.setState({ atCapacity: false, error: null });
  useDisplayStore.setState({ showAgentStatus: true });
});

describe("AgentCapacitySection", () => {
  it("sets the lock from its switch", async () => {
    render(<AgentCapacitySection />);
    const lock = screen.getByRole("checkbox", { name: "mcp.capacity.lock" });
    expect(lock).not.toBeChecked();

    fireEvent.click(lock);

    expect(setAgentCapacity).toHaveBeenCalledWith(true);
    await vi.waitFor(() => expect(lock).toBeChecked());
  });

  it("shows a failed set", async () => {
    vi.mocked(setAgentCapacity).mockRejectedValueOnce(new Error("disk full"));
    render(<AgentCapacitySection />);

    fireEvent.click(screen.getByRole("checkbox", { name: "mcp.capacity.lock" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("disk full");
  });

  it("turns the top bar's agent status off without touching the lock", () => {
    render(<AgentCapacitySection />);
    const show = screen.getByRole("checkbox", { name: "mcp.capacity.showStatus" });
    expect(show).toBeChecked();

    fireEvent.click(show);

    expect(useDisplayStore.getState().showAgentStatus).toBe(false);
    expect(setAgentCapacity).not.toHaveBeenCalled();
  });

  it("keeps the lock's help behind a question mark that describes it", () => {
    render(<AgentCapacitySection />);
    const help = screen.getByRole("button", { name: "mcp.capacity.help" });

    expect(help).toHaveAccessibleDescription("mcp.capacity.note");
    expect(screen.getByRole("tooltip")).toHaveTextContent("mcp.capacity.note");
  });
});
