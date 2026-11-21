import { describe, it, expect } from "vitest";
import { crateFor, drift, minorOf, packagesOf, resolvedVersion } from "./check-tauri-versions.mjs";

const cargo = (...pkgs) =>
  pkgs
    .map(([n, v, deps = []]) => {
      const list = deps.length ? `dependencies = [\n${deps.map((d) => ` "${d}",`).join("\n")}\n]\n` : "";
      return `[[package]]\nname = "${n}"\nversion = "${v}"\n${list}`;
    })
    .join("\n");
const npm = (versions) =>
  JSON.stringify({
    packages: Object.fromEntries(
      Object.entries(versions).map(([n, v]) => [`node_modules/@tauri-apps/${n}`, { version: v }]),
    ),
  });

describe("check-tauri-versions", () => {
  it("reads major.minor, a pre-release counting as its minor", () => {
    expect(minorOf("2.12.5")).toBe("2.12");
    expect(minorOf("2.13.0-rc.1")).toBe("2.13");
    expect(minorOf("x")).toBeNull();
  });

  it("pairs api with tauri and plugins with their crate; the CLI and its binaries have none", () => {
    expect(crateFor("api")).toBe("tauri");
    expect(crateFor("plugin-opener")).toBe("tauri-plugin-opener");
    expect(crateFor("cli")).toBeNull();
    expect(crateFor("cli-linux-x64-gnu")).toBeNull();
  });

  it("does not compare the CLI", () => {
    expect(drift(npm({ cli: "2.11.3" }), cargo(["tauri", "2.12.5"]))).toEqual([]);
  });

  it("accepts differing patch versions", () => {
    expect(drift(npm({ api: "2.12.1" }), cargo(["tauri", "2.12.5"]))).toEqual([]);
  });

  it("names a package on another minor", () => {
    const out = drift(
      npm({ api: "2.11.1", "plugin-opener": "2.4.0" }),
      cargo(["tauri", "2.12.5"], ["tauri-plugin-opener", "2.5.4"]),
    );
    expect(out).toEqual([
      "tauri (v2.12.5) : @tauri-apps/api (v2.11.1)",
      "tauri-plugin-opener (v2.5.4) : @tauri-apps/plugin-opener (v2.4.0)",
    ]);
  });

  it("treats a pre-release as its major.minor", () => {
    expect(drift(npm({ api: "2.13.0-rc.1" }), cargo(["tauri", "2.13.1"]))).toEqual([]);
    expect(drift(npm({ api: "2.13.0-rc.1" }), cargo(["tauri", "2.12.5"]))).toHaveLength(1);
  });

  it("ignores a package whose crate is not in the lock", () => {
    expect(drift(npm({ "plugin-os": "2.0.0" }), cargo(["tauri", "2.12.5"]))).toEqual([]);
  });

  it("picks the version the app crate depends on when the lock holds several", () => {
    const lock = cargo(
      ["tauri", "2.11.3"],
      ["tauri", "2.12.5"],
      ["arlesh", "1.0.0", ["serde", "tauri 2.12.5"]],
    );
    expect(resolvedVersion(packagesOf(lock), "tauri", "arlesh")).toBe("2.12.5");
    expect(drift(npm({ api: "2.12.1" }), lock)).toEqual([]);
    expect(drift(npm({ api: "2.11.1" }), lock)).toHaveLength(1);
  });

  it("says so when several versions exist and the app crate names none", () => {
    const lock = cargo(["tauri", "2.11.3"], ["tauri", "2.12.5"], ["arlesh", "1.0.0", ["serde"]]);
    expect(drift(npm({ api: "2.12.1" }), lock)[0]).toContain("cannot tell");
  });

  it("does not pass silently on an unparsable version", () => {
    expect(drift(npm({ api: "latest" }), cargo(["tauri", "2.12.5"]))[0]).toContain("cannot be compared");
  });
});
