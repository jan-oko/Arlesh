/** The DOM id of a concept card, from its title, so the graph's cards and the jump list can reach it. */
export function cardAnchor(title: string): string {
  return `help-card-${title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
}

/** The DOM id of a group of the map. */
export function groupAnchor(id: string): string {
  return `help-group-${id}`;
}

/** Scrolls the element with this id into view, if it is on screen. */
export function scrollToAnchor(id: string): void {
  document.getElementById(id)?.scrollIntoView({ block: "start" });
}
