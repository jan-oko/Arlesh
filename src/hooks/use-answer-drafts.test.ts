import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";
import { skippedAnchor, useAnswerDrafts } from "@/hooks/use-answer-drafts";
import type { SendOutcome } from "@/api/answer-drafts";
import { storedRowId } from "@/test/stored-id";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, values?: Record<string, unknown>) => (values === undefined ? key : `${key} ${JSON.stringify(values)}`),
  }),
}));
const saveAnswerDraft = vi.fn();
const clearAnswerDraft = vi.fn();
const sendAnswerDrafts = vi.fn();
vi.mock("@/api/answer-drafts", () => ({
  saveAnswerDraft: (...args: unknown[]) => saveAnswerDraft(...args) as unknown,
  clearAnswerDraft: (...args: unknown[]) => clearAnswerDraft(...args) as unknown,
  sendAnswerDrafts: (...args: unknown[]) => sendAnswerDrafts(...args) as unknown,
}));
const withGesture = vi.fn((_name: string, run: () => Promise<unknown>) => run());
vi.mock("@/api/gesture", () => ({
  withGesture: (name: string, run: () => Promise<unknown>) => withGesture(name, run),
}));

function setup() {
  const settle = vi.fn(() => Promise.resolve());
  const showToast = vi.fn();
  const { result } = renderHook(() => useAnswerDrafts({ settle, showToast }));
  return { drafts: result.current, settle, showToast };
}

const wait = storedRowId(3);

describe("useAnswerDrafts", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    saveAnswerDraft.mockResolvedValue({});
    clearAnswerDraft.mockResolvedValue(undefined);
  });

  it("stages a trimmed answer and settles on the board", async () => {
    const { drafts, settle } = setup();

    expect(await drafts.stage("n", wait, { answer: "  blue " })).toBe(true);

    expect(saveAnswerDraft).toHaveBeenCalledWith(wait, { answer: "blue" });
    expect(settle).toHaveBeenCalled();
  });

  it("stages a review's verdict with its note", async () => {
    const { drafts } = setup();

    await drafts.stage("n", wait, { verdict: "changes_requested", answer: "fix it" });

    expect(saveAnswerDraft).toHaveBeenCalledWith(wait, { verdict: "changes_requested", answer: "fix it" });
  });

  it("says a refused stage in a toast and leaves the board alone", async () => {
    saveAnswerDraft.mockRejectedValue(new Error("no"));
    const { drafts, settle, showToast } = setup();

    expect(await drafts.stage("n", wait, { answer: "x" })).toBe(false);

    expect(showToast).toHaveBeenCalledWith(expect.objectContaining({ nodeId: "n" }));
    expect(settle).not.toHaveBeenCalled();
  });

  it("unstages a wait", async () => {
    const { drafts } = setup();

    expect(await drafts.unstage("n", wait)).toBe(true);

    expect(clearAnswerDraft).toHaveBeenCalledWith(wait);
  });

  it("sends the shown waits as one named Gesture and raises no toast when nothing was skipped", async () => {
    const outcome: SendOutcome = { sent: [{ wait_id: wait, task_id: storedRowId(1) }], skipped: [] };
    sendAnswerDrafts.mockResolvedValue(outcome);
    const { drafts, settle, showToast } = setup();

    expect(await drafts.send("n", [wait, storedRowId(4)])).toBe(true);

    expect(sendAnswerDrafts).toHaveBeenCalledWith({ shown: [wait, storedRowId(4)] });
    expect(withGesture.mock.calls[0]?.[0]).toContain("gestures.sendAnswers");
    expect(withGesture.mock.calls[0]?.[0]).toContain('"count":2');
    expect(showToast).not.toHaveBeenCalled();
    expect(settle).toHaveBeenCalled();
  });

  it("names every skipped wait in one toast anchored at the first one's Task", async () => {
    sendAnswerDrafts.mockResolvedValue({
      sent: [],
      skipped: [
        { wait_id: wait, task_id: storedRowId(1), title: "Colour?", reason: "released" },
        { wait_id: storedRowId(4), task_id: null, title: null, reason: "gone" },
      ],
    });
    const { drafts, showToast } = setup();

    await drafts.send("pressed", [wait]);

    expect(showToast).toHaveBeenCalledTimes(1);
    const toast = showToast.mock.calls[0]?.[0] as { nodeId: string; message: string };
    expect(toast.nodeId).toBe(`task-${storedRowId(1)}`);
    expect(toast.message).toContain("Colour?");
    expect(toast.message).toContain("draftSkipReason.released");
    expect(toast.message).toContain("draftSkipReason.gone");
  });

  it("a refused send says so and changes nothing", async () => {
    sendAnswerDrafts.mockRejectedValue(new Error("refused"));
    const { drafts, settle, showToast } = setup();

    expect(await drafts.send("pressed", [wait])).toBe(false);

    expect(showToast).toHaveBeenCalledWith(expect.objectContaining({ nodeId: "pressed" }));
    expect(settle).not.toHaveBeenCalled();
  });
});

describe("skippedAnchor", () => {
  it("falls back to where the press was when no skipped wait names its Task", () => {
    expect(skippedAnchor([{ wait_id: wait, reason: "gone" }], "pressed")).toBe("pressed");
  });
});
