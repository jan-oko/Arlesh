import { describe, it, expect } from "vitest";
import { dismissDelay } from "./toast-timing";

// Three seconds was a fixed number from when every toast was a handful of words. A paste refusal
// names a kind, a destination and every parent that kind may have, and says that once per reason
// the paste hit — all in the one toast the store can hold. Read at three seconds, it isn't read.
describe("dismissDelay", () => {
  it("leaves a short message at the three seconds it always had", () => {
    expect(dismissDelay("Status: todo → in progress")).toBe(3000);
    expect(dismissDelay("")).toBe(3000);
  });

  it("gives a refusal that names a kind, a destination and four parents longer", () => {
    const refusal = "1 Goal can't sit under Task — only under Aspect, Domain, Project, Goal.";
    expect(dismissDelay(refusal)).toBeGreaterThan(4000);
  });

  it("grows with a second reason rather than cutting the first one short", () => {
    const one = "1 Goal can't sit under Task — only under Aspect, Domain, Project, Goal.";
    const two = `${one} 1 Project can't sit under Task — only under Aspect, Project.`;
    expect(dismissDelay(two)).toBeGreaterThan(dismissDelay(one));
  });

  it("stops growing before a notice outstays its welcome", () => {
    expect(dismissDelay("word ".repeat(500))).toBe(12000);
  });
});
