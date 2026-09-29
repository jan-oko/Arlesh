import type { SearchableNode } from "@/utils/mindmap-tree";

/**
 * For results that share a title, the shortest outward parent path that tells each apart — shown in
 * faded parentheses. Returns a map of node id → disambiguating path (absent/empty when unambiguous).
 */
export function disambiguations(results: readonly SearchableNode[]): Map<string, string> {
  const byTitle = new Map<string, SearchableNode[]>();
  for (const r of results) {
    const group = byTitle.get(r.title);
    if (group === undefined) byTitle.set(r.title, [r]);
    else group.push(r);
  }
  const details = new Map<string, string>();
  for (const group of byTitle.values()) {
    if (group.length === 1) continue;
    for (const r of group) {
      const others = group.filter((o) => o.id !== r.id);
      const prefix = (n: SearchableNode, k: number) => n.path.slice(0, k).join("\u0000");
      let depth = 1;
      while (depth < r.path.length && others.some((o) => prefix(o, depth) === prefix(r, depth))) depth++;
      // Display outermost → innermost (e.g. "Aspect › Project").
      details.set(r.id, r.path.slice(0, depth).reverse().join(" › "));
    }
  }
  return details;
}
