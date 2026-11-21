import { vi } from "vitest";
import type { AnswerActions } from "@/hooks/use-answer-drafts";

/** Answer controls whose three calls are spies that land. */
export function answerActions(): { [K in keyof AnswerActions]: ReturnType<typeof vi.fn> } & AnswerActions {
  return {
    stage: vi.fn().mockResolvedValue(true),
    unstage: vi.fn().mockResolvedValue(true),
    send: vi.fn().mockResolvedValue(true),
  };
}
