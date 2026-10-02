import { describe, expect, it } from "vitest";
import { agentic, convertedStatus, isBegun, isReview, ordinary, storedStatus } from "@/utils/status-mapping";

describe("convertedStatus — a change of kind, as the backend converts it", () => {
  it("maps the states both models share", () => {
    expect(convertedStatus(ordinary("todo"), true)).toEqual(agentic("todo"));
    expect(convertedStatus(ordinary("in_progress"), true)).toEqual(agentic("doing"));
    expect(convertedStatus(ordinary("done"), true)).toEqual(agentic("done"));
    expect(convertedStatus(agentic("doing"), false)).toEqual(ordinary("in_progress"));
  });

  it("has no counterpart for Started or On Agent", () => {
    expect(convertedStatus(ordinary("started"), true)).toBeNull();
    expect(convertedStatus(agentic("on_agent"), false)).toBeNull();
    expect(convertedStatus(agentic("review"), false)).toBeNull();
  });

  it("leaves a status in its own model alone", () => {
    expect(convertedStatus(ordinary("started"), false)).toEqual(ordinary("started"));
    expect(convertedStatus(agentic("on_agent"), true)).toEqual(agentic("on_agent"));
  });
});

describe("the derived Review", () => {
  it("is stored as On Agent", () => {
    expect(isReview(agentic("review"))).toBe(true);
    expect(storedStatus(agentic("review"))).toEqual(agentic("on_agent"));
    expect(storedStatus(ordinary("started"))).toEqual(ordinary("started"));
  });

  it("is begun work, as On Agent and Doing are", () => {
    expect(isBegun(agentic("review"))).toBe(true);
    expect(isBegun(agentic("on_agent"))).toBe(true);
    expect(isBegun(agentic("todo"))).toBe(false);
  });
});
