import { invoke } from "./gesture";
import type { RowId } from "@/api/node-id";
import type { ReviewVerdict } from "@/api/expectations";

/**
 * A **staged answer**: written, not yet sent (ADR 0021). Its existence means the wait is staged.
 * The wait still reads Review, and an agent sees nothing of it until the batch is sent. Stored on the
 * server, so it syncs across devices; the last save wins.
 */
export interface AnswerDraft {
  /** The wait it answers, stored or derived. */
  wait_id: RowId;
  /** A question's answer, or a review's note (optional there). */
  answer: string | null;
  /** A review's verdict; absent on a question. */
  verdict?: ReviewVerdict | null;
  /** When the last save landed (ISO, local time). */
  saved_at: string;
}

/** What to stage: a question's answer, or a review's verdict with its optional note. */
export interface DraftRequest {
  answer?: string | null;
  verdict?: ReviewVerdict;
}

/** The waits the caller's screen showed as staged when Send was pressed. */
export interface SendRequest {
  shown: RowId[];
}

/** Why a staged answer was not sent. */
export const SKIP_REASON = { RELEASED: "released", GONE: "gone", UNSTAGED: "unstaged" } as const;
export type SkipReason = (typeof SKIP_REASON)[keyof typeof SKIP_REASON];

/** A wait released by a send. */
export interface SentDraft {
  wait_id: RowId;
  task_id: RowId;
}

/** A staged answer a send did not send, named so the screen can say so. */
export interface SkippedDraft {
  wait_id: RowId;
  /** The Task it hangs under, when the wait is still known. */
  task_id?: RowId | null;
  /** The wait's title, when the wait is still known. */
  title?: string | null;
  reason: SkipReason;
}

/** What a send did. */
export interface SendOutcome {
  sent: SentDraft[];
  skipped: SkippedDraft[];
}

/** Stages an answer to an open question or review, replacing an earlier draft: the last save wins. */
export async function saveAnswerDraft(waitId: RowId, request: DraftRequest): Promise<AnswerDraft> {
  return invoke<AnswerDraft>("save_answer_draft", { waitId, request });
}

/** Unstages a wait: deletes its draft. Passes when it has none. */
export async function clearAnswerDraft(waitId: RowId): Promise<void> {
  return invoke<void>("clear_answer_draft", { waitId });
}

/** Sends every staged answer on the board, releasing the waits in one write. */
export async function sendAnswerDrafts(request: SendRequest): Promise<SendOutcome> {
  return invoke<SendOutcome>("send_answer_drafts", { request });
}
