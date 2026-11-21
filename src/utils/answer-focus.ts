import type { Chord } from "@/utils/hotkeys/chord";
import { matchesChord } from "@/utils/hotkeys/chord";

/** Marks the text field of a question or the note field of a review (ADR 0021). */
export const ANSWER_FIELD = "data-answer-field";
/** Set on an answer field: whether its wait is staged (`"true"`) or still waiting (`"false"`). */
export const ANSWER_STAGED = "data-answer-staged";
/** Set on the group holding a Task's answer controls: the Task's node id. */
export const ANSWER_TASK = "data-answer-task";
/** Set on a container a field's `Escape` returns focus to, instead of the page: the editor modal. */
export const FIELD_HOME = "data-field-home";

/** What a key does inside an answer field. */
export type AnswerFieldKey = "next" | "previous" | "leave";

/** The answer fields' own keys, with the cheat-sheet's words for each. */
export const ANSWER_FIELD_KEYS: ReadonlyArray<{ action: AnswerFieldKey; chord: Chord; labelKey: "answerFieldNextKey" | "answerFieldPreviousKey" | "answerFieldLeaveKey" }> = [
  { action: "next", chord: { code: "ArrowDown", alt: true }, labelKey: "answerFieldNextKey" },
  { action: "previous", chord: { code: "ArrowUp", alt: true }, labelKey: "answerFieldPreviousKey" },
  { action: "leave", chord: { code: "Escape" }, labelKey: "answerFieldLeaveKey" },
];

/** The answer field key a press is, or `null` when it is none. */
export function answerFieldKey(event: KeyboardEvent): AnswerFieldKey | null {
  return ANSWER_FIELD_KEYS.find((key) => matchesChord(event, key.chord))?.action ?? null;
}

/** Every answer field in the document, in the order they are shown. */
export function answerFields(): HTMLElement[] {
  return Array.from(document.querySelectorAll<HTMLElement>(`[${ANSWER_FIELD}]`));
}

/** The answer field `from` is in or is, or `null` when it is in none. */
function fieldOf(from: Element | null): HTMLElement | null {
  const field = from?.closest<HTMLElement>(`[${ANSWER_FIELD}]`) ?? null;
  return field;
}

/**
 * Moves focus to the next (`1`) or previous (`-1`) answer field, in the order shown. At the last or
 * first one it does nothing: no wrap. Answers whether focus moved.
 */
export function focusAdjacentField(from: Element | null, step: 1 | -1): boolean {
  const fields = answerFields();
  const here = fieldOf(from);
  const index = here === null ? -1 : fields.indexOf(here);
  const target = fields[index + step];
  if (index < 0 || target === undefined) return false;
  target.focus();
  return true;
}

/**
 * The next answer field whose wait is not staged, after the one `from` is in (or from the first when
 * it is in none), wrapping at the end. `null` when nothing waits.
 */
export function nextWaitingField(from: Element | null): HTMLElement | null {
  const fields = answerFields();
  const waiting = fields.filter((field) => field.getAttribute(ANSWER_STAGED) !== "true");
  if (waiting.length === 0) return null;
  const here = fieldOf(from);
  const position = here === null ? -1 : fields.indexOf(here);
  const after = fields.slice(position + 1).find((field) => waiting.includes(field));
  return after ?? waiting.find((field) => field !== here) ?? waiting[0] ?? null;
}

/** The node id of the Task whose controls hold `field`, or `null`. */
export function taskOfField(field: Element): string | null {
  return field.closest(`[${ANSWER_TASK}]`)?.getAttribute(ANSWER_TASK) ?? null;
}

/**
 * Leaves an answer field without doing anything to the answer: focus goes to the editor modal that
 * holds it, so its own Escape still closes it, or else off the field, to the view, whose keys and
 * `Ctrl+Z` then work.
 */
export function leaveField(field: HTMLElement): void {
  const home = field.closest<HTMLElement>(`[${FIELD_HOME}]`);
  if (home !== null) home.focus();
  else field.blur();
}

/** What a handler needs of a React key event. */
interface KeyEventLike {
  nativeEvent: KeyboardEvent;
  preventDefault: () => void;
  stopPropagation: () => void;
}

/**
 * Acts on an answer field key (`Alt+Down`, `Alt+Up`, `Escape`) pressed in or around `field`, and
 * stops the event there, so a binding on the same chord (the Mindmap's `Alt+Down` reorders) or the
 * editor modal's `Escape` does not also fire. `Escape` leaves the field only when it is the one that
 * has focus. Answers whether the key was one of these.
 */
export function handleFieldKey(event: KeyEventLike, field: HTMLElement | null): boolean {
  const key = answerFieldKey(event.nativeEvent);
  if (key === null) return false;
  if (key === "leave" && (field === null || document.activeElement !== field)) return false;
  event.preventDefault();
  event.stopPropagation();
  if (key === "leave" && field !== null) leaveField(field);
  else if (key === "next") focusAdjacentField(field, 1);
  else if (key === "previous") focusAdjacentField(field, -1);
  return true;
}
