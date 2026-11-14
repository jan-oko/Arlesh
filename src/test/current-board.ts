import type { BoardRevision } from "@/api/board";
import type { CurrentBoard, MindmapLoad } from "@/api/mindmap";
import { indexBoard } from "@/utils/board-changes";

/**
 * What `load_mindmap` answers for `load`, for a test that stubs the command.
 *
 * With a `publication` it is a board of that run, sequence and revision, carrying the hash the
 * producer would (so the window's checks pass); without one it is the board of a server that
 * predates changed nodes, which a window answers every event of by loading it whole.
 */
export function currentBoard(
  load: MindmapLoad,
  publication?: { epoch: string; seq: number; revision: number; now?: string },
): CurrentBoard {
  if (publication === undefined) return { load };
  const revision: BoardRevision = { epoch: publication.epoch, revision: publication.revision };
  return {
    load,
    revision,
    seq: publication.seq,
    hash: indexBoard(load).digests.total,
    ...(publication.now === undefined ? {} : { now: publication.now }),
  };
}
