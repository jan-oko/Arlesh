import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import AgentStatus from "./AgentStatus";
import { setAgentCapacity } from "@/api/agent-capacity";
import { useAgentCapacityStore } from "@/stores/use-agent-capacity-store";
import { useAgentActivityStore } from "@/stores/use-agent-activity-store";
import { NO_AGENT_ACTIVITY } from "@/utils/agent-activity";
import type { AgentActivity } from "@/utils/agent-activity";
import { useViewStore } from "@/stores/use-view-store";
import { useListFilterStore } from "@/stores/use-list-filter-store";
import { useFilterStore } from "@/stores/use-filter-store";
import { useDisplayStore } from "@/stores/use-display-store";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, options?: { count?: number }) =>
      options?.count === undefined ? key : `${key}:${options.count}`,
  }),
}));

vi.mock("@/api/agent-capacity", () => ({
  setAgentCapacity: vi.fn(() => Promise.resolve({ at_capacity: false })),
}));

function given(atCapacity: boolean, activity: Partial<AgentActivity> = {}): void {
  useAgentCapacityStore.setState({ atCapacity, error: null });
  useAgentActivityStore.setState({ activity: { ...NO_AGENT_ACTIVITY, ...activity } });
}

function glyphs(): string[] {
  return Array.from(document.querySelectorAll("[data-glyph]")).map((svg) => svg.getAttribute("data-glyph") ?? "");
}

beforeEach(() => {
  vi.clearAllMocks();
  useDisplayStore.setState({ showAgentStatus: true });
});

describe("AgentStatus", () => {
  it("draws no head while nothing applies", () => {
    given(false);
    render(<AgentStatus />);

    expect(screen.queryByRole("button")).toBeNull();
    expect(glyphs()).toEqual([]);
  });

  it.each([
    ["the capacity lock", true, {}, "capacity"],
    ["a question waiting", false, { questions: 1 }, "question"],
    ["another agent wait", false, { waits: 1 }, "wait"],
    ["Agentic work In Progress", false, { inProgress: 1 }, "in-progress"],
  ] as const)("with only %s, draws the head and that one icon", (_name, capacity, activity, glyph) => {
    given(capacity, activity);
    render(<AgentStatus />);

    expect(glyphs()).toEqual(["head", glyph]);
  });

  it("orders the row capacity, questions, waits, in progress, and spells out the counts", () => {
    given(true, { questions: 1, waits: 2, inProgress: 3 });
    render(<AgentStatus />);

    expect(glyphs()).toEqual(["head", "capacity", "question", "wait", "in-progress"]);
    expect(screen.getByRole("button").getAttribute("title")).toBe(
      "agentStatus.capacity agentStatus.questions:1 agentStatus.waits:2 agentStatus.inProgress:3 agentStatus.details",
    );
    expect(screen.getByRole("button", { name: /agentStatus\.questions:1/ })).toBeDefined();
  });

  it("opens a menu whose Clear clears the lock", () => {
    given(true, { waits: 1 });
    render(<AgentStatus />);

    fireEvent.click(screen.getByRole("button"));
    expect(screen.getByRole("menu")).toBeDefined();
    fireEvent.click(screen.getByRole("menuitem", { name: "agentStatus.clear: agentStatus.capacity" }));

    expect(setAgentCapacity).toHaveBeenCalledWith(false);
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("shows the waits in the List View's Expectations option", () => {
    given(false, { questions: 2 });
    render(<AgentStatus />);

    fireEvent.click(screen.getByRole("button"));
    fireEvent.click(screen.getByRole("menuitem", { name: "agentStatus.show: agentStatus.questions:2" }));

    expect(useViewStore.getState().view).toBe("list");
    expect(useListFilterStore.getState().filter.preset).toBe("expectations");
  });

  it("shows Agentic work In Progress in the List View under Do with the Agentic pill", () => {
    given(false, { inProgress: 1 });
    render(<AgentStatus />);

    fireEvent.click(screen.getByRole("button"));
    fireEvent.click(screen.getByRole("menuitem", { name: "agentStatus.show: agentStatus.inProgress:1" }));

    expect(useViewStore.getState().view).toBe("list");
    expect(useFilterStore.getState().filter.statusMode).toBe("do");
    expect(useListFilterStore.getState().filter.pills.agentic).toEqual([{ value: "agentic", mode: "all" }]);
  });

  it("closes the menu on Escape", () => {
    given(true);
    render(<AgentStatus />);

    fireEvent.click(screen.getByRole("button"));
    fireEvent.keyDown(window, { key: "Escape" });

    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("draws no head with its setting off, even with the lock on and waits pending", () => {
    given(true, { questions: 1, waits: 1, inProgress: 1 });
    useDisplayStore.setState({ showAgentStatus: false });
    render(<AgentStatus />);

    expect(screen.queryByRole("button")).toBeNull();
    expect(glyphs()).toEqual([]);
  });
});
