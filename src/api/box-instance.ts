/**
 * The name of the box instance this app is, or `null` when it is not one.
 *
 * `scripts/box.py` starts each instance's own Vite server with `VITE_ARLESH_BOX` set to the branch,
 * which Vite exposes as `import.meta.env`. A release build and a plain `npm run tauri dev` never
 * set it, so there the answer is `null` rather than an empty-looking name.
 */
export function boxInstanceName(): string | null {
  const name: unknown = import.meta.env["VITE_ARLESH_BOX"];
  return typeof name === "string" && name !== "" ? name : null;
}
