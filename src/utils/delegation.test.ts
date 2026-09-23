import { describe, expect, it } from "vitest";
import { AGENT_DELEGATE, isDelegatedToAgent, toggledAgentDelegate } from "@/utils/delegation";

describe("isDelegatedToAgent", () => {
  it("is true only for the Agent", () => {
    expect(isDelegatedToAgent({ kind: "agent" })).toBe(true);
    expect(isDelegatedToAgent({ kind: "person", id: 3 })).toBe(false);
    expect(isDelegatedToAgent(null)).toBe(false);
    expect(isDelegatedToAgent(undefined)).toBe(false);
  });
});

describe("toggledAgentDelegate", () => {
  it("delegates an undelegated task to the Agent", () => {
    expect(toggledAgentDelegate(null)).toEqual(AGENT_DELEGATE);
  });

  it("takes the Agent back to nobody", () => {
    expect(toggledAgentDelegate({ kind: "agent" })).toBeNull();
  });

  it("replaces a Person with the Agent", () => {
    expect(toggledAgentDelegate({ kind: "person", id: 3 })).toEqual(AGENT_DELEGATE);
  });
});
