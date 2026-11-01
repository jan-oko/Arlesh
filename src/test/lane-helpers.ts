import type { PendingWrite } from "@/utils/pending-writes";
import { usePendingWritesStore } from "@/stores/use-pending-writes-store";

/** A promise a test settles by hand, to hold a write in flight. */
export interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason: unknown) => void;
}

export function deferred<T>(): Deferred<T> {
  let resolve: (value: T) => void = () => undefined;
  let reject: (reason: unknown) => void = () => undefined;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

/** The window's lane as it stands. */
export function lane(): readonly PendingWrite[] {
  return usePendingWritesStore.getState().writes;
}

/** The fields each pending write is showing, oldest first. */
export function patchedFields(): unknown[] {
  return lane().map((write) => (write.patch.kind === "fields" ? write.patch.fields : write.patch));
}
