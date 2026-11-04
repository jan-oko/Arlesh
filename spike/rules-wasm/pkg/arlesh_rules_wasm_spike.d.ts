/* tslint:disable */
/* eslint-disable */

/** Hand-written in the spike; ADR 0015 generates these from the models. */
export type ScopeKeyWire = { kind: string; date?: string; part?: string; start?: string; end?: string };
export type TimeScopeWire = { start_id: ScopeKeyWire; end_id: ScopeKeyWire };


/**
 * A planning pass: the scope it plans into, that scope's parent, and the rows.
 */
export interface TriageCall {
    target: ScopeKeyWire;
    parent: ScopeKeyWire | null;
    rows: TriageRow[];
}

/**
 * One row a planning pass reads, in the corpus' (and the board's) camelCase.
 */
export interface TriageRow {
    id: string;
    virtual?: boolean;
    timeScope?: TimeScopeWire | null;
    plan?: TimeScopeWire | null;
    inheritedPlan?: TimeScopeWire | null;
    emptyPlan?: boolean;
    overdue?: boolean;
    ancestors?: { timeScope?: TimeScopeWire | null }[];
}

/**
 * The three heaps, by row id.
 */
export interface TriageIds {
    unplanned: string[];
    planned: string[];
    parentPlanned: string[];
}

/**
 * What a status gesture leaves, as the board's `StatusPrediction` spells it.
 */
export type StatusPrediction = { outcome: "written"; status: { kind: "ordinary" | "agentic"; status: string } } | { outcome: "refused"; reason: "compound" | "alt_enter_agentic_not_doing" };


/**
 * `tasks::rules::plan::triage`, through serde-wasm-bindgen.
 */
export function planTriage(call: TriageCall): TriageIds;

/**
 * The same, through one JSON string each way.
 */
export function planTriageJson(call: string): string;

/**
 * `tasks::rules::gestures::status_after`, through serde-wasm-bindgen. tsify only declares the
 * types: its `into_wasm_abi`/`from_wasm_abi` are deprecated (they leak, tsify#65).
 */
export function statusAfter(step: "advance" | "alt", current: { kind: "ordinary" | "agentic"; status: string }, compound: boolean): StatusPrediction;

/**
 * The same, through one JSON string each way.
 */
export function statusAfterJson(call: string): string;

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
    readonly memory: WebAssembly.Memory;
    readonly planTriage: (a: any) => [number, number, number];
    readonly planTriageJson: (a: number, b: number) => [number, number, number, number];
    readonly statusAfter: (a: any, b: any, c: number) => [number, number, number];
    readonly statusAfterJson: (a: number, b: number) => [number, number, number, number];
    readonly __wbindgen_malloc: (a: number, b: number) => number;
    readonly __wbindgen_realloc: (a: number, b: number, c: number, d: number) => number;
    readonly __wbindgen_free: (a: number, b: number, c: number) => void;
    readonly __wbindgen_exn_store: (a: number) => void;
    readonly __externref_table_alloc: () => number;
    readonly __wbindgen_externrefs: WebAssembly.Table;
    readonly __externref_table_dealloc: (a: number) => void;
    readonly __wbindgen_start: () => void;
}

export type SyncInitInput = BufferSource | WebAssembly.Module;

/**
 * Instantiates the given `module`, which can either be bytes or
 * a precompiled `WebAssembly.Module`.
 *
 * @param {{ module: SyncInitInput }} module - Passing `SyncInitInput` directly is deprecated.
 *
 * @returns {InitOutput}
 */
export function initSync(module: { module: SyncInitInput } | SyncInitInput): InitOutput;

/**
 * If `module_or_path` is {RequestInfo} or {URL}, makes a request and
 * for everything else, calls `WebAssembly.instantiate` directly.
 *
 * @param {{ module_or_path: InitInput | Promise<InitInput> }} module_or_path - Passing `InitInput` directly is deprecated.
 *
 * @returns {Promise<InitOutput>}
 */
export default function __wbg_init (module_or_path?: { module_or_path: InitInput | Promise<InitInput> } | InitInput | Promise<InitInput>): Promise<InitOutput>;
