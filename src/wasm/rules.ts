import init, { initSync } from "@/wasm/pkg/arlesh_rules_wasm";
import wasmUrl from "@/wasm/pkg/arlesh_rules_wasm_bg.wasm?url";

/**
 * The Rust rules layer (`arlesh-rules`) compiled to wasm for the optimistic lane (ADR 0012): the
 * same code the writer runs, so a press shows what the server will answer. Built by
 * `scripts/build-rules-wasm.sh` into `src/wasm/pkg` (gitignored); the declarations there are
 * generated, so every call is typed with no `any` and no `as`.
 *
 * Instantiation is asynchronous and happens once. `initRules()` is awaited at app start, before the
 * first render (see `main.tsx`), and the vitest setup file instantiates the module synchronously
 * from disk, so a rule call never has to wait or to check.
 */
export {
  altStep,
  mayParent,
  nextStatus,
  planRefusal,
  planTriage,
  statusAfter,
  statusBlock,
  takeOut,
  verdictAfter,
} from "@/wasm/pkg/arlesh_rules_wasm";
export type {
  NodeKindWire,
  PlanRowInput,
  ScopeKeyWire,
  StatusPrediction,
  SubItemsWire,
  TaskStatusWire,
  TimeScopeWire,
  TriageIds,
  VerdictWire,
} from "@/wasm/pkg/arlesh_rules_wasm";

let ready: Promise<void> | null = null;

/** Instantiates the module once; later calls return the same promise. */
export function initRules(): Promise<void> {
  ready ??= init({ module_or_path: wasmUrl }).then(() => undefined);
  return ready;
}

/** Instantiates the module from its bytes, synchronously. For tests, which have no network. */
export function initRulesSync(bytes: BufferSource): void {
  initSync({ module: bytes });
  ready = Promise.resolve();
}
