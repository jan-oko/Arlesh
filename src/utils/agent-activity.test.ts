import { describe, it, expect } from "vitest";
import { agentActivityFrom, NO_AGENT_ACTIVITY, stagedWaitIdsFrom } from "./agent-activity";

describe("agentActivityFrom", () => {
  it("reads the counts the board load sent", () => {
    expect(agentActivityFrom({ review: 2, waits: 1, on_agent: 3 })).toEqual({ review: 2, waits: 1, onAgent: 3, staged: 0 });
  });

  it("reads how many answers are staged, and none when the load left it off", () => {
    expect(agentActivityFrom({ review: 1, waits: 0, on_agent: 0, staged: 2 }).staged).toBe(2);
    expect(agentActivityFrom({ review: 1, waits: 0, on_agent: 0 }).staged).toBe(0);
  });

  it("reads nothing when the load sent no counts", () => {
    expect(agentActivityFrom(undefined)).toEqual(NO_AGENT_ACTIVITY);
  });
});

describe("stagedWaitIdsFrom", () => {
  it("collects every Task's staged questions off the facts, in a stable order", () => {
    expect(stagedWaitIdsFrom({
      "task-b": { staged_questions: ["w3"] },
      "task-a": { staged_questions: ["w1", "w2"], open_questions: ["w1", "w2", "w9"] },
      "task-c": { open_questions: ["w8"] },
    })).toEqual(["w1", "w2", "w3"]);
  });

  it("is empty when the load sent no facts", () => {
    expect(stagedWaitIdsFrom(undefined)).toEqual([]);
  });
});
