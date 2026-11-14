import { describe, expect, it } from "vitest";
import { splitInlineCode } from "./inline-code";

describe("splitInlineCode", () => {
  it("marks the text between backticks as code", () => {
    expect(splitInlineCode("a `b` c")).toEqual([
      { code: false, text: "a " }, { code: true, text: "b" }, { code: false, text: " c" },
    ]);
  });

  it("leaves text with no backticks whole", () => {
    expect(splitInlineCode("plain")).toEqual([{ code: false, text: "plain" }]);
  });

  it("keeps an unclosed backtick as plain text", () => {
    expect(splitInlineCode("a `b")).toEqual([{ code: false, text: "a " }, { code: false, text: "`b" }]);
  });
});
