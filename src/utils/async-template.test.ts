import { describe, expect, it } from "vitest";
import { EMPTY_ASYNC_TEMPLATE, asyncTemplateToSave, isEmptyAsyncTemplate } from "@/utils/async-template";

describe("asyncTemplateToSave", () => {
  it("saves no template while Asynchronous is off", () => {
    expect(asyncTemplateToSave({ title: "Waiting on the bank", tag_ids: [] }, false, "Waiting on X")).toBeNull();
  });

  it("saves no template from an empty section", () => {
    expect(isEmptyAsyncTemplate(EMPTY_ASYNC_TEMPLATE)).toBe(true);
    expect(asyncTemplateToSave(EMPTY_ASYNC_TEMPLATE, true, "Waiting on X")).toBeNull();
  });

  it("gives a section with anything but a title the default title", () => {
    const saved = asyncTemplateToSave({ title: "  ", tag_ids: [4] }, true, "Waiting on X");
    expect(saved).toEqual({ title: "Waiting on X", tag_ids: [4] });
  });

  it("trims a title of its own", () => {
    const saved = asyncTemplateToSave({ title: " Reply ", tag_ids: [], check_every: { n: 2, kind: "day" } }, true, "Waiting on X");
    expect(saved).toEqual({ title: "Reply", tag_ids: [], check_every: { n: 2, kind: "day" } });
  });
});
