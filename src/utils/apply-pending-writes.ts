import type { MindmapNode } from "@/utils/tree-layout";
import { isReflected, isUnanswered } from "@/utils/pending-writes";
import type { BoardStamp, PendingWrite } from "@/utils/pending-writes";

const PENDING = { pending: true } satisfies Pick<MindmapNode, "pending">;

/**
 * Draws the window's pending writes over a board (ADR 0012, decision 3).
 *
 * Drops the writes the board already reflects (decision 5), then applies the rest in `seq` order:
 * a `fields` patch merges into its node, a `create` patch inserts its placeholder under its parent
 * after `afterId`. A node it touches is marked `pending` while its write is unanswered. Only the
 * nodes on the path from the root to a touched node are copied, so an unpatched subtree keeps its
 * identity and its memoised rows. A patch whose node is not on the board (deleted elsewhere) is
 * skipped. With nothing to apply, `board` itself comes back.
 *
 * `aliases` maps a temporary id to the real one a create was answered with. It is the store's
 * window-lifetime map, so a write that still names a temporary id finds the real node.
 */
export function applyPendingWrites(
  board: MindmapNode,
  stamp: BoardStamp,
  writes: readonly PendingWrite[],
  aliases: ReadonlyMap<string, string>,
): MindmapNode {
  const live = writes
    .filter((write) => write.answer === null || !isReflected(write.answer, stamp))
    .sort((a, b) => a.seq - b.seq);
  if (live.length === 0) return board;

  // An answered create is drawn under its real id, so what names it by its temporary one must be
  // found there, whether the store's map has caught up or not.
  const known = new Map(aliases);
  for (const write of live) {
    if (write.patch.kind === "create" && write.answer?.createdId != null) {
      known.set(write.patch.node.id, write.answer.createdId);
    }
  }
  const resolve = (id: string): string => known.get(id) ?? id;

  let tree = board;
  for (const write of live) tree = applyOne(tree, write, resolve);
  return tree;
}

function applyOne(tree: MindmapNode, write: PendingWrite, resolve: (id: string) => string): MindmapNode {
  const mark = isUnanswered(write) ? PENDING : {};
  const { patch } = write;
  if (patch.kind === "fields") {
    // The server's own fields, once it has said them, replace the prediction.
    const fields = write.answer?.fields ?? patch.fields;
    return mapNode(tree, resolve(write.nodeId), (node) => ({ ...node, ...fields, ...mark }));
  }
  const id = write.answer?.createdId ?? patch.node.id;
  if (containsNode(tree, id)) return tree;
  const afterId = patch.afterId === null ? null : resolve(patch.afterId);
  return mapNode(tree, resolve(patch.parentId), (parent) => {
    const at = afterId === null ? -1 : parent.children.findIndex((child) => child.id === afterId);
    const index = at < 0 ? parent.children.length : at + 1;
    const placeholder: MindmapNode = {
      id,
      kind: patch.node.kind,
      title: patch.node.title,
      position: index,
      tagIds: [],
      children: [],
      ...mark,
    };
    return { ...parent, children: [...parent.children.slice(0, index), placeholder, ...parent.children.slice(index)] };
  });
}

function containsNode(node: MindmapNode, id: string): boolean {
  return node.id === id || node.children.some((child) => containsNode(child, id));
}

/** `node` with `change` applied to the node `id`, copying only the path to it; `node` itself when
 * `id` is not under it. */
function mapNode(node: MindmapNode, id: string, change: (node: MindmapNode) => MindmapNode): MindmapNode {
  if (node.id === id) return change(node);
  let children: MindmapNode[] | null = null;
  for (let index = 0; index < node.children.length; index += 1) {
    const child = node.children[index];
    if (child === undefined) continue;
    const next = mapNode(child, id, change);
    if (next === child) continue;
    children ??= node.children.slice();
    children[index] = next;
  }
  return children === null ? node : { ...node, children };
}
