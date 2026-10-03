import type { NodeCapabilities } from "@/api/mindmap";

/**
 * What the backend's facts say a derived wait — a check task, a spawned wait, a delegated Task's
 * wait — may be done to (`nodes::rules::capabilities`): nothing. A fixture for one carries it, as
 * the load would.
 */
export const DERIVED_WAIT_CAPABILITIES: NodeCapabilities = {
  delete: false, copy: false, drag: false, compound: false, dependencies: false,
};
