/**
 * The element on screen carrying `attribute="value"`, or `null` when none is drawn.
 *
 * A walk rather than a selector string: node ids are arbitrary text (a Habit occurrence's carries a
 * UUID and punctuation), and a selector built from one would need escaping that jsdom lacks.
 */
export function findAnchorElement(attribute: string, value: string): Element | null {
  for (const element of document.querySelectorAll(`[${attribute}]`)) {
    if (element.getAttribute(attribute) === value) return element;
  }
  return null;
}
