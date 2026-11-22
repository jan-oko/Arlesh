import type { Chord } from "@/utils/hotkeys/chord";
import { matchesChord } from "@/utils/hotkeys/chord";

/** Marks the text field of a question or the note field of a review (ADR 0021). */
export const ANSWER_FIELD = "data-answer-field";
/** Set on an answer field: whether its wait is staged (`"true"`) or still waiting (`"false"`). */
export const ANSWER_STAGED = "data-answer-staged";
/** Set on the group holding a Task's answer controls: the Task's node id. */
export const ANSWER_TASK = "data-answer-task";
/** Set on the group around one open wait's answer box: the wait's id, as the board and the push name it. */
export const ANSWER_WAIT = "data-answer-wait";
/** Set on a container a field's `Escape` returns focus to, instead of the page: the editor modal. */
export const FIELD_HOME = "data-field-home";

/** `Ctrl+Shift+Enter`: unstages the staged answer the focus is in. The field handles it itself. */
export const UNSTAGE_CHORD: Chord = { code: "Enter", ctrl: true, shift: true };

/** What a key does inside an answer field. */
export type AnswerFieldKey = "next" | "previous" | "leave" | "unstage";

/** The answer fields' own keys, with the cheat-sheet's words for each. */
export const ANSWER_FIELD_KEYS: ReadonlyArray<{ action: AnswerFieldKey; chord: Chord; labelKey: "answerFieldNextKey" | "answerFieldPreviousKey" | "answerFieldLeaveKey" | "answerFieldUnstageKey" }> = [
  { action: "next", chord: { code: "ArrowDown", alt: true }, labelKey: "answerFieldNextKey" },
  { action: "previous", chord: { code: "ArrowUp", alt: true }, labelKey: "answerFieldPreviousKey" },
  { action: "leave", chord: { code: "Escape" }, labelKey: "answerFieldLeaveKey" },
  { action: "unstage", chord: UNSTAGE_CHORD, labelKey: "answerFieldUnstageKey" },
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
 * The next answer field after the one `from` is in (or from the first when it is in none), wrapping at
 * the end, among those that are **staged** (`staged`) or still **waiting** (not). `null` when there
 * are none.
 */
export function nextAnswerField(from: Element | null, staged: boolean): HTMLElement | null {
  const fields = answerFields();
  const wanted = fields.filter((field) => (field.getAttribute(ANSWER_STAGED) === "true") === staged);
  if (wanted.length === 0) return null;
  const here = fieldOf(from);
  const position = here === null ? -1 : fields.indexOf(here);
  const after = fields.slice(position + 1).find((field) => wanted.includes(field));
  return after ?? wanted.find((field) => field !== here) ?? wanted[0] ?? null;
}

/** The next answer field whose wait is not staged: {@link nextAnswerField} over the waiting ones. */
export function nextWaitingField(from: Element | null): HTMLElement | null {
  return nextAnswerField(from, false);
}

/** Puts the caret at the end of a text field and keeps focus in it, after the field has re-rendered. */
export function keepFocusAtEnd(field: HTMLTextAreaElement | null): void {
  if (field === null) return;
  field.focus();
  window.setTimeout(() => {
    field.focus();
    field.setSelectionRange(field.value.length, field.value.length);
  }, 0);
}

/** The answer field of the open wait `waitId`, or `null` when no box of it is drawn. */
export function answerFieldOfWait(waitId: string): HTMLElement | null {
  const wait = Array.from(document.querySelectorAll<HTMLElement>(`[${ANSWER_WAIT}]`))
    .find((group) => group.getAttribute(ANSWER_WAIT) === waitId);
  return wait?.querySelector<HTMLElement>(`[${ANSWER_FIELD}]`) ?? null;
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
  if (key === null || key === "unstage") return false;
  if (key === "leave" && (field === null || document.activeElement !== field)) return false;
  event.preventDefault();
  event.stopPropagation();
  if (key === "leave" && field !== null) leaveField(field);
  else if (key === "next") focusAdjacentField(field, 1);
  else if (key === "previous") focusAdjacentField(field, -1);
  return true;
}

/** How many lines an answer or note field shows when empty on the touch layout: two, so the controls below stay on screen. */
export const TOUCH_FIELD_ROWS = 2;
