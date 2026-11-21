import { describe, it, expect } from "vitest";
import { cratesOf, crateFor, drift, minorOf } from "./check-tauri-versions.mjs";

const cargo = (...pairs) =>
  pairs.map(([n, v]) => `[[package]]\nname = "${n}"\nversion = "${v}"\n`).join("\n");
const npm = (versions) =>
  JSON.stringify({
    packages: Object.fromEntries(
      Object.entries(versions).map(([n, v]) => [`node_modules/@tauri-apps/${n}`, { version: v }]),
    ),
  });

describe("check-tauri-versions", () => {
  it("reads major.minor", () => {
    expect(minorOf("2.12.5")).toBe("2.12");
    expect(minorOf("x")).toBeNull();
  });

  it("reads crates from a Cargo.lock", () => {
    expect(cratesOf(cargo(["tauri", "2.12.5"], ["serde", "1.0.1"])).get("tauri")).toBe("2.12.5");
  });

  it("pairs api and cli with tauri, plugins with their crate, and skips platform binaries", () => {
    expect(crateFor("api")).toBe("tauri");
    expect(crateFor("cli")).toBe("tauri");
    expect(crateFor("plugin-opener")).toBe("tauri-plugin-opener");
    expect(crateFor("cli-linux-x64-gnu")).toBeNull();
  });

  it("accepts differing patch versions", () => {
    expect(drift(npm({ api: "2.12.1", cli: "2.12.6" }), cargo(["tauri", "2.12.5"]))).toEqual([]);
  });

  it("names a package on another minor", () => {
    const out = drift(
      npm({ api: "2.11.1", "plugin-opener": "2.4.0", "cli-linux-x64-gnu": "2.1.0" }),
      cargo(["tauri", "2.12.5"], ["tauri-plugin-opener", "2.5.4"]),
    );
    expect(out).toEqual([
      "tauri (v2.12.5) : @tauri-apps/api (v2.11.1)",
      "tauri-plugin-opener (v2.5.4) : @tauri-apps/plugin-opener (v2.4.0)",
    ]);
  });

  it("ignores a package whose crate is not in the lock", () => {
    expect(drift(npm({ "plugin-os": "2.0.0" }), cargo(["tauri", "2.12.5"]))).toEqual([]);
  });
});
