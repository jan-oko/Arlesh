import type { AsyncTemplate } from "@/api/tasks";

/** The Expectation section as a form holds it: every field, blank ones included. */
export const EMPTY_ASYNC_TEMPLATE: AsyncTemplate = { title: "", tag_ids: [] };

/** Whether the Expectation section says anything at all — an empty one is no template. */
export function isEmptyAsyncTemplate(template: AsyncTemplate): boolean {
  return template.title.trim() === "" && template.tag_ids.length === 0
    && template.time_scope === undefined && template.check_every === undefined;
}

/**
 * The template an editor saves from its Expectation section: none while Asynchronous is off or
 * the section is empty, and otherwise the section with its title trimmed — a blank title taking
 * `defaultTitle`. The Task editor and the flow item editor save it the same way.
 */
export function asyncTemplateToSave(
  template: AsyncTemplate,
  asynchronous: boolean,
  defaultTitle: string,
): AsyncTemplate | null {
  if (!asynchronous || isEmptyAsyncTemplate(template)) return null;
  return { ...template, title: template.title.trim() || defaultTitle };
}
