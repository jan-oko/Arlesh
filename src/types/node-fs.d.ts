/*
 * The project has no `@types/node`: the app is a browser bundle and has no business reaching for
 * the filesystem. Tests do, occasionally — a stylesheet is only readable as text from disk, since
 * importing a CSS module yields its class-name map. This declares the one function used for that,
 * rather than pulling in the whole Node surface area for the sake of it.
 */
declare module "node:fs" {
  export function readFileSync(path: string, encoding: "utf8"): string;
}
