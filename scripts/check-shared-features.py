#!/usr/bin/env python3
"""Fails when the app build and the server module build resolve a shared crate differently.

The point of crates/arlesh-workspace-hack is that `arlesh-rules`, `arlesh-core` and
`arlesh-backend`, and every crate under them, are the same cargo unit whether the desktop app or the
server's native module is built, so the two builds share one compiled copy in box's shared target.
This measures that directly, with no compile. It asks cargo for the unit graph of

  - the app:    cargo build -p arlesh --bin arlesh
  - the module: cargo rustc -p arlesh-py --lib --features pyo3/extension-module   (what maturin runs)

and walks every unit at or below a shared crate, target side and host side (build scripts and proc
macros: proc-macro2's `span-locations` once split serde that way). A unit is identified by its
package, target kind, features, mode and profile; a unit that differs, or is in one graph only, is
printed with both sides. That also catches what hakari cannot: a workspace crate's own feature
(`arlesh-backend/sqlite`) named by one root and not the other, and a hand-written line in the hack's
manifest (`[dependencies.quote]`) going stale.

`cargo --unit-graph` is unstable; RUSTC_BOOTSTRAP=1 lets the pinned stable toolchain run it. The
toolchain is pinned by rust-toolchain.toml, so the output format is too.

Usage: scripts/check-shared-features.py    (from anywhere in the repository)
"""

import json
import os
import subprocess
import sys
from pathlib import Path

SHARED = ("arlesh-rules", "arlesh-core", "arlesh-backend")
UNSTABLE = ["--unit-graph", "-Z", "unstable-options"]
ROOTS = {
    "app": ["build", "-p", "arlesh", "--bin", "arlesh"],
    "module": ["rustc", "-p", "arlesh-py", "--lib", "--features", "pyo3/extension-module"],
}

Unit = tuple[str, str, str, str, str]


def unit_graph(cargo_args: list[str]) -> dict:
    """The unit graph of one build, resolved from the lockfile; nothing is compiled."""
    result = subprocess.run(
        ["cargo", cargo_args[0], "--locked", *cargo_args[1:], *UNSTABLE],
        capture_output=True, text=True, env={**os.environ, "RUSTC_BOOTSTRAP": "1"},
    )
    if result.returncode != 0:
        sys.exit(f"cargo {' '.join(cargo_args)} failed (a stale Cargo.lock?):\n{result.stderr}")
    return json.loads(result.stdout)


def package_name(pkg_id: str) -> str:
    """`registry+...#tokio@1.52.3` and `path+file:///x/crates/arlesh-core#1.0.0` to a name."""
    head, _, tail = pkg_id.partition("#")
    if "@" in tail:
        return tail.split("@")[0]
    return head.rstrip("/").rsplit("/", 1)[-1]


def describe(unit: dict) -> Unit:
    """What makes a unit this unit: the same description means the same compiled artifact."""
    profile = unit["profile"]
    return (
        f"{package_name(unit['pkg_id'])} {unit['pkg_id'].rsplit('#', 1)[-1].rsplit('@', 1)[-1]}",
        "/".join(unit["target"]["kind"]),
        ",".join(sorted(unit["features"])),
        unit["mode"],
        f"{profile['name']} opt{profile['opt_level']} debug{profile['debuginfo']}",
    )


def shared_units(graph: dict) -> dict[str, set[Unit]]:
    """Every unit at or below a shared crate's library, grouped by package, kind and mode."""
    units = graph["units"]
    stack = [
        index for index, unit in enumerate(units)
        if package_name(unit["pkg_id"]) in SHARED and unit["target"]["kind"] == ["lib"]
    ]
    seen: set[int] = set()
    while stack:
        index = stack.pop()
        if index in seen:
            continue
        seen.add(index)
        stack.extend(dep["index"] for dep in units[index]["dependencies"])
    found: dict[str, set[Unit]] = {}
    for index in seen:
        unit = units[index]
        description = describe(unit)
        key = f"{description[0]} {description[1]} {description[3]}"
        found.setdefault(key, set()).add(description)
    return found


def features(side: dict[str, set[Unit]], key: str) -> str:
    """The feature sets (and profiles) one build gives a package, or `absent`."""
    return "; ".join(sorted(f"[{unit[2]}] {unit[4]}" for unit in side[key])) if key in side else "absent"


def main() -> int:
    os.chdir(Path(__file__).resolve().parent.parent)
    app = shared_units(unit_graph(ROOTS["app"]))
    module = shared_units(unit_graph(ROOTS["module"]))
    problems = []
    for key in sorted(set(app) | set(module)):
        if app.get(key) != module.get(key):
            problems.append(f"  {key}\n    app:    {features(app, key)}\n    module: {features(module, key)}")
    if problems:
        print("The app and the server module resolve these shared crates differently, so each one")
        print("compiles twice into box's shared target (features, mode, profile):\n")
        print("\n".join(problems))
        print("\nFix: install the tool with `cargo install cargo-hakari --locked --version 0.9.39`,")
        print("run `cargo hakari generate && cargo hakari manage-deps --yes`, commit the result.")
        print("A feature of a workspace crate (arlesh-backend/sqlite) is named in both roots'")
        print("manifests by hand; a crate hakari cannot unify is named by hand in")
        print("crates/arlesh-workspace-hack/Cargo.toml above hakari's section.")
        return 1
    print(f"Shared crates resolve identically in both builds ({len(app)} units checked).")
    return 0


if __name__ == "__main__":
    sys.exit(main())
