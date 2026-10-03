import { describe, it, expect } from "vitest";
import { agentActivityFrom, NO_AGENT_ACTIVITY } from "./agent-activity";

describe("agentActivityFrom", () => {
  it("reads the counts the board load sent", () => {
    expect(agentActivityFrom({ review: 2, waits: 1, on_agent: 3 })).toEqual({ review: 2, waits: 1, onAgent: 3 });
  });

  it("reads nothing when the load sent no counts", () => {
    expect(agentActivityFrom(undefined)).toEqual(NO_AGENT_ACTIVITY);
  });
});
