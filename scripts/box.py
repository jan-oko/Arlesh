#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.11"
# dependencies = []
# ///
"""Build and run isolated Arlesh instances per branch worktree: `npm run box -- <command>`.

    box list [--json]
    box devices add <name> --os android|desktop [--host host[:port]] [--serial S] [--ssh [user@]host[:port]]
    box devices list
    box devices rm <name>
    box run <branch> [<target>] [--server <branch> | --standalone] [--no-firebase] [--force] [--stale-ok]
            [--local | --ci] [--reinstall] [--local-seed]
    box keystore init [--force]
    box keystore rotate-password
    box stop [branch ... | all]
    box clean [branch ... | all]
    box prune [<target>] [-y | --dry-run]
    box server start <branch> [--public] [--local-seed]
    box server stop [branch ... | all]
    box server token <branch> <arlesh-server token args...>
    box server pin <branch> approve <pin> [--name <device>] | list
    box seed set <url>            (the backup token is read from stdin or a prompt, never argv)
    box seed show
    box reseed <branch> [-y]

`list` is driven by the open PRs (`gh pr list` on origin's repo): one row per open-PR branch with its
worktree, sync with origin, builds and installs, server and app; below a separator, `dev`, `master`
and any worktree with no open PR ("prunable"). Without an authenticated gh it shows the worktrees.
`prune` prints its plan, then asks `Proceed? [y/N]`; `-y` applies without asking, `--dry-run` only
prints, and with no terminal and no `-y` it exits non-zero rather than wait. It removes each worktree whose branch has
no open PR, never the main checkout, `dev`, `master`, the current directory's worktree, or one with
uncommitted or unpushed work: it stops that branch's server and app, drops its Firebase app and
device installs, runs `git worktree remove` (no --force), and deletes the local branch only when it
is merged into origin/dev or origin/master or its PR was merged. Remote branches are never touched.
Orphaned box apps are pruned as before. Without gh, only the apps are pruned.

`list` is driven by the open PRs (`gh pr list` on origin's repo): one row per open-PR branch with its
worktree, sync with origin, builds and installs, server and app; below a separator, `dev`, `master`
and any worktree with no open PR ("prunable"). Without an authenticated gh it shows the worktrees.
`prune` prints its plan, then asks `Proceed? [y/N]`; `-y` applies without asking, `--dry-run` only
prints, and with no terminal and no `-y` it exits non-zero rather than wait. It removes each worktree whose branch has
no open PR, never the main checkout, `dev`, `master`, the current directory's worktree, or one with
uncommitted or unpushed work: it stops that branch's server and app, drops its Firebase app and
device installs, runs `git worktree remove` (no --force), and deletes the local branch only when it
is merged into origin/dev or origin/master or its PR was merged. Remote branches are never touched.
Orphaned box apps are pruned as before. Without gh, only the apps are pruned.

A branch with no worktree gets `.claude/worktrees/<branch with / as ->` made from origin/<branch>
(`run`, `server start|token|pin`); an existing one is used as-is.

`run` builds only when the branch's worktree changed since the last successful build (a hash of
HEAD plus the uncommitted diff, per branch and per OS), installs on an Android device only when
that device does not hold this build, and always launches. The target is `desktop` (this machine, built in) or a device registered
with `box devices add`; leave it out to reuse the last one. Devices live in
$XDG_CONFIG_HOME/arlesh/box-devices.json, never in the repo; build stamps live in
$XDG_STATE_HOME/arlesh/box/.

Desktop: every branch compiles into the ONE shared target directory of the main checkout, and only
the per-branch binary is kept. A debug Tauri build loads its frontend from tauri.conf.json's
`devUrl`, so each instance has its own Vite dev server on its own port. The window title, the port
and the GTK app id are baked in at build time, so tauri.conf.json is patched for the length of the
build and restored, also when the build fails or is signalled. XDG_DATA_HOME / XDG_CONFIG_HOME point
at a per-instance directory, which isolates the database, localStorage and persisted state.

Android: the package is com.atai.arlesh.box.<branch> and the label "Arlesh (<branch>)", so it
installs beside the real app; build.gradle.kts and strings.xml are patched for the build and
restored. Needs ANDROID_HOME, ANDROID_NDK_HOME and a JDK
(ARLESH_BOX_JAVA_HOME wins over JAVA_HOME). Never pairs: pair once by hand with `adb pair`.
Settings file: $XDG_CONFIG_HOME/arlesh/box.env, beside box-devices.json, is read at startup; a missing
file does nothing. One `KEY=value` per line; blank lines and `#` comments are skipped; an `export `
prefix and a pair of single or double quotes around the value are accepted; `$HOME`, `${HOME}` and a
leading `~` in the value are expanded. A variable already set in the real environment wins over the
file. A malformed line stops box and names its line number, never its value. Typical keys:
ARLESH_BOX_FIREBASE_PROJECT, ARLESH_FCM_CREDENTIALS_FILE, ARLESH_BACKUP_TOKEN, ARLESH_BOX_SEED_URL.
Firebase, per branch: with ARLESH_BOX_FIREBASE_PROJECT set and gcloud application-default
credentials, the package is registered as an Android app and its config written as a gitignored
google-services.json; --no-firebase turns it off.

CI builds: for an Android target whose worktree is clean, with HEAD pushed (equal to
origin/<branch>) and a successful bundles.yml box run for exactly that commit, `run` downloads that
run's APK (`gh run download`) instead of building, then installs, pre-binds and launches as usual.
It is cached per commit in $XDG_STATE_HOME/arlesh/box/ci/. Otherwise, or with `--local`, it builds
locally. `--ci` uses CI even when box would build: with no build for HEAD it triggers bundles.yml
(box=true, publish=false) on the branch, waits with progress output, then downloads; on a dirty or
unpushed tree it is an error. Without an authenticated gh, `run` builds locally with a notice
(`--ci` fails). `run` says which source it used. Desktop targets always build locally.

Signing: every box APK, local or CI, is signed with ONE box-only keystore, so they update one
another. `keystore init` creates $XDG_CONFIG_HOME/arlesh/box.keystore (alias arlesh-box, 10000 days; a
debug-grade key for com.atai.arlesh.box.* only) under a random password kept beside it in
box.keystore.password (mode 600), and uploads both as repo secrets with `gh secret set`:
ARLESH_BOX_KEYSTORE_B64 and ARLESH_BOX_KEYSTORE_PASSWORD (it refuses to replace an existing
keystore without --force; replacing means reinstalling every box app). `keystore rotate-password`
moves a keystore made with the old fixed password onto a random one, keeping the same key. Local builds sign with it
when it exists, else with ~/.android/debug.keystore and a notice. CI (bundles.yml box mode) signs
with the secret when set, else with a fresh key and a warning. On INSTALL_FAILED_UPDATE_INCOMPATIBLE
`run` stops and offers `--reinstall`, which uninstalls first (the token is re-provisioned).

Seeding: a new branch database (the server's, and the desktop instance's) starts as a copy of the
production database, which lives on the arlesh-server. `seed set <url>` keeps the server's URL in
$XDG_CONFIG_HOME/arlesh/box-seed-url and the admin backup token (the server's ARLESH_BACKUP_TOKEN)
in box-seed.token (mode 600); ARLESH_BOX_SEED_URL and ARLESH_BACKUP_TOKEN override them, and
`seed show` says what is set without printing the token. When both are set, a seeding downloads
`GET <url>/backup` once per box invocation (cached in $XDG_STATE_HOME/arlesh/box/seed/, removed at
exit) and uses it for both seeds; a failed download stops with the reason, and `--local-seed` (on
`run` and `server start`) uses the local desktop copy instead. Unconfigured, the local copy is used,
with a note. `reseed <branch>` downloads a fresh snapshot, stops that branch's server and
instance, replaces their databases (the old ones stay as `<db>.prev`), and starts again what was
running; it asks `Proceed? [y/N]` (`-y` skips). A snapshot whose newest applied migration is above
the branch's newest file in crates/arlesh-core/migrations/ gets a warning: the branch is older than
the server, and its app will refuse that database. Box only ever GETs from the server.

Servers: `server start <branch>` runs arlesh-server from that worktree's own venv, on its own port,
over a seed database (see Seeding). `run` on desktop connects the instance to its
own branch's server (started if it is not up) unless --server picks another or --standalone uses
none. An Android `run` does the same, over a server that listens publicly (restarted public, with a
notice, if it was on loopback): the URL the phone can reach (tailnet or LAN) and a token are handed
to the box app as intent extras, so it starts already connected, without the PIN flow. Either way
the token's client name is the device's name (`desktop` for this machine). `server pin` is for
pairing real (non-box) devices.
"""

from __future__ import annotations

import argparse
import atexit
import base64
import contextlib
import getpass
import hashlib
import ipaddress
import json
import os
import re
import secrets
import shlex
import shutil
import signal
import socket
import sqlite3
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request
from collections.abc import Iterator, Mapping, Sequence
from dataclasses import dataclass, field, replace
from functools import lru_cache
from pathlib import Path
from typing import Any

BOX_PACKAGE_PREFIX = "com.atai.arlesh.box"
LONG_LIVED = ("dev", "master")  # never pruned, always listed
FIREBASE_API = "https://firebase.googleapis.com/v1beta1"
DESKTOP = "desktop"
ANDROID = "android"
OSES = (ANDROID, DESKTOP)
CMD = "npm run box --"
LOCAL_SEED_HELP = "seed from the local desktop database, not the server"
LOOPBACK = "127.0.0.1"
PUBLIC = "0.0.0.0"
STOP_GRACE_SECONDS = 10.0  # SIGTERM, then this long, then SIGKILL
MAIN_ACTIVITY = "com.atai.arlesh.MainActivity"
URL_EXTRA = "arlesh_box_url"
TOKEN_EXTRA = "arlesh_box_token"
BOX_KEY_ALIAS = "arlesh-box"
BOX_KEY_VALIDITY_DAYS = 10000
BOX_KEYSTORE_SECRET = "ARLESH_BOX_KEYSTORE_B64"
BOX_PASSWORD_SECRET = "ARLESH_BOX_KEYSTORE_PASSWORD"
DEBUG_KEY_ALIAS = "androiddebugkey"
# The Android SDK's documented convention: the debug keystore's passwords are the alias without
# its "debugkey" suffix. Handed to keytool and apksigner through the environment, never argv.
ANDROID_DEBUG_STOREPASS_ENV = "ARLESH_BOX_DEBUG_STOREPASS"
BUNDLES_WORKFLOW = "bundles.yml"
AUTO, LOCAL, CI = "auto", "local", "ci"


class BoxError(Exception):
    """A failure to report to the user (exit 1)."""


class UsageError(BoxError):
    """Wrong arguments (exit 2)."""


def die(message: str) -> BoxError:
    return BoxError(message)


def note(message: str) -> None:
    print(message, file=sys.stderr, flush=True)


# ---- Paths and environment ------------------------------------------------------------------------


def home() -> Path:
    return Path(os.environ.get("HOME") or Path.home())


def xdg(var: str, fallback: str) -> Path:
    value = os.environ.get(var)
    return Path(value) if value else home() / fallback


def env_file() -> Path:
    return xdg("XDG_CONFIG_HOME", ".config") / "arlesh" / "box.env"


_ENV_LINE = re.compile(r"^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$")


def parse_env_file(text: str) -> dict[str, str]:
    """Parse `KEY=value` lines. A malformed line is an error naming its number, never its value."""
    values: dict[str, str] = {}
    for number, raw in enumerate(text.splitlines(), start=1):
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        match = _ENV_LINE.match(line)
        if not match:
            raise die(f"{env_file()}: line {number} is not KEY=value")
        key, value = match.group(1), match.group(2).strip()
        if value[:1] in ("'", '"'):
            if len(value) < 2 or value[-1] != value[0]:
                raise die(f"{env_file()}: line {number} has an unterminated quote")
            value = value[1:-1]
        values[key] = os.path.expanduser(os.path.expandvars(value))
    return values


def load_env_file() -> None:
    """Put box.env's values into os.environ, never replacing a variable already set."""
    try:
        text = env_file().read_text(encoding="utf-8")
    except FileNotFoundError:
        return
    except OSError as exc:
        raise die(f"cannot read {env_file()}: {exc.strerror}") from exc
    for key, value in parse_env_file(text).items():
        os.environ.setdefault(key, value)


def config_file() -> Path:
    return xdg("XDG_CONFIG_HOME", ".config") / "arlesh" / "box-devices.json"


def state_dir() -> Path:
    return xdg("XDG_STATE_HOME", ".local/state") / "arlesh" / "box"


def state_file() -> Path:
    return state_dir() / "state.json"


@lru_cache(maxsize=1)
def repo_root() -> Path:
    return Path(__file__).resolve().parent.parent


@lru_cache(maxsize=1)
def main_checkout() -> Path:
    """The main checkout, even when this copy of the script runs from inside a worktree."""
    out = subprocess.run(
        [
            "git",
            "-C",
            str(repo_root()),
            "rev-parse",
            "--path-format=absolute",
            "--git-common-dir",
        ],
        capture_output=True,
        text=True,
        check=False,
    )
    if out.returncode != 0:
        raise die("Not inside a git checkout of Arlesh.")
    return Path(out.stdout.strip()).parent


def worktrees_dir() -> Path:
    return main_checkout() / ".claude" / "worktrees"


def shared_target() -> Path:
    value = os.environ.get("ARLESH_SHARED_TARGET")
    return Path(value) if value else main_checkout() / "src-tauri" / "target"


def instances_dir() -> Path:
    value = os.environ.get("ARLESH_INSTANCES")
    return Path(value) if value else home() / ".cache" / "arlesh" / "instances"


def servers_dir() -> Path:
    # Under a dot directory so no worktree name can collide.
    return instances_dir() / ".servers"


def real_db() -> Path:
    value = os.environ.get("ARLESH_REAL_DB")
    return Path(value) if value else home() / ".local/share/com.atai.arlesh/arlesh.db"


def env_int(name: str, default: int) -> int:
    try:
        return int(os.environ.get(name, default))
    except ValueError:
        return default


def all_names() -> list[str]:
    root = worktrees_dir()
    if not root.is_dir():
        return []
    return sorted(p.name for p in root.iterdir() if p.is_dir())


def dir_name(branch: str) -> str:
    """The worktree directory, instance and server name for a branch: `/` becomes `-`.

    The one place that mapping lives; every name keyed by a branch goes through it.
    """
    return branch.replace("/", "-")


def worktree_path(name: str) -> Path:
    """An existing worktree by directory name, used as-is."""
    path = worktrees_dir() / name
    if not path.is_dir():
        raise die(f"No worktree '{name}'. Try: {CMD} list")
    return path


def git_in(cwd: Path, *args: str) -> subprocess.CompletedProcess[str]:
    return capture(["git", "-C", str(cwd), *args])


def worktree_branch(path: Path) -> str:
    """The branch a worktree has checked out ('' when detached)."""
    return git_in(path, "symbolic-ref", "--quiet", "--short", "HEAD").stdout.strip()


def ref_exists(cwd: Path, ref: str) -> bool:
    return git_in(cwd, "rev-parse", "--verify", "--quiet", ref).returncode == 0


def commit_count(cwd: Path, revs: str) -> int:
    out = git_in(cwd, "rev-list", "--count", revs).stdout.strip()
    return int(out) if out.isdigit() else 0


def report_divergence(cwd: Path, branch: str) -> None:
    """Say if `branch` is behind (or has diverged from) origin; never touches the branch."""
    remote = f"refs/remotes/origin/{branch}"
    if not ref_exists(cwd, remote):
        return
    behind = commit_count(cwd, f"{branch}..{remote}")
    ahead = commit_count(cwd, f"{remote}..{branch}")
    if behind and ahead:
        note(
            f"{branch} has diverged from origin ({ahead} ahead, {behind} behind); not touching it"
        )
    elif behind:
        note(f"{branch} is {behind} commits behind origin; pull to update")


def canonical_branch(given: str) -> str:
    """The branch `given` names: itself, or the branch checked out in the worktree folder of that name.

    `qa/2026-11-round` lives in the folder `qa-2026-11-round`, and either spelling is accepted. A
    folder holding some other branch is not mapped (ensure_worktree reports it).
    """
    path = worktrees_dir() / given
    if "/" not in given and path.is_dir():
        held = worktree_branch(path)
        if held and held != given and dir_name(held) == given:
            return held
    return given


def ensure_worktree(branch: str, report: bool = True) -> Path:
    """The worktree for `branch`, created from origin/<branch> when it is missing.

    An existing worktree is used as-is: never pulled or reset. A branch that exists neither
    locally nor on origin is an error; a new branch is never made off master.
    """
    if (
        not branch
        or branch.startswith("-")
        or git_in(main_checkout(), "check-ref-format", "--branch", branch).returncode
        != 0
    ):
        raise UsageError(f"'{branch}' is not a usable branch name.")
    branch = canonical_branch(branch)
    name = dir_name(branch)
    path = worktrees_dir() / name
    root = main_checkout()
    if path.is_dir():
        held = worktree_branch(path)
        if held != branch:
            raise die(
                f".claude/worktrees/{name} holds {held or 'a detached HEAD'}, not {branch}. "
                + (
                    f"The branch for that folder is {held}: {CMD} run {held}. "
                    if held
                    else ""
                )
                + "Or remove it ('git worktree remove') and pick another branch."
            )
        git_in(
            root, "fetch", "--quiet", "origin", branch
        )  # best effort: only to report
        if report:
            report_divergence(path, branch)
        return path
    fetched = git_in(root, "fetch", "--quiet", "origin", branch)
    remote = f"refs/remotes/origin/{branch}"
    on_origin = ref_exists(root, remote)
    local = ref_exists(root, f"refs/heads/{branch}")
    if not on_origin and not local:
        why = "" if fetched.returncode == 0 else f" ({fetched.stderr.strip()})"
        raise die(
            f"Branch '{branch}' exists neither locally nor on origin{why}. "
            f"Push it first; this tool never creates a branch."
        )
    rel = f".claude/worktrees/{name}"
    sha = git_in(
        root, "rev-parse", "--short", remote if on_origin else branch
    ).stdout.strip()
    where = f"origin/{branch} @ {sha}" if on_origin else f"local only @ {sha}"
    print(f"creating worktree {rel} for {branch} ({where})")
    path.parent.mkdir(parents=True, exist_ok=True)
    if local:
        added = git_in(root, "worktree", "add", str(path), branch)
    else:
        added = git_in(
            root, "worktree", "add", "--track", "-b", branch, str(path), remote
        )
    if added.returncode != 0:
        raise die(f"git worktree add failed: {added.stderr.strip()}")
    if local and on_origin:
        git_in(path, "branch", "--set-upstream-to", f"origin/{branch}", branch)
        report_divergence(path, branch)
    ensure_node_modules(path)
    return path


def sync_worktree(wt: Path, branch: str, stale_ok: bool = False) -> None:
    """Never build a stale commit: fast-forward a clean worktree that is behind origin/<branch>.

    Ahead (unpushed) is fine and silent: it builds locally. Behind and dirty, or diverged, is
    refused unless `stale_ok`, which builds the current HEAD anyway.
    """
    remote = f"refs/remotes/origin/{branch}"
    if not ref_exists(wt, remote):
        return
    behind = commit_count(wt, f"{branch}..{remote}")
    if not behind:
        return
    ahead = commit_count(wt, f"{remote}..{branch}")
    dirty = bool(
        git_in(wt, "status", "--porcelain", "--untracked-files=no").stdout.strip()
    )
    if ahead or dirty:
        state = (
            f"has diverged from origin ({ahead} ahead, {behind} behind)"
            if ahead
            else f"is {behind} commits behind origin and has uncommitted changes"
        )
        if stale_ok:
            note(f"{branch} {state}; building the current HEAD (--stale-ok)")
            return
        fix = (
            f"rebase or merge origin/{branch} in {wt}"
            if ahead
            else f"commit or discard the changes in {wt} so it can fast-forward"
        )
        raise die(
            f"{branch} {state}, so this would build a stale commit. {fix}, "
            f"or pass --stale-ok to build the current HEAD anyway."
        )
    merged = git_in(wt, "merge", "--ff-only", "--quiet", remote)
    if merged.returncode != 0:
        raise die(
            f"{branch} is {behind} commits behind origin but cannot fast-forward: "
            f"{merged.stderr.strip()} (--stale-ok builds the current HEAD anyway)"
        )
    sha = git_in(wt, "rev-parse", "--short", "HEAD").stdout.strip()
    print(f"fast-forwarded {branch} by {behind} commits to origin/{branch} @ {sha}")


def free_gb() -> int:
    return shutil.disk_usage("/").free // (1024**3)


def require_space() -> None:
    need = env_int("ARLESH_MIN_FREE_GB", 5)
    free = free_gb()
    if free < need:
        raise die(
            f"Only {free}G free on /, need {need}G. Run '{CMD} clean' or free space first."
        )


def need_cmd(name: str, hint: str) -> None:
    if shutil.which(name) is None:
        raise die(f"'{name}' is not on PATH. {hint}")


def project_env(extra: dict[str, str] | None = None) -> dict[str, str]:
    """This process's environment, minus what `uv run --script` leaks into a project's own `uv run`.

    `VIRTUAL_ENV` points at the script's environment, so a child `uv run` inside a worktree
    warns that it "does not match the project environment" and ignores it, on every start.
    """
    kept = {
        k: v
        for k, v in os.environ.items()
        if k != "VIRTUAL_ENV"
        and not k.startswith("UV_INTERNAL")
        and k != "UV_RUN_RECURSION_DEPTH"
    }
    return {**kept, **(extra or {})}


def run_cmd(
    cmd: Sequence[str],
    *,
    cwd: Path | None = None,
    env: dict[str, str] | None = None,
    what: str | None = None,
) -> None:
    """Run with inherited stdio; a non-zero exit is a BoxError."""
    result = subprocess.run(list(cmd), cwd=cwd, env=project_env(env), check=False)
    if result.returncode != 0:
        raise die(f"{what or cmd[0]} failed (exit {result.returncode}).")


def capture(
    cmd: Sequence[str], *, cwd: Path | None = None, env: dict[str, str] | None = None
) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        list(cmd),
        cwd=cwd,
        env={**os.environ, **env} if env else None,
        capture_output=True,
        text=True,
        check=False,
    )


# ---- Branch names, packages --------------------------------------------------------------------


def box_segment(branch: str) -> str:
    """One Java package segment: lowercase, [a-z0-9_], never starting with a digit."""
    seg = re.sub(r"[^a-z0-9_]", "_", dir_name(branch).lower())
    if seg == "" or seg[0].isdigit():
        seg = "b" + seg
    return seg


def box_package(branch: str) -> str:
    return f"{BOX_PACKAGE_PREFIX}.{box_segment(branch)}"


def box_label(branch: str) -> str:
    return f"Arlesh ({branch})"


def box_owners(package: str) -> list[str]:
    """The worktrees whose package is `package` (none when its worktree is gone)."""
    return [n for n in all_names() if box_package(n) == package]


# ---- Device registry --------------------------------------------------------------------------


@dataclass(frozen=True)
class Target:
    name: str
    os: str
    host: str | None = None
    adb_serial: str | None = (
        None  # the hardware serial: learned on first sight, or `--serial`
    )
    last_port: str | None = (
        None  # the wireless-debugging port that last worked (it changes)
    )
    ssh: str | None = None  # [user@]host[:port] of a Termux sshd: the install fallback


def load_devices() -> dict[str, Target]:
    path = config_file()
    try:
        raw = json.loads(path.read_text())
    except FileNotFoundError:
        return {}
    except (OSError, ValueError) as exc:
        raise die(f"Cannot read {path}: {exc}") from exc
    found: dict[str, Target] = {}
    for name, entry in (raw.get("devices") or {}).items():
        if isinstance(entry, dict) and entry.get("os") in OSES:
            host = entry.get("host")

            def text(key: str, entry: dict[str, Any] = entry) -> str | None:
                value = entry.get(key)
                return value if isinstance(value, str) and value else None

            found[name] = Target(
                name,
                entry["os"],
                host if isinstance(host, str) else None,
                text("adb_serial"),
                text("last_port"),
                text("ssh"),
            )
    return found


def save_devices(devices: dict[str, Target]) -> None:
    path = config_file()
    path.parent.mkdir(parents=True, exist_ok=True)
    body = {
        "devices": {
            n: {
                "os": t.os,
                **({"host": t.host} if t.host else {}),
                **({"adb_serial": t.adb_serial} if t.adb_serial else {}),
                **({"last_port": t.last_port} if t.last_port else {}),
                **({"ssh": t.ssh} if t.ssh else {}),
            }
            for n, t in sorted(devices.items())
        }
    }
    atomic_write(path, json.dumps(body, indent=2) + "\n")


def atomic_write(path: Path, text: str, mode: int | None = None) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(path.name + ".new")
    tmp.write_text(text)
    if mode is not None:
        tmp.chmod(mode)
    os.replace(tmp, path)


def device_add(
    name: str,
    os_name: str,
    host: str | None,
    serial: str | None = None,
    ssh: str | None = None,
) -> None:
    if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._-]*", name):
        raise UsageError(
            f"'{name}' is not a usable device name (letters, digits, . _ -)."
        )
    if name == DESKTOP:
        raise UsageError("'desktop' is built in: this machine is always a target.")
    if os_name == ANDROID and not (host or serial or ssh):
        raise UsageError(
            "An android device needs --host host[:port] (or --serial <hardware serial>, "
            "or --ssh for the Termux fallback)."
        )
    if os_name == DESKTOP and (host or serial or ssh):
        raise UsageError(
            "A desktop target runs on this machine: --host, --serial and --ssh do not apply."
        )
    if serial and not plausible_serial(serial):
        raise UsageError(
            f"'{serial}' does not look like a hardware serial (see: adb shell getprop ro.serialno)."
        )
    devices = load_devices()
    devices[name] = Target(name, os_name, host, serial, None, ssh)
    save_devices(devices)
    extras = [
        x
        for x in (
            host,
            f"serial {serial}" if serial else "",
            f"ssh {ssh}" if ssh else "",
        )
        if x
    ]
    print(f"registered {name} ({os_name}{', ' + ', '.join(extras) if extras else ''})")


def device_rm(name: str) -> None:
    devices = load_devices()
    if name not in devices:
        raise UsageError(
            f"No device '{name}'. Registered: {', '.join(devices) or 'none'}."
        )
    del devices[name]
    save_devices(devices)
    update_state(lambda s: s["installed"].pop(name, None))
    if load_state()["last_target"] == name:
        record_last_target("")
    print(f"removed {name}")


def device_list() -> None:
    devices = load_devices()
    print(f"{'NAME':<20} {'OS':<8} HOST")
    print(f"{DESKTOP:<20} {DESKTOP:<8} (this machine, built in)")
    for t in devices.values():
        more = "".join(
            f"  [{k} {v}]"
            for k, v in (
                ("serial", t.adb_serial),
                ("ssh", t.ssh),
                ("last port", t.last_port),
            )
            if v
        )
        print(f"{t.name:<20} {t.os:<8} {t.host or '-'}{more}")
    print(f"\nstored in {config_file()}")


def target_names() -> str:
    devices = load_devices()
    parts = [DESKTOP] + [f"{t.name} ({t.os})" for t in devices.values()]
    return ", ".join(parts)


def resolve_target(name: str | None) -> Target:
    """The named target, or the last one used when none is given."""
    if not name:
        last = load_state()["last_target"]
        if last and (last == DESKTOP or last in load_devices()):
            print(f"target: {last} (last used)")
            return resolve_target(last)
        raise UsageError(
            f"Name a target: {CMD} run <branch> <target>\n"
            f"Targets: {target_names()}\n"
            f"Register a device with: {CMD} devices add <name> --os android|desktop [--host h[:p]]"
        )
    if name == DESKTOP:
        return Target(DESKTOP, DESKTOP)
    devices = load_devices()
    if name not in devices:
        raise UsageError(f"Unknown target '{name}'. Targets: {target_names()}")
    return devices[name]


def record_last_target(name: str) -> None:
    update_state(lambda s: s.__setitem__("last_target", name))


# ---- Build stamps ---------------------------------------------------------------------------------


def empty_state() -> dict[str, Any]:
    return {
        "built": {DESKTOP: {}, ANDROID: {}},
        "installed": {},
        "last_target": "",
        "tokens": {},
        "provisioned": {},
    }


def load_state() -> dict[str, Any]:
    state = empty_state()
    try:
        raw = json.loads(state_file().read_text())
    except (OSError, ValueError):
        return state
    if isinstance(raw, dict):
        for os_name in OSES:
            built = raw.get("built", {}).get(os_name)
            if isinstance(built, dict):
                state["built"][os_name] = built
        if isinstance(raw.get("last_target"), str):
            state["last_target"] = raw["last_target"]
        for key in ("installed", "tokens", "provisioned"):
            if isinstance(raw.get(key), dict):
                state[key] = raw[key]
    return state


def update_state(change: Any) -> None:
    state = load_state()
    change(state)
    atomic_write(state_file(), json.dumps(state, indent=2) + "\n")


def worktree_stamp(wt: Path) -> str:
    """Hash of HEAD plus the uncommitted diff (tracked changes and untracked, non-ignored files)."""
    head = capture(["git", "-C", str(wt), "rev-parse", "HEAD"])
    if head.returncode != 0:
        raise die(f"{wt} is not a git worktree.")
    digest = hashlib.sha256()
    digest.update(head.stdout.strip().encode() + b"\0")
    diff = subprocess.run(
        ["git", "-C", str(wt), "diff", "HEAD", "--binary", "--no-ext-diff"],
        capture_output=True,
        check=False,
    )
    digest.update(diff.stdout + b"\0")
    untracked = subprocess.run(
        ["git", "-C", str(wt), "ls-files", "--others", "--exclude-standard", "-z"],
        capture_output=True,
        check=False,
    )
    for raw in sorted(p for p in untracked.stdout.split(b"\0") if p):
        rel = raw.decode(errors="replace")
        # Box's old symlink to the main checkout's node_modules (git-ignored now it is a folder).
        if rel == "node_modules" or rel.startswith("node_modules/"):
            continue
        path = wt / rel
        digest.update(raw + b"\0")
        try:
            if path.is_symlink():
                digest.update(os.readlink(path).encode())
            elif path.is_file():
                digest.update(path.read_bytes())
        except OSError:
            pass
        digest.update(b"\0")
    return digest.hexdigest()


def is_stale(
    os_name: str, branch: str, stamp: str, artifact: Path, force: bool = False
) -> bool:
    if force or not artifact.exists():
        return True
    return load_state()["built"][os_name].get(branch) != stamp


def record_built(os_name: str, branch: str, stamp: str) -> None:
    update_state(lambda s: s["built"][os_name].__setitem__(branch, stamp))


# ---- Patching tracked files for the length of a build ------------------------------------


def backups_dir() -> Path:
    """Backups live outside the source tree: a stray file beside a resource breaks the Android build."""
    return state_dir() / "backups"


def backup_for(original: Path) -> Path:
    """The backup of `original`, keyed by a hash of its absolute path; `<key>.path` records which."""
    key = hashlib.sha256(str(original.resolve()).encode()).hexdigest()[:24]
    return backups_dir() / f"{key}.orig"


def restore_backup(original: Path, backup: Path) -> None:
    if backup.exists():
        os.replace(backup, original)
    backup.with_suffix(".path").unlink(missing_ok=True)


def restore_old_style(original: Path) -> None:
    """Migration: earlier versions left `<name>.box-orig` beside the file; restore it once."""
    legacy = original.with_name(original.name + ".box-orig")
    if legacy.exists():
        os.replace(legacy, original)


@contextlib.contextmanager
def patched(files: Sequence[Path]) -> Iterator[None]:
    """Back the files up, and restore them on exit: success, failure, SIGINT, SIGTERM or SIGHUP."""
    old_handlers: dict[int, Any] = {}

    def on_signal(signum: int, _frame: Any) -> None:
        raise SystemExit(128 + signum)

    for sig in (signal.SIGTERM, signal.SIGHUP):
        old_handlers[sig] = signal.signal(sig, on_signal)
    backups = [(f, backup_for(f)) for f in files]
    try:
        backups_dir().mkdir(parents=True, exist_ok=True)
        for original, backup in backups:
            restore_old_style(original)
            if backup.exists():
                # A killed earlier run left the true original here; the file itself is patched.
                restore_backup(original, backup)
            shutil.copy2(original, backup)
            backup.with_suffix(".path").write_text(str(original.resolve()))
        yield
    finally:
        for original, backup in backups:
            restore_backup(original, backup)
        for sig, handler in old_handlers.items():
            signal.signal(sig, handler)


# ---- Process helpers --------------------------------------------------------------------------


def pid_alive(pid: int) -> bool:
    try:
        os.kill(pid, 0)
    except ProcessLookupError:
        return False
    except PermissionError:
        return True
    return True


def read_pid(pidfile: Path) -> int | None:
    try:
        return int(pidfile.read_text().strip())
    except (OSError, ValueError):
        return None


def signal_target(pid: int, sig: int) -> None:
    """Signal `pid`'s whole group, but only when it is a session leader: a recycled or plain-child
    pid must not have a signal fired into some unrelated process group."""
    try:
        leader = os.getsid(pid) == pid
    except OSError:
        leader = False
    with contextlib.suppress(OSError):
        if leader:
            os.killpg(pid, sig)
        else:
            os.kill(pid, sig)


def stop_pid(pid: int, grace: float = STOP_GRACE_SECONDS) -> bool:
    """SIGTERM `pid` (its group when it leads one), wait up to `grace`, then SIGKILL.

    True when it was alive to begin with.
    """
    if not pid_alive(pid):
        return False
    signal_target(pid, signal.SIGTERM)
    if not wait_gone(pid, grace):
        note(f"  pid {pid} ignored SIGTERM for {grace:g}s: sending SIGKILL")
        signal_target(pid, signal.SIGKILL)
        wait_gone(pid, 3)
    return True


def kill_pidfile(pidfile: Path, what: str, name: str) -> None:
    pid = read_pid(pidfile)
    if pid is not None and stop_pid(pid):
        print(f"stopped {name} {what} (pid {pid})")
    pidfile.unlink(missing_ok=True)


def wait_gone(pid: int, seconds: float) -> bool:
    """Wait for `pid` to exit; a child of ours is reaped so that a zombie does not count as alive."""
    deadline = time.monotonic() + seconds
    while True:
        with contextlib.suppress(ChildProcessError, OSError):
            os.waitpid(pid, os.WNOHANG)
        if not pid_alive(pid):
            return True
        if time.monotonic() >= deadline:
            return False
        time.sleep(0.1)


def lock_holders(db: Path) -> list[int]:
    """Pids holding `<db>.lock` open, from `lsof` or else `fuser`; empty when none or unknowable.

    The lock file records no pid of its own: the lock is the operating system's, not the contents.
    """
    lock = db.with_name(db.name + ".lock")
    if not lock.exists():
        return []
    for cmd in (["lsof", "-t", "--", str(lock)], ["fuser", str(lock)]):
        if shutil.which(cmd[0]) is None:
            continue
        pids = [int(t) for t in re.findall(r"\d+", capture(cmd).stdout)]
        pids = [p for p in pids if p != os.getpid()]
        if pids:
            return pids
    return []


def port_open(port: int, host: str = LOOPBACK) -> bool:
    with socket.socket() as sock:
        sock.settimeout(1)
        return sock.connect_ex((host, port)) == 0


def http_up(url: str) -> bool:
    try:
        with urllib.request.urlopen(url, timeout=2):
            return True
    except (OSError, urllib.error.URLError, ValueError):
        return False


def spawn_detached(
    cmd: Sequence[str],
    pidfile: Path | None,
    log: Path,
    cwd: Path | None,
    env: dict[str, str] | None = None,
) -> int:
    """Start in a new session (so it outlives this shell); the pid recorded is the session leader.

    With no `pidfile` nothing is recorded: the caller writes it once the process proves itself.
    """
    merged = project_env(env)
    with open(log, "wb") as out:
        proc = subprocess.Popen(
            list(cmd),
            cwd=cwd,
            env=merged,
            stdout=out,
            stderr=subprocess.STDOUT,
            stdin=subprocess.DEVNULL,
            start_new_session=True,
        )
    if pidfile is not None:
        pidfile.write_text(str(proc.pid))
    return proc.pid


def lockfile_stamp(wt: Path) -> str:
    """What the worktree's dependencies were installed from: the hash of its `package-lock.json`."""
    lock = wt / "package-lock.json"
    return hashlib.sha256(lock.read_bytes()).hexdigest() if lock.is_file() else ""


def ensure_node_modules(wt: Path) -> None:
    """Give the worktree its own `node_modules`, `npm ci`'d when missing or the lockfile changed.

    Never shared: `npm ci` in one checkout must not pull dependencies out from under another's
    running Vite server, and a branch may add devDependencies the others lack. The stamp lives
    inside `node_modules`, so deleting that folder makes the next run reinstall.
    """
    modules = wt / "node_modules"
    if modules.is_symlink():  # box's old shared link to the main checkout's
        modules.unlink()
    stamp_file = modules / ".arlesh-lock-stamp"
    want = lockfile_stamp(wt)
    if (
        modules.is_dir()
        and stamp_file.is_file()
        and stamp_file.read_text().strip() == want
    ):
        return
    need_cmd("npm", "Install Node.js.")
    print(f"  installing dependencies in {wt.name} (npm ci)")
    done = capture(["npm", "ci", "--no-audit", "--no-fund"], cwd=wt)
    if done.returncode != 0:
        raise die(f"npm ci failed in {wt}: {done.stderr.strip()[-600:]}")
    stamp_file.write_text(want)


# ---- Seeding ----------------------------------------------------------------------------------

SEED_URL_ENV = "ARLESH_BOX_SEED_URL"
SEED_TOKEN_ENV = "ARLESH_BACKUP_TOKEN"
SQLITE_MAGIC = b"SQLite format 3\x00"
PREV_SUFFIXES = ("", "-wal", "-shm")


def seed_url_file() -> Path:
    return xdg("XDG_CONFIG_HOME", ".config") / "arlesh" / "box-seed-url"


def seed_token_file() -> Path:
    return xdg("XDG_CONFIG_HOME", ".config") / "arlesh" / "box-seed.token"


def seed_dir() -> Path:
    return state_dir() / "seed"


@dataclass
class SeedState:
    """What this invocation decided about seeding: forced local, and the snapshot once fetched."""

    local: bool = False
    snapshot: Path | None = None


SEED = SeedState()


@dataclass(frozen=True)
class SeedSource:
    url: str
    token: str = field(repr=False)


def read_text(path: Path) -> str | None:
    try:
        return path.read_text().strip() or None
    except OSError:
        return None


def seed_url() -> tuple[str | None, str]:
    """The configured server URL and where it came from (`env`, `file`, or `unset`)."""
    env = os.environ.get(SEED_URL_ENV, "").strip()
    if env:
        return env.rstrip("/"), "env"
    stored = read_text(seed_url_file())
    return (stored.rstrip("/"), "file") if stored else (None, "unset")


def seed_token() -> tuple[str | None, str]:
    env = os.environ.get(SEED_TOKEN_ENV, "").strip()
    if env:
        return env, "env"
    stored = read_text(seed_token_file())
    return (stored, "file") if stored else (None, "unset")


def seed_source() -> SeedSource | None:
    """The server to seed from; None when none is configured (the local copy is used)."""
    url, _ = seed_url()
    token, _ = seed_token()
    if url is None and token is None:
        return None
    if url is None or token is None:
        missing = "URL" if url is None else "backup token"
        raise die(
            f"The seed server's {missing} is not set. Run `{CMD} seed set <url>` "
            f"(or set {SEED_URL_ENV} and {SEED_TOKEN_ENV}), or pass --local-seed."
        )
    return SeedSource(url, token)


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    """Never follow a redirect: the backup token must go only where the URL says."""

    def redirect_request(self, *args: Any, **kwargs: Any) -> None:
        return None


def download_snapshot(source: SeedSource, dest: Path) -> None:
    """GET `<url>/backup` into `dest` (mode 600), checking it is a SQLite file. The only request
    box makes to the server; it never writes there."""
    request = urllib.request.Request(
        f"{source.url}/backup",
        headers={"Authorization": f"Bearer {source.token}"},
        method="GET",
    )
    dest.parent.mkdir(parents=True, exist_ok=True)
    part = dest.with_name(dest.name + ".part")
    try:
        with urllib.request.build_opener(_NoRedirect).open(
            request, timeout=120
        ) as response:
            part.unlink(missing_ok=True)
            fd = os.open(part, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
            with os.fdopen(fd, "wb") as out:
                shutil.copyfileobj(response, out, 1 << 20)
        with part.open("rb") as f:
            if f.read(len(SQLITE_MAGIC)) != SQLITE_MAGIC:
                raise die(f"{source.url}/backup did not answer a SQLite database.")
        os.replace(part, dest)
    except urllib.error.HTTPError as exc:
        raise die(seed_http_message(source.url, exc.code)) from None
    except (urllib.error.URLError, OSError, ValueError) as exc:
        reason = getattr(exc, "reason", exc)
        raise die(
            f"Cannot download the seed from {source.url}/backup: {reason}. "
            "Fix it, or pass --local-seed to use the local copy."
        ) from None
    finally:
        part.unlink(missing_ok=True)


def seed_http_message(url: str, code: int) -> str:
    why = {
        401: "the backup token was refused (it is the server's ARLESH_BACKUP_TOKEN, not a device token)",
        404: "the server has no /backup (ARLESH_BACKUP_TOKEN is not set on it, or it is too old)",
        429: "too many attempts; try again later",
    }.get(code, f"HTTP {code}")
    return (
        f"Cannot download the seed from {url}/backup: {why}. "
        "Fix it, or pass --local-seed to use the local copy."
    )


def seed_snapshot() -> Path | None:
    """The server snapshot to seed from, downloaded once per invocation; None means the local copy."""
    if SEED.local:
        return None
    if SEED.snapshot is not None:
        return SEED.snapshot
    source = seed_source()
    if source is None:
        return None
    path = seed_dir() / f"snapshot-{os.getpid()}.db"
    print(f"    downloading the seed from {source.url} …", flush=True)
    download_snapshot(source, path)
    atexit.register(path.unlink, missing_ok=True)
    SEED.snapshot = path
    return path


def newest_applied_migration(db: Path) -> int | None:
    try:
        con = sqlite3.connect(f"file:{db}?mode=ro", uri=True)
        try:
            row = con.execute(
                "SELECT MAX(version) FROM _sqlx_migrations WHERE success = 1"
            ).fetchone()
        finally:
            con.close()
    except sqlite3.Error:
        return None
    return int(row[0]) if row and row[0] is not None else None


def newest_branch_migration(wt: Path) -> int | None:
    found = [
        int(m.group(1))
        for f in (wt / "crates" / "arlesh-core" / "migrations").glob("*.sql")
        if (m := re.match(r"(\d+)_", f.name))
    ]
    return max(found) if found else None


def schema_warning(name: str, applied: int | None, branch: int | None) -> str | None:
    if applied is None or branch is None or applied <= branch:
        return None
    return (
        f"!! {name}: the seed is at migration {applied:04d} but this branch's newest is "
        f"{branch:04d}: this branch is older than the server, and the app will refuse "
        "the database. Rebase the branch (or use --local-seed)."
    )


def warn_if_older(snapshot: Path, wt: Path, name: str) -> None:
    message = schema_warning(
        name, newest_applied_migration(snapshot), newest_branch_migration(wt)
    )
    if message:
        note(message)


def copy_local_db(dest: Path) -> None:
    """A consistent copy of the local database through a read-only connection."""
    src = sqlite3.connect(f"file:{real_db()}?mode=ro", uri=True)
    try:
        dst = sqlite3.connect(dest)
        try:
            src.backup(dst)
        finally:
            dst.close()
    finally:
        src.close()


def seed_database(dest: Path, wt: Path, name: str) -> None:
    """Create `dest` from the server snapshot, else (unconfigured or --local-seed) the local copy."""
    snapshot = seed_snapshot()
    if snapshot is not None:
        part = dest.with_name(dest.name + ".seed")
        shutil.copyfile(snapshot, part)
        os.replace(part, dest)
        print(f"    seeded from the server snapshot ({seed_url()[0]})")
        warn_if_older(snapshot, wt, name)
    elif real_db().is_file():
        note(
            f"    seed is local ({real_db()}); `{CMD} seed set <url>` seeds from the server"
        )
        copy_local_db(dest)
        print(f"    seeded from {real_db()} (read-only)")
    else:
        note(f"    no seed: no server configured and no local database at {real_db()}")


def keep_previous(db: Path) -> None:
    """Move `db` and its WAL files aside as `<file>.prev`, replacing an earlier `.prev`."""
    for suffix in PREV_SUFFIXES:
        old = db.with_name(db.name + suffix)
        prev = db.with_name(db.name + suffix + ".prev")
        if old.exists():
            os.replace(old, prev)
        else:
            prev.unlink(missing_ok=True)


def replace_with_snapshot(db: Path, snapshot: Path) -> None:
    keep_previous(db)
    shutil.copyfile(snapshot, db)


def instance_db(name: str) -> Path:
    return instance_dir(name) / "data" / "com.atai.arlesh" / "arlesh.db"


def instance_bound_to(name: str, server: str) -> bool:
    """Whether the instance's mode.json points at `server`'s URL."""
    try:
        mode = json.loads(
            (instance_dir(name) / "data" / "com.atai.arlesh" / "mode.json").read_text()
        )
    except (OSError, ValueError):
        return False
    return (
        isinstance(mode, dict)
        and mode.get("mode") == "client"
        and mode.get("url") == f"http://127.0.0.1:{server_port_for(server)}"
    )


def pidfile_alive(pidfile: Path) -> bool:
    pid = read_pid(pidfile)
    return pid is not None and pid_alive(pid)


def cmd_reseed(args: argparse.Namespace) -> None:
    """Replace a branch's databases with a fresh server snapshot, restarting what was running."""
    name = dir_name(args.branch)
    wt = worktree_path(name)
    candidates = {"server": server_db(name), "desktop instance": instance_db(name)}
    targets = {label: db for label, db in candidates.items() if db.is_file()}
    if not targets:
        raise die(
            f"'{name}' has no database to reseed yet; `{CMD} run {args.branch}` seeds it."
        )
    SEED.local = False
    if seed_source() is None:
        raise die(
            f"Nothing to reseed from: run `{CMD} seed set <url>` first "
            f"(or set {SEED_URL_ENV} and {SEED_TOKEN_ENV})."
        )
    snapshot = (
        seed_snapshot()
    )  # before anything is stopped: a failed download changes nothing
    if snapshot is None:
        raise die("No seed snapshot.")
    has_app = "desktop instance" in targets
    server_was = "server" in targets and server_running(name)
    host = server_host(name)
    app_was = has_app and pidfile_alive(instance_dir(name) / "run.pid")
    vite_was = has_app and pidfile_alive(instance_dir(name) / "vite.pid")
    print(f"reseed {name} from {seed_url()[0]}:")
    for label, db in targets.items():
        print(
            f"  replace the {label} database {db} (the old one stays as {db.name}.prev)"
        )
    if server_was:
        print("  the server is stopped and started again")
    if app_was:
        print("  the app is stopped and started again")
    if not args.yes:
        if not interactive():
            raise die("Not reseeding without a terminal: re-run with -y.")
        if ask("Proceed? [y/N] ").strip().lower() not in ("y", "yes"):
            print("aborted; nothing changed.")
            return
    if has_app:
        stop_instance(name)
    if "server" in targets:
        stop_server(name)
    for db in targets.values():
        replace_with_snapshot(db, snapshot)
        print(f"  replaced {db}")
    warn_if_older(snapshot, wt, name)
    if "server" in targets:
        note(
            f"  tokens issued by '{name}' server are gone with its old database: instances "
            f"and phones connected to it need `{CMD} run` again to get new ones."
        )
    if server_was:
        server_start(name, host)
    if has_app and (app_was or vite_was):
        if server_was and instance_bound_to(name, name):
            connect_instance(name, name, "desktop")
        start_vite(name, wt)
        if app_was:
            launch_desktop(name)


def cmd_seed(args: argparse.Namespace) -> None:
    if args.seed_cmd == "set":
        seed_set(args.url)
    else:
        seed_show()


def seed_set(url: str) -> None:
    if not re.match(r"https?://[^/\s]+", url):
        raise UsageError(f"{url!r} is not an http(s) URL.")
    if sys.stdin.isatty():
        token = getpass.getpass("Backup token (the server's ARLESH_BACKUP_TOKEN): ")
    else:
        token = sys.stdin.read()
    token = token.strip()
    if not token and read_text(seed_token_file()) is None:
        raise die("No token given and none stored: nothing saved.")
    seed_url_file().parent.mkdir(parents=True, exist_ok=True)
    seed_url_file().write_text(url.rstrip("/") + "\n")
    if token:
        write_secret_file(seed_token_file(), token + "\n")
    print(f"seed server: {url.rstrip('/')} (token in {seed_token_file()}, mode 600)")


def seed_show() -> None:
    url, url_from = seed_url()
    token, token_from = seed_token()
    print(f"url:   {f'{url}  [{url_from}]' if url else '(not set)'}")
    print(f"token: {f'set  [{token_from}]' if token else '(not set)'}")
    if url and token:
        print("seeding from the server (--local-seed uses the local copy instead)")
    else:
        print(f"seeding from the local copy {real_db()}")


# ---- Desktop instances ----------------------------------------------------------------------------


def instance_dir(name: str) -> Path:
    return instances_dir() / name


def port_for(name: str) -> int:
    """Assigned once and kept, so a rebuilt instance keeps the port its binary was compiled for."""
    return allocate_port(
        instance_dir(name), instances_dir(), env_int("ARLESH_BASE_PORT", 14200)
    )


def allocate_port(own_dir: Path, siblings_root: Path, base: int) -> int:
    portfile = own_dir / "port"
    if portfile.is_file():
        return int(portfile.read_text().strip())
    taken: set[int] = set()
    if siblings_root.is_dir():
        for f in siblings_root.glob("*/port"):
            with contextlib.suppress(OSError, ValueError):
                taken.add(int(f.read_text().strip()))
    port = base
    while port in taken:
        port += 1
    own_dir.mkdir(parents=True, exist_ok=True)
    portfile.write_text(str(port))
    return port


def desktop_binary(name: str) -> Path:
    return instance_dir(name) / "arlesh"


def build_desktop(name: str, wt: Path) -> None:
    port = port_for(name)
    require_space()
    ensure_node_modules(wt)
    conf = wt / "src-tauri" / "tauri.conf.json"
    target = shared_target()
    print(f"\n=== {name}: tauri debug, port {port} (shared target) ===", flush=True)
    with patched([conf]):
        data = json.loads(conf.read_text())
        data.setdefault("build", {})["devUrl"] = f"http://localhost:{port}"
        for window in data.get("app", {}).get("windows", []):
            window["title"] = f"Arlesh — {name}"
        # With enableGTKAppId the app is a GApplication named com.atai.arlesh, which D-Bus keeps
        # unique per session: a second process hands `activate` to the first and exits without a
        # window. Instances turn it off so they open beside the main app and each other.
        data.setdefault("app", {})["enableGTKAppId"] = False
        conf.write_text(json.dumps(data, indent=2))
        run_cmd(
            [
                "cargo",
                "build",
                "--manifest-path",
                "src-tauri/Cargo.toml",
                "--bin",
                "arlesh",
            ],
            cwd=wt,
            env={"CARGO_TARGET_DIR": str(target)},
            what=f"{name}: cargo build",
        )
    binary = target / "debug" / "arlesh"
    if not os.access(binary, os.X_OK):
        raise die(f"Expected a binary at {binary} and found none.")
    inst = instance_dir(name)
    (inst / "data" / "com.atai.arlesh").mkdir(parents=True, exist_ok=True)
    # Copied beside the old binary and moved over it: a running instance would make copying onto it
    # "Text file busy", while replacing the directory entry leaves the process on its own inode.
    shutil.copy2(binary, inst / "arlesh.new")
    os.replace(inst / "arlesh.new", inst / "arlesh")
    db = inst / "data" / "com.atai.arlesh" / "arlesh.db"
    if not db.exists():
        seed_database(db, wt, name)
    size = (inst / "arlesh").stat().st_size / 1e6
    print(f"=== {name}: ready ({size:.0f}M, port {port}, {free_gb()}G free) ===")


def start_vite(name: str, wt: Path) -> None:
    """Start the instance's own Vite server and wait for it: a debug build loads over HTTP."""
    port = port_for(name)
    url = f"http://localhost:{port}"
    if http_up(url):
        print(f"  {name:<28} vite already up on {port}")
        return
    inst = instance_dir(name)
    spawn_detached(
        ["npm", "run", "dev", "--", "--port", str(port), "--strictPort"],
        inst / "vite.pid",
        inst / "vite.log",
        wt,
    )
    for _ in range(60):
        if http_up(url):
            return
        time.sleep(1)
    raise die(
        f"Vite never came up on port {port} for '{name}' — see {inst / 'vite.log'}"
    )


def launch_desktop(name: str) -> None:
    inst = instance_dir(name)
    kill_pidfile(inst / "run.pid", "app", name)  # a rebuilt window replaces the old one
    pid = spawn_detached(
        [str(desktop_binary(name))],
        inst / "run.pid",
        inst / "run.log",
        None,
        {"XDG_DATA_HOME": str(inst / "data"), "XDG_CONFIG_HOME": str(inst / "config")},
    )
    print(f"  {name:<28} app pid {pid:<8} port {port_for(name):<6} logs {inst}/")


def app_data(name: str) -> Path:
    path = instance_dir(name) / "data" / "com.atai.arlesh"
    path.mkdir(parents=True, exist_ok=True)
    return path


def standalone_instance(name: str) -> None:
    (app_data(name) / "mode.json").write_text('{\n  "mode": "standalone"\n}\n')
    print(f"  {name:<28} Standalone")


def connect_instance(app: str, server: str, device: str) -> None:
    """Bind `app` to `server` as the device `device`: its mode.json and a 0600 token file.

    The token's client name is the device name. Nothing is printed of the token. The instance's
    existing token is kept when it is still the server's live one for that client.
    """
    port = server_port_for(server)
    url = f"http://127.0.0.1:{port}"
    appdir = app_data(app)
    client = client_name(device)
    holder = token_holder(device, app)
    reason = provision_reason(
        force=False,
        record=load_state()["provisioned"].get(device, {}).get(app),
        server=server,
        url=url,
        holder=holder,
        holders=load_state()["tokens"].get(server, {}),
        issued=issued_clients(server),
        client=client,
        has_local_data=(appdir / "server-token").is_file()
        and (appdir / "mode.json").is_file(),
    )
    if reason is None:
        print(f"  {app:<28} already connected to {server} as {client}")
        return
    token = mint_token(server, client, holder)
    tmp = appdir / "server-token.new"
    fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, "w") as f:
        f.write(token)
    os.replace(tmp, appdir / "server-token")
    (appdir / "mode.json").write_text(
        json.dumps({"mode": "client", "url": url, "token_in_file": True}, indent=2)
        + "\n"
    )
    record_provisioned(device, app, server, url)
    print(
        f"  {app:<28} Client mode against server {server} (port {port}) as {client} ({reason})"
    )


def run_desktop(name: str, wt: Path, target: Target, args: argparse.Namespace) -> None:
    stamp = worktree_stamp(wt)
    if is_stale(DESKTOP, name, stamp, desktop_binary(name), args.force):
        build_desktop(name, wt)
        record_built(DESKTOP, name, stamp)
    else:
        print(f"{name}: desktop build is current, not rebuilding.")
    if args.standalone:
        standalone_instance(name)
    else:
        server = args.server or name
        server_start(server)
        connect_instance(name, server, target.name)
    start_vite(name, wt)
    launch_desktop(name)
    print(f"Stop it with: {CMD} stop {name}")


# ---- Servers ----------------------------------------------------------------------------------


def server_dir(name: str) -> Path:
    return servers_dir() / name


def server_db(name: str) -> Path:
    return server_dir(name) / "data" / "arlesh.db"


def server_port_for(name: str) -> int:
    return allocate_port(
        server_dir(name), servers_dir(), env_int("ARLESH_SERVER_BASE_PORT", 14700)
    )


def server_running(name: str) -> bool:
    pid = read_pid(server_dir(name) / "server.pid")
    return pid is not None and pid_alive(pid)


def py_dir(name: str) -> Path:
    return worktree_path(name) / "crates" / "arlesh-py"


def build_server(name: str) -> None:
    pydir = py_dir(name)
    if not (pydir / "pyproject.toml").is_file():
        raise die(
            f"'{name}' has no arlesh-server (no crates/arlesh-py). "
            "Pass --server <branch> to use another branch's server, or --standalone."
        )
    require_space()
    if not (pydir / ".venv" / "bin" / "arlesh-server").exists():
        print(f"building arlesh-py (first start, slow) for '{name}'…", flush=True)
    print(
        f"\n=== server {name}: bindings into its own venv (shared target) ===",
        flush=True,
    )
    env = {"CARGO_TARGET_DIR": str(shared_target())}
    run_cmd(
        [
            "uv",
            "sync",
            "--locked",
            "--all-extras",
            "--python",
            "3.12",
            "--no-install-project",
        ],
        cwd=pydir,
        env=env,
        what=f"{name}: uv sync",
    )
    run_cmd(
        ["uv", "run", "--no-sync", "maturin", "develop", "--uv", "--locked"],
        cwd=pydir,
        env=env,
        what=f"{name}: maturin develop",
    )


def seed_server(name: str) -> None:
    """The server's database, once: the server snapshot, or a read-only copy of the local one."""
    db = server_db(name)
    if db.exists():
        return
    db.parent.mkdir(parents=True, exist_ok=True)
    seed_database(db, worktree_path(name), name)


def server_host(name: str) -> str:
    """The address a running server was started on; loopback when it left no record."""
    with contextlib.suppress(OSError):
        return (server_dir(name) / "host").read_text().strip() or LOOPBACK
    return LOOPBACK


def needs_public_restart(running: bool, current: str, wanted: str) -> bool:
    """Whether a running server must be restarted to listen where a phone can reach it.

    Only loopback to public: a server that is public already serves loopback clients too.
    """
    return running and wanted == PUBLIC and current != PUBLIC


def server_start(name: str, host: str = LOOPBACK, widen: bool = False) -> None:
    """Start `name`'s server. With `widen`, a running loopback server is restarted public."""
    sdir = server_dir(name)
    port = server_port_for(name)
    if server_running(name):
        current = server_host(name)
        if widen and needs_public_restart(True, current, host):
            note(
                f"  server {name} listens on {current}, which a phone cannot reach: "
                f"restarting it on {host} (anyone on the network can reach the port, "
                "but every request needs a token)"
            )
            stop_server(name)
        else:
            print(f"  server {name:<21} already up on {port}")
            if current != host and not (current == PUBLIC and host == LOOPBACK):
                note(
                    f"  (it listens on {current}, not {host}: stop it first to change that)"
                )
            return
    build_server(name)
    seed_server(name)
    log = sdir / "server.log"
    pid = spawn_detached(
        ["uv", "run", "--no-sync", "arlesh-server", "--db", str(server_db(name)),
         "--host", host, "--port", str(port)],
        None,
        log,
        py_dir(name),
    )  # fmt: skip
    # The pid is recorded only once the server answers: a start that fails (the database held by
    # another writer, say) must not displace the record of the server that is really holding it.
    for _ in range(60):
        if http_up(f"http://127.0.0.1:{port}/openapi.json"):
            (sdir / "server.pid").write_text(str(pid))
            (sdir / "host").write_text(host)
            print(f"  server {name:<21} up on {port}, db {server_db(name)}, logs {log}")
            return
        if wait_gone(pid, 0):
            break
        time.sleep(1)
    stop_pid(pid, 3)
    raise die(failed_start_message(name, port, log))


def failed_start_message(name: str, port: int, log: Path) -> str:
    """Why a start failed, naming the process holding the database when that was the reason."""
    text = f"arlesh-server '{name}' never came up on port {port}: see {log}"
    try:
        held = "held by another writer" in log.read_text(errors="replace")
    except OSError:
        held = False
    if not held:
        return text
    holders = lock_holders(server_db(name))
    who = f"pid {', '.join(map(str, holders))}" if holders else "a process"
    kill = (
        f"kill {holders[0]}"
        if holders
        else "find it with: lsof " + str(server_db(name)) + ".lock"
    )
    return (
        f"{text}\nThe database is held by {who} (not this start). "
        f"Stop it with: {CMD} server stop {name}  (or: {kill}; add -9 if it ignores that)"
    )


def server_names(requested: Sequence[str]) -> list[str]:
    if not requested or list(requested) == ["all"]:
        root = servers_dir()
        return (
            sorted(p.name for p in root.iterdir() if p.is_dir())
            if root.is_dir()
            else []
        )
    return [dir_name(b) for b in requested]


def stop_server(name: str) -> None:
    """Stop `name`'s server for good: its process group, then whoever still holds its database.

    SIGTERM, ~10 s, SIGKILL, for the recorded pid's group and again for any other process holding
    `data/arlesh.db.lock` (a server left half-dead by an earlier stop, its pid file already lost).
    Then checks that the port and the lock are really free, and says so when they are not.
    """
    sdir = server_dir(name)
    kill_pidfile(sdir / "server.pid", "server", name)
    for holder in lock_holders(server_db(name)):
        if stop_pid(holder):
            print(f"stopped {name} server holder of the database (pid {holder})")
    left = lock_holders(server_db(name))
    if left:
        note(
            f"  {name}: the database lock is still held by pid {left[0]}; try: kill -9 {left[0]}"
        )
    port_file = sdir / "port"
    if port_file.is_file() and port_open(server_port_for(name)):
        note(f"  {name}: port {server_port_for(name)} is still in use")


def server_stop(requested: Sequence[str]) -> None:
    for name in server_names(requested):
        stop_server(name)


def server_cli(
    name: str, sub: str, args: Sequence[str]
) -> subprocess.CompletedProcess[str]:
    pydir = py_dir(name)
    if (
        not (pydir / ".venv" / "bin" / "arlesh-server").exists()
        or not server_db(name).exists()
    ):
        raise die(
            f"Server '{name}' has no venv or data yet. Run: {CMD} server start {name}"
        )
    return subprocess.run(
        [
            "uv",
            "run",
            "--no-sync",
            "arlesh-server",
            sub,
            *args,
            "--db",
            str(server_db(name)),
        ],
        cwd=pydir,
        env=project_env(),
        capture_output=False,
        text=True,
        check=False,
    )


def server_cli_checked(name: str, sub: str, args: Sequence[str]) -> None:
    if server_cli(name, sub, args).returncode != 0:
        raise BoxError(f"arlesh-server {sub} failed.")


def lan_ip() -> str:
    """This machine's LAN address, on Linux and macOS; empty when it cannot be told."""
    if shutil.which("ip"):
        out = capture(["ip", "-4", "route", "get", "1.1.1.1"]).stdout.split()
        if "src" in out and out.index("src") + 1 < len(out):
            return out[out.index("src") + 1]
    if shutil.which("ipconfig"):
        for iface in ("en0", "en1"):
            ip = capture(["ipconfig", "getifaddr", iface]).stdout.strip()
            if ip:
                return ip
    if shutil.which("hostname"):
        parts = capture(["hostname", "-I"]).stdout.split()
        if parts:
            return parts[0]
    with (
        contextlib.suppress(OSError),
        socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as s,
    ):
        s.connect(
            ("1.1.1.1", 9)
        )  # no packet is sent; it only picks the outgoing interface
        return str(s.getsockname()[0])
    return ""


def tailnet_ip() -> str:
    if not shutil.which("tailscale"):
        return ""
    lines = capture(["tailscale", "ip", "-4"]).stdout.split()
    return lines[0] if lines else ""


def print_connection(name: str, public: bool) -> None:
    """The block `server start` ends with: the one place a token is printed."""
    port = server_port_for(name)
    pydir = py_dir(name)
    base = ["uv", "run", "--no-sync", "arlesh-server", "token"]
    db = str(server_db(name))
    capture([*base, "revoke", "cli", "--db", db], cwd=pydir)
    added = capture([*base, "add", "cli", "--db", db], cwd=pydir)
    if added.returncode != 0:
        raise die(f"Could not mint a token on server '{name}'.")
    print(f"\n── arlesh-server {name} ──\nURL:   http://127.0.0.1:{port}")
    if public:
        if ip := lan_ip():
            print(f"LAN:   http://{ip}:{port}")
        if ip := tailnet_ip():
            print(f"Tailnet: http://{ip}:{port}")
    print(f'Token: {added.stdout.strip()}   (client "cli")')


# ---- Pre-bound clients: tokens named after the device, and a URL the device can reach ------------


def client_name(device: str) -> str:
    """The token's client name for a box device: the device's own name, in the server's alphabet."""
    return re.sub(r"[^A-Za-z0-9._-]", "-", device)[:64] or "device"


def token_holder(device: str, branch: str) -> str:
    """Who holds the live token for a client name: one device may run several branches."""
    return f"{device}/{branch}"


def issued_clients(server: str) -> set[str]:
    """The clients holding a token on `server` (empty when it cannot be listed)."""
    res = capture(
        ["uv", "run", "--no-sync", "arlesh-server", "token", "list",
         "--db", str(server_db(server))],
        cwd=py_dir(server),
    )  # fmt: skip
    if res.returncode != 0:
        return set()
    return {line.split("\t")[0] for line in res.stdout.splitlines() if line.strip()}


def provision_reason(
    *,
    force: bool,
    record: dict[str, Any] | None,
    server: str,
    url: str,
    holder: str,
    holders: dict[str, str],
    issued: set[str],
    client: str,
    has_local_data: bool,
) -> str | None:
    """Why the app must be handed a fresh token, or None when its connection still holds.

    The token text is never stored, so "still holds" is inferred: the app was bound to this
    server at this URL, the server still lists the client, and no other holder has re-minted
    that client's token since.
    """
    if force:
        return "forced"
    if not has_local_data:
        return "no connection on the device yet"
    if not record or record.get("server") != server or record.get("url") != url:
        return "the server or its address changed"
    if client not in issued:
        return "the token is gone from the server"
    if holders.get(client) != holder:
        return "another instance has since taken this device name's token"
    return None


def mint_token(server: str, client: str, holder: str) -> str:
    """A new token for `client` on `server`, replacing any (a client holds one). Never printed."""
    base = ["uv", "run", "--no-sync", "arlesh-server", "token"]
    db = str(server_db(server))
    cwd = py_dir(server)
    if client in issued_clients(server):
        capture([*base, "revoke", client, "--db", db], cwd=cwd)
    added = capture([*base, "add", client, "--db", db], cwd=cwd)
    token = added.stdout.strip()
    if added.returncode != 0 or not token:
        raise die(f"Could not mint a token for '{client}' on server '{server}'.")
    update_state(
        lambda s: s["tokens"].setdefault(server, {}).__setitem__(client, holder)
    )
    return token


def record_provisioned(device: str, branch: str, server: str, url: str) -> None:
    update_state(
        lambda s: (
            s["provisioned"]
            .setdefault(device, {})
            .__setitem__(branch, {"server": server, "url": url})
        )
    )


def pick_server_address(tailnet: str, lan: str) -> str:
    """The address of this machine to hand the phone: the tailnet one when this machine has it
    (Tailscale routes over the LAN when it can), otherwise the LAN one."""
    if tailnet:
        return tailnet
    if lan:
        return lan
    raise die(
        "This machine has neither a tailnet nor a LAN address the phone could reach."
    )


def am_start_argv(serial: str, package: str, url: str, token: str) -> list[str]:
    """`adb shell am start` handing a box build its server and token as intent extras.

    The token is visible in argv to `ps` on the phone while the command runs: acceptable for a
    debug box build. MainActivity ignores the extras unless it is a com.atai.arlesh.box.* build.
    """
    remote = shlex.join(
        ["am", "start", "-n", f"{package}/{MAIN_ACTIVITY}",
         "--es", URL_EXTRA, url, "--es", TOKEN_EXTRA, token]
    )  # fmt: skip
    return ["adb", "-s", serial, "shell", remote]


# ---- Android: tooling and device ------------------------------------------------------------------


def debug_keystore() -> Path:
    value = os.environ.get("ARLESH_BOX_KEYSTORE")
    return Path(value) if value else home() / ".android" / "debug.keystore"


def android_env() -> None:
    sdk = os.environ.get("ANDROID_HOME", "")
    ndk = os.environ.get("ANDROID_NDK_HOME", "")
    if not sdk or not Path(sdk).is_dir():
        raise die("Set ANDROID_HOME to your Android SDK.")
    if not ndk or not Path(ndk).is_dir():
        raise die("Set ANDROID_NDK_HOME to your Android NDK.")
    os.environ["NDK_HOME"] = ndk
    jdk = os.environ.get("ARLESH_BOX_JAVA_HOME") or os.environ.get("JAVA_HOME", "")
    if not jdk or not os.access(Path(jdk) / "bin" / "java", os.X_OK):
        raise die(
            "Set JAVA_HOME (or ARLESH_BOX_JAVA_HOME) to a JDK 17 to 24; the Android Gradle plugin needs one."
        )
    os.environ["JAVA_HOME"] = jdk
    os.environ["PATH"] = os.pathsep.join(
        [f"{jdk}/bin", f"{sdk}/platform-tools", os.environ.get("PATH", "")]
    )


def version_key(p: Path) -> list[Any]:
    return [int(t) if t.isdigit() else t for t in re.split(r"(\d+)", p.name)]


def build_tool(tool: str) -> Path:
    root = Path(os.environ.get("ANDROID_HOME", "")) / "build-tools"
    dirs = (
        sorted((d for d in root.glob("*") if d.is_dir()), key=version_key)
        if root.is_dir()
        else []
    )
    if not dirs or not os.access(dirs[-1] / tool, os.X_OK):
        raise die(f"No '{tool}' under {root}. Install build-tools with sdkmanager.")
    return dirs[-1] / tool


def ensure_debug_keystore() -> None:
    ks = debug_keystore()
    if ks.is_file():
        return
    need_cmd("keytool", "It ships with the JDK.")
    ks.parent.mkdir(parents=True, exist_ok=True)
    made = capture(
        [
            "keytool", "-genkeypair", "-keystore", str(ks),
            *keytool_pass("-storepass", DEBUG_PASS_SOURCE),
            *keytool_pass("-keypass", DEBUG_PASS_SOURCE),
            "-alias", DEBUG_KEY_ALIAS, "-keyalg", "RSA", "-keysize", "2048", "-validity", "10000",
            "-dname", "CN=Android Debug,O=Android,C=US",
        ],
        env=DEBUG_PASS_ENV,
    )  # fmt: skip
    if made.returncode != 0:
        raise die(f"Could not create {ks}.")
    note(f"created {ks}")


ADB_TLS = "_adb-tls-connect._tcp"
ADB_TIMEOUT = (
    8  # seconds for one `adb connect` / `get-state` on a device that may be unreachable
)
MAX_PORT_GUESSES = 3  # discovered ports tried against a tailnet address


@dataclass(frozen=True)
class MdnsEntry:
    service: str
    host: str
    port: str
    txt_serial: str | None = (
        None  # the TXT `serial=` avahi shows; adb's own list has none
    )

    @property
    def hardware_serial(self) -> str | None:
        """The hardware serial: the TXT `serial=`, else the one in an `adb-<serial>-<suffix>` name."""
        if self.txt_serial:
            return self.txt_serial
        m = re.fullmatch(r"adb-(.+)-[^-]+", self.service)
        return m.group(1) if m else None

    @property
    def address(self) -> str:
        return f"{self.host}:{self.port}"


def mdns_entries() -> list[MdnsEntry]:
    """The wireless-debugging endpoints `adb mdns services` lists (_adb-tls-connect)."""
    found: list[MdnsEntry] = []
    for line in capture(["adb", "mdns", "services"]).stdout.splitlines():
        parts = line.split()
        if len(parts) >= 3 and "_adb-tls-connect" in parts[1] and ":" in parts[2]:
            h, _, p = parts[2].rpartition(":")
            found.append(MdnsEntry(parts[0], h, p))
    return found


def avahi_entries() -> list[MdnsEntry]:
    """`avahi-browse -rpt` for wireless debugging: adb's own mdns shares port 5353 with avahi,
    systemd-resolved and Chromium, so on Linux its list is often empty while avahi sees the phone.

    The `=` lines are `;`-separated: `=;iface;proto;name;type;domain;host;address;port;txt`.
    """
    if shutil.which("avahi-browse") is None:
        return []
    out = capture(["avahi-browse", "-rpt", ADB_TLS])
    found: dict[tuple[str, str, str], MdnsEntry] = {}
    for line in out.stdout.splitlines():
        f = line.split(";")
        if len(f) < 9 or f[0] != "=" or f[2] != "IPv4":
            continue
        name = re.sub(r"\\(\d{3})", lambda m: chr(int(m.group(1))), f[3])
        serial = re.search(r'"serial=([^"]*)"', f[9] if len(f) > 9 else "")
        found.setdefault(
            (name, f[7], f[8]),
            MdnsEntry(name, f[7], f[8], serial.group(1) if serial else None),
        )
    return list(found.values())


def discover() -> list[MdnsEntry]:
    """Wireless-debugging endpoints on the LAN: adb's list, else avahi's."""
    return mdns_entries() or avahi_entries()


def host_addresses(host: str) -> set[str]:
    """`host` itself plus every address it resolves to (a MagicDNS or .local name)."""
    addrs = {host}
    with contextlib.suppress(OSError):
        for info in socket.getaddrinfo(host, None, proto=socket.IPPROTO_TCP):
            addrs.add(str(info[4][0]))
    return addrs


TAILNET = ipaddress.ip_network("100.64.0.0/10")


def tailnet_address(addrs: set[str]) -> str | None:
    """A Tailscale address (100.64.0.0/10) among `addrs`, if any."""
    for a in sorted(addrs):
        with contextlib.suppress(ValueError):
            if ipaddress.ip_address(a) in TAILNET:
                return a
    return None


def match_mdns(
    entries: Sequence[MdnsEntry], host: str, adb_serial: str | None
) -> MdnsEntry | None:
    """By adb serial first (tailnet and LAN addresses differ for one phone), then by address."""
    if adb_serial:
        for e in entries:
            if e.hardware_serial == adb_serial:
                return e
    addrs = host_addresses(host)
    return next((e for e in entries if e.host in addrs), None)


def plausible_serial(value: str) -> bool:
    """Whether `value` can be a hardware serial: not an address, a transport name or a placeholder."""
    return not (
        not value
        or value == "unknown"
        or value.startswith("adb-")
        or "_adb" in value
        or ":" in value
        or re.search(r"\s", value)
        or re.fullmatch(r"\d+\.\d+\.\d+\.\d+", value)
    )


def device_serial(transport: str) -> str | None:
    """The hardware serial read off the device: over Wi-Fi `get-serialno` returns the transport
    name, so ask the device itself."""
    out = capture(["adb", "-s", transport, "shell", "getprop", "ro.serialno"])
    value = out.stdout.strip() if out.returncode == 0 else ""
    return value if plausible_serial(value) else None


def transport_serial(transport: str) -> str | None:
    """The serial in an mDNS auto-connect transport name, `adb-<serial>-<suffix>._adb-tls-connect._tcp`."""
    m = re.fullmatch(r"adb-(.+)-[^-.]+\._adb-tls-connect\._tcp\.?", transport)
    return m.group(1) if m else None


def connected_transports() -> list[str]:
    """Names of the transports `adb devices -l` lists in state `device`."""
    names: list[str] = []
    for line in capture(["adb", "devices", "-l"]).stdout.splitlines():
        parts = line.split()
        if len(parts) >= 2 and parts[1] == "device":
            names.append(parts[0])
    return names


def find_connected(
    target: Target, addrs: set[str], port: str, transports: Sequence[str]
) -> str | None:
    """The already-connected transport that is this device, so nothing needs discovering.

    By serial (an mDNS transport's name, or a USB serial), then by an `ip:port` transport whose
    address is one the host resolves to, then by asking each transport for `ro.serialno`.
    """
    serial = target.adb_serial
    if serial:
        for t in transports:
            if t == serial or transport_serial(t) == serial:
                return t
    by_address = [t for t in transports if t.rpartition(":")[0] in addrs]
    if by_address:
        return next(
            (t for t in by_address if port and t.endswith(f":{port}")), by_address[0]
        )
    if serial:
        for t in transports:
            if device_serial(t) == serial:
                return t
    return None


def remember_adb_serial(target: Target, addr: str, entry: MdnsEntry | None) -> None:
    """Store the device's adb serial, and the port that worked, in the registry."""
    found = (entry.hardware_serial if entry else None) or transport_serial(addr)
    if not found or not plausible_serial(found):
        found = device_serial(addr)
    port = addr.rpartition(":")[2] if re.fullmatch(r".+:\d+", addr) else None
    devices = load_devices()
    current = devices.get(target.name)
    if current is None:
        return
    changed = replace(
        current,
        adb_serial=found or current.adb_serial,
        last_port=port or current.last_port,
    )
    if changed != current:
        devices[target.name] = changed
        save_devices(devices)


def adb_connected(addr: str) -> bool:
    """`adb connect` then `get-state`, each bounded: a dead address must not stall the run."""
    try:
        subprocess.run(
            ["adb", "connect", addr],
            capture_output=True, text=True, check=False, timeout=ADB_TIMEOUT,
        )  # fmt: skip
        state = subprocess.run(
            ["adb", "-s", addr, "get-state"],
            capture_output=True, text=True, check=False, timeout=ADB_TIMEOUT,
        )  # fmt: skip
    except subprocess.TimeoutExpired:
        return False
    return state.stdout.strip() == "device"


def connect_candidates(
    target: Target,
    host: str,
    port: str,
    entries: Sequence[MdnsEntry],
    entry: MdnsEntry | None,
    tail: str | None,
) -> list[tuple[str, MdnsEntry | None]]:
    """Addresses to try, best first, each with the discovery entry that suggested it."""
    out: list[tuple[str, MdnsEntry | None]] = []
    if entry:
        # adbd listens on every interface: a tailnet host is reached on the discovered port.
        if tail:
            out.append((f"{tail}:{entry.port}", entry))
        out.append((entry.address, entry))
    elif tail and entries and not target.adb_serial:
        # First run, tailnet name only: neither address nor serial can match the LAN listing.
        # A connect that answers on the tailnet address proves it is the same phone.
        ports = list(dict.fromkeys(e.port for e in entries))[:MAX_PORT_GUESSES]
        out += [(f"{tail}:{p}", next(e for e in entries if e.port == p)) for p in ports]
    for p in (port, target.last_port or ""):
        if host and p:
            out.append((f"{host}:{p}", None))
    return list(dict(out).items())


def resolve_device(target: Target) -> str:
    """The adb transport (serial or host:port) for the device, connected. Never pairs."""
    need_cmd("adb", "Install platform-tools and put it on PATH (or set ANDROID_HOME).")
    host, _, port = (target.host or "").partition(":")
    addrs = host_addresses(host) if host else set()
    found = find_connected(target, addrs, port, connected_transports())
    if found:
        print(f"{target.name}: already connected as {found}")
        remember_adb_serial(target, found, None)
        return found
    entries = discover()
    entry = (
        match_mdns(entries, host, target.adb_serial)
        if host or target.adb_serial
        else None
    )
    tail = tailnet_address(addrs)
    candidates = connect_candidates(target, host, port, entries, entry, tail)
    for addr, hint in candidates:
        if adb_connected(addr):
            remember_adb_serial(target, addr, hint)
            return addr
    seen = (
        "\n".join(f"  {e.service}  {e.address}" for e in entries)
        or "  (nothing found by adb mdns or avahi-browse)"
    )
    tried = ", ".join(a for a, _ in candidates) or "nothing (no port known)"
    label = host or target.adb_serial or target.name
    raise die(
        f"Could not reach {target.name} ({label}) over adb. Tried: {tried}. Discovered:\n{seen}\n"
        f"Turn on Wireless debugging on the device; if it was never paired: "
        f"adb pair {host or '<host>'}:<pairing port> (this tool does not pair). Off the LAN, "
        f"mDNS does not reach you and the wireless-debugging port changes on every toggle: run "
        f"`adb tcpip 5555` once over USB (or Termux) and register the device as "
        f"`{CMD} devices add {target.name} --os android --host {host or '<host>'}:5555`."
    )


def package_installed(serial: str, package: str) -> bool:
    out = capture(["adb", "-s", serial, "shell", "pm", "path", package])
    return out.returncode == 0 and "package:" in out.stdout


def install_reason(serial: str, device: str, branch: str, stamp: str) -> str | None:
    """Why the build must be (re)installed on the device, or None when it already holds it."""
    package = box_package(branch)
    if load_state()["installed"].get(device, {}).get(branch) != stamp:
        return "this build is not the one installed"
    if not package_installed(serial, package):
        return f"{package} is not installed"
    return None


# ---- Android: Firebase ----------------------------------------------------------------------------


class Firebase:
    """Per-branch Android apps in the ARLESH_BOX_FIREBASE_PROJECT project, via the REST API."""

    def __init__(self) -> None:
        self.project = os.environ.get("ARLESH_BOX_FIREBASE_PROJECT", "")
        self.token = ""

    def ready(self) -> bool:
        if self.token:
            return True
        if not self.project:
            note("firebase: ARLESH_BOX_FIREBASE_PROJECT is not set, skipping.")
            return False
        if not shutil.which("gcloud"):
            note("firebase: gcloud is not installed, skipping.")
            return False
        got = capture(["gcloud", "auth", "application-default", "print-access-token"])
        self.token = got.stdout.strip() if got.returncode == 0 else ""
        if not self.token:
            note(
                "firebase: no application-default credentials (gcloud auth application-default login), skipping."
            )
            return False
        return True

    def call(
        self, method: str, path: str, body: dict[str, Any] | None = None
    ) -> dict[str, Any]:
        req = urllib.request.Request(
            f"{FIREBASE_API}/{path}",
            method=method,
            data=json.dumps(body).encode() if body is not None else None,
            headers={
                "Authorization": f"Bearer {self.token}",
                "X-Goog-User-Project": self.project,
                "Content-Type": "application/json",
            },
        )
        try:
            with urllib.request.urlopen(req, timeout=60) as resp:
                payload = json.loads(resp.read() or b"{}")
        except urllib.error.HTTPError as exc:
            self.fail(method, path, exc)
        except (OSError, urllib.error.URLError) as exc:
            raise die(f"firebase: request to {path} failed: {exc}") from exc
        return payload if isinstance(payload, dict) else {}

    def fail(self, method: str, path: str, exc: urllib.error.HTTPError) -> None:
        try:
            error = json.loads(exc.read()).get("error", {})
        except ValueError:
            error = {}
        status, message = error.get("status", ""), error.get("message", "")
        if status == "RESOURCE_EXHAUSTED" or exc.code == 429:
            note(message)
            raise die(
                f"firebase: project {self.project} is out of quota or has hit its limit on Android "
                f"apps. Free some with: {CMD} prune"
            ) from exc
        note(message[:400])
        raise die(
            f"firebase: {method} {path} answered HTTP {exc.code} {f'({status})' if status else ''}."
        ) from exc

    def list_apps(self) -> list[tuple[str, str]]:
        apps: list[tuple[str, str]] = []
        token = ""
        while True:
            suffix = f"&pageToken={token}" if token else ""
            page = self.call(
                "GET", f"projects/{self.project}/androidApps?pageSize=100{suffix}"
            )
            apps += [(a["appId"], a["packageName"]) for a in page.get("apps", [])]
            token = page.get("nextPageToken", "")
            if not token:
                return apps

    def app_id_for(self, package: str) -> str:
        return next((i for i, p in self.list_apps() if p == package), "")

    def ensure_app(self, package: str, label: str) -> str:
        app_id = self.app_id_for(package)
        if app_id:
            return app_id
        op = self.call("POST", f"projects/{self.project}/androidApps",
                       {"packageName": package, "displayName": label})  # fmt: skip
        for _ in range(60):
            res = self.call("GET", op["name"])
            if res.get("done"):
                err = res.get("error")
                if err and err.get("status") == "RESOURCE_EXHAUSTED":
                    raise die(
                        f"firebase: project {self.project} is at its limit of Android apps. Free some with: {CMD} prune"
                    )
                if err:
                    raise die(
                        f"firebase: registering {package} failed: {json.dumps(err)}"
                    )
                return str(res["response"]["appId"])
            time.sleep(2)
        raise die(f"firebase: registering {package} did not finish in time.")

    def write_config(self, app_id: str, dest: Path) -> None:
        cfg = self.call("GET", f"projects/{self.project}/androidApps/{app_id}/config")
        fd = os.open(
            dest / "google-services.json", os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600
        )
        with os.fdopen(fd, "wb") as f:
            f.write(base64.b64decode(cfg["configFileContents"]))

    def remove_package(self, package: str) -> None:
        if not self.ready():
            return
        app_id = self.app_id_for(package)
        if not app_id:
            note(f"firebase: no app for {package}.")
            return
        self.call("POST", f"projects/{self.project}/androidApps/{app_id}:remove",
                  {"immediate": True, "allowMissing": True})  # fmt: skip
        print(f"firebase: removed {package} ({app_id})")


# ---- Android: signing ------------------------------------------------------------------------------
#
# One box-only keystore signs every box APK, local or CI, so a CI build installs over a local one and
# back. It lives at $XDG_CONFIG_HOME/arlesh/box.keystore and, base64, in the repo secret
# ARLESH_BOX_KEYSTORE_B64 (made by `box keystore init`). Its random password sits beside it in
# box.keystore.password (mode 600) and in ARLESH_BOX_KEYSTORE_PASSWORD. It is a debug-grade key, good
# for com.atai.arlesh.box.* only, but a password in the repo is still a leak, so none is written
# here: keytool and apksigner read the password from a file or the environment, never from argv.

PassSource = tuple[str, str]  # ("file", path) or ("env", variable name)


def box_keystore() -> Path:
    return xdg("XDG_CONFIG_HOME", ".config") / "arlesh" / "box.keystore"


def box_password_file() -> Path:
    return box_keystore().with_name(box_keystore().name + ".password")


DEBUG_PASS_SOURCE: PassSource = ("env", ANDROID_DEBUG_STOREPASS_ENV)
DEBUG_PASS_ENV = {ANDROID_DEBUG_STOREPASS_ENV: DEBUG_KEY_ALIAS.removesuffix("debugkey")}


def keytool_pass(option: str, source: PassSource) -> list[str]:
    """`-storepass:file PATH` / `-storepass:env NAME`: keytool's argv-safe forms."""
    return [f"{option}:{source[0]}", source[1]]


def apksigner_pass(source: PassSource) -> str:
    """`file:PATH` / `env:NAME`: apksigner's argv-safe forms."""
    return f"{source[0]}:{source[1]}"


@dataclass(frozen=True)
class Signing:
    keystore: Path
    alias: str
    password: PassSource
    shared: bool  # the box keystore, as opposed to the debug-keystore fallback
    env: Mapping[str, str] = field(
        default_factory=dict
    )  # what `password` reads, if env


def choose_signing() -> Signing:
    """The shared box keystore when it exists, else the debug keystore (made if missing)."""
    shared = box_keystore()
    if shared.is_file():
        pwfile = box_password_file()
        if not pwfile.is_file():
            raise die(
                f"{shared} has no password file ({pwfile}). Run `{CMD} keystore rotate-password` "
                f"if it was made before passwords were random, or `{CMD} keystore init --force` "
                "to make a new one (every installed box app then has to be reinstalled)."
            )
        return Signing(shared, BOX_KEY_ALIAS, ("file", str(pwfile)), True)
    ensure_debug_keystore()
    note(
        f"signing with {debug_keystore()}: CI and local builds are not update-compatible "
        f"until you run `{CMD} keystore init`."
    )
    return Signing(
        debug_keystore(), DEBUG_KEY_ALIAS, DEBUG_PASS_SOURCE, False, DEBUG_PASS_ENV
    )


def origin_repo(cwd: Path) -> str:
    """`owner/name` of the origin remote."""
    url = git_in(cwd, "remote", "get-url", "origin").stdout.strip()
    found = re.search(r"([^/:]+/[^/:]+?)(?:\.git)?/?$", url)
    if not found:
        raise die(f"Cannot read a GitHub repository from the origin remote '{url}'.")
    return found.group(1)


def write_secret_file(path: Path, text: str) -> None:
    """Write `text` to `path`, created with mode 600 so it is never readable by others."""
    path.unlink(missing_ok=True)
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(fd, "w") as f:
        f.write(text)


def set_secret(repo: str, name: str, value: str) -> None:
    """`gh secret set NAME`, the value on stdin so no process list shows it."""
    sent = subprocess.run(
        ["gh", "secret", "set", name, "--repo", repo],
        input=value, capture_output=True, text=True, check=False,
    )  # fmt: skip
    if sent.returncode != 0:
        raise die(f"gh secret set {name} failed: {sent.stderr.strip()}")


def publish_keystore(repo: str, keystore: Path, password: str) -> None:
    """Upload both repo secrets CI signs with; the keystore first, then its password."""
    set_secret(
        repo, BOX_KEYSTORE_SECRET, base64.b64encode(keystore.read_bytes()).decode()
    )
    set_secret(repo, BOX_PASSWORD_SECRET, password)


def require_gh_and_keytool() -> str:
    need_cmd("keytool", "It ships with the JDK.")
    need_cmd("gh", "Install the GitHub CLI and run `gh auth login`.")
    if capture(["gh", "auth", "status"]).returncode != 0:
        raise die("gh is not authenticated. Run `gh auth login`.")
    return origin_repo(repo_root())


def install_keystore(fresh: Path, fresh_pw: Path) -> None:
    """Move a finished keystore and its password file into place."""
    fresh.chmod(0o600)
    os.replace(fresh_pw, box_password_file())
    os.replace(fresh, box_keystore())


def keystore_init(force: bool) -> None:
    ks = box_keystore()
    if ks.exists() and not force:
        raise die(
            f"{ks} exists. Keep it, or pass --force to replace it (every installed box app is "
            "then signed with a new key and has to be reinstalled)."
        )
    repo = require_gh_and_keytool()
    if ks.exists():
        note(
            "!! replacing the box keystore: every box app already installed (any device, local "
            "or CI build) is signed with the old key and must be reinstalled (`run --reinstall`)."
        )
    ks.parent.mkdir(parents=True, exist_ok=True)
    fresh = ks.with_name(ks.name + ".new")
    fresh_pw = box_password_file().with_name(box_password_file().name + ".new")
    fresh.unlink(missing_ok=True)
    password = secrets.token_urlsafe(24)
    write_secret_file(fresh_pw, password)
    try:
        source: PassSource = ("file", str(fresh_pw))
        made = capture([
            "keytool", "-genkeypair", "-keystore", str(fresh),
            *keytool_pass("-storepass", source), *keytool_pass("-keypass", source),
            "-alias", BOX_KEY_ALIAS, "-keyalg", "RSA", "-keysize", "2048",
            "-validity", str(BOX_KEY_VALIDITY_DAYS), "-dname", "CN=Arlesh Box,O=Arlesh,C=US",
        ])  # fmt: skip
        if made.returncode != 0 or not fresh.is_file():
            raise die(f"keytool could not create the keystore: {made.stderr.strip()}")
        # Upload before replacing the local files, so a failed upload leaves the old set intact.
        publish_keystore(repo, fresh, password)
    except BoxError:
        fresh.unlink(missing_ok=True)
        fresh_pw.unlink(missing_ok=True)
        raise
    install_keystore(fresh, fresh_pw)
    print(f"created {ks} and its password file, and set the secrets {BOX_KEYSTORE_SECRET} and "
          f"{BOX_PASSWORD_SECRET} on {repo}.")  # fmt: skip
    print(
        f"alias {BOX_KEY_ALIAS}: bundles.yml's box mode and local builds now sign with the same key."
    )


def legacy_box_password() -> str:
    """The fixed password keystores had before they got random ones: the alias itself.

    Only `keystore rotate-password` may use it, to move such a keystore off it. Signing never does.
    """
    return BOX_KEY_ALIAS


def rotate_keystore_password(copy: Path, old: PassSource, new: PassSource) -> None:
    """Change the store and key password of `copy` (same key), from `old` to `new`."""
    steps = (
        ["-storepasswd", "-keystore", str(copy), *keytool_pass("-storepass", old),
         *keytool_pass("-new", new)],
        ["-keypasswd", "-keystore", str(copy), "-alias", BOX_KEY_ALIAS,
         *keytool_pass("-storepass", new), *keytool_pass("-keypass", old),
         *keytool_pass("-new", new)],
    )  # fmt: skip
    for step in steps:
        done = capture(["keytool", *step])
        if done.returncode != 0:
            raise die(
                f"keytool {step[0]} failed: {done.stderr.strip() or done.stdout.strip()}. "
                "Nothing was changed."
            )


def keystore_rotate_password() -> None:
    """Move a keystore made with the old fixed password onto a random one, keeping its key."""
    ks = box_keystore()
    pwfile = box_password_file()
    if not ks.is_file():
        raise die(f"There is no box keystore at {ks}. Run `{CMD} keystore init`.")
    if pwfile.exists():
        raise die(f"{pwfile} exists: the box keystore already has its own password.")
    repo = require_gh_and_keytool()
    fresh = ks.with_name(ks.name + ".new")
    fresh_pw = pwfile.with_name(pwfile.name + ".new")
    fresh.unlink(missing_ok=True)
    password = secrets.token_urlsafe(24)
    write_secret_file(fresh_pw, password)
    shutil.copyfile(ks, fresh)
    try:
        with tempfile.TemporaryDirectory(prefix="box-ks-") as tmp:
            old_file = Path(tmp) / "old"
            write_secret_file(old_file, legacy_box_password())
            rotate_keystore_password(
                fresh, ("file", str(old_file)), ("file", str(fresh_pw))
            )
        publish_keystore(repo, fresh, password)
    except BoxError:
        fresh.unlink(missing_ok=True)
        fresh_pw.unlink(missing_ok=True)
        raise
    install_keystore(fresh, fresh_pw)
    print(
        f"changed the store and key password of {ks} (same key, so installed box apps still update)."
    )
    print(f"wrote the new password to {pwfile} (mode 600) and set the secrets "
          f"{BOX_KEYSTORE_SECRET} and {BOX_PASSWORD_SECRET} on {repo}.")  # fmt: skip


# ---- Android: CI builds ----------------------------------------------------------------------------
#
# A clean, pushed tree whose HEAD has a successful bundles.yml box run needs no local build: its
# APK is downloaded (once per commit; kept in the state dir) and goes through the usual install,
# pre-bind and launch.


def ci_cache_dir() -> Path:
    return state_dir() / "ci"


def ci_artifact(branch: str, sha: str) -> str:
    return f"arlesh-box-{box_segment(branch)}-{sha[:7]}-android-apk"


def ci_cached_apk(branch: str, sha: str) -> Path:
    return ci_cache_dir() / f"{box_segment(branch)}-{sha[:7]}.apk"


def gh_unavailable() -> str | None:
    """Why the gh CLI cannot be used, or None."""
    if shutil.which("gh") is None:
        return "the gh CLI is not on PATH"
    if capture(["gh", "auth", "status"]).returncode != 0:
        return "gh is not authenticated (run `gh auth login`)"
    return None


def ci_blocker(wt: Path, branch: str) -> str | None:
    """Why a CI build cannot stand for this tree (dirty, unpushed, detached), or None."""
    if not branch:
        return "HEAD is detached"
    status = git_in(wt, "status", "--porcelain", "--untracked-files=normal").stdout
    # Box's old symlink to the main checkout's node_modules (git-ignored now it is a folder).
    dirty = [ln for ln in status.splitlines() if ln[3:].rstrip("/") != "node_modules"]
    if dirty:
        return "the worktree has uncommitted or untracked changes"
    head = git_in(wt, "rev-parse", "HEAD").stdout.strip()
    remote = git_in(
        wt, "rev-parse", "--verify", "--quiet", f"origin/{branch}"
    ).stdout.strip()
    if head != remote:
        return f"HEAD is not pushed (not equal to origin/{branch})"
    return None


def gh_json(args: Sequence[str], cwd: Path) -> Any:
    res = capture(["gh", *args], cwd=cwd)
    if res.returncode != 0:
        raise die(
            f"gh {' '.join(args[:2])} failed: {res.stderr.strip() or res.stdout.strip()}"
        )
    try:
        return json.loads(res.stdout or "null")
    except ValueError:
        raise die(
            f"gh {' '.join(args[:2])} returned something that is not JSON."
        ) from None


def list_bundle_runs(wt: Path, branch: str) -> list[dict[str, Any]]:
    runs = gh_json(
        ["run", "list", "--workflow", BUNDLES_WORKFLOW, "--branch", branch, "--limit", "30",
         "--json", "databaseId,headSha,status,conclusion,url,event"],
        wt,
    )  # fmt: skip
    return [r for r in runs if isinstance(r, dict)] if isinstance(runs, list) else []


def run_has_artifact(wt: Path, run_id: int, artifact: str) -> bool:
    names = capture(
        ["gh", "api", f"repos/{{owner}}/{{repo}}/actions/runs/{run_id}/artifacts",
         "--jq", ".artifacts[] | select(.expired == false) | .name"],
        cwd=wt,
    )  # fmt: skip
    return names.returncode == 0 and artifact in names.stdout.split()


def find_ci_run(wt: Path, branch: str, sha: str) -> dict[str, Any] | None:
    """A successful bundles.yml box run for exactly `sha` whose artifact is still there."""
    artifact = ci_artifact(branch, sha)
    for run in list_bundle_runs(wt, branch):
        if (
            run.get("headSha") == sha
            and run.get("conclusion") == "success"
            and run.get("event") == "workflow_dispatch"
            and run_has_artifact(wt, int(run["databaseId"]), artifact)
        ):
            return run
    return None


def trigger_ci(wt: Path, branch: str, sha: str) -> dict[str, Any]:
    """Dispatch a box build of `branch`, wait for it with progress output, return the finished run."""
    known = {r.get("databaseId") for r in list_bundle_runs(wt, branch)}
    fired = capture(
        ["gh", "workflow", "run", BUNDLES_WORKFLOW, "--ref", branch, "-f", "box=true",
         "-f", "publish=false"],
        cwd=wt,
    )  # fmt: skip
    if fired.returncode != 0:
        raise die(f"Could not trigger {BUNDLES_WORKFLOW}: {fired.stderr.strip()}")
    print(
        f"triggered {BUNDLES_WORKFLOW} (box=true, publish=false) on {branch}; waiting for it."
    )
    poll = env_int("ARLESH_BOX_POLL_SECONDS", 15)
    deadline = time.monotonic() + env_int("ARLESH_BOX_CI_TIMEOUT_SECONDS", 3600)
    last = ""
    while True:
        run = next(
            (r for r in list_bundle_runs(wt, branch)
             if r.get("headSha") == sha and r.get("databaseId") not in known),
            None,
        )  # fmt: skip
        status = str(run.get("status")) if run else "waiting for the run to appear"
        if status != last:
            print(f"ci: {status}" + (f" {run.get('url')}" if run else ""), flush=True)
            last = status
        if run and run.get("status") == "completed":
            if run.get("conclusion") != "success":
                raise die(
                    f"The CI box build failed ({run.get('conclusion')}): {run.get('url')}. "
                    f"Build locally with --local."
                )
            return run
        if time.monotonic() > deadline:
            raise die("Gave up waiting for the CI box build.")
        time.sleep(poll)


def download_ci(wt: Path, branch: str, sha: str, run: dict[str, Any]) -> Path:
    dest = ci_cached_apk(branch, sha)
    ci_cache_dir().mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(dir=ci_cache_dir()) as tmp:
        got = capture(
            ["gh", "run", "download", str(run["databaseId"]), "-n", ci_artifact(branch, sha), "-D", tmp],
            cwd=wt,
        )  # fmt: skip
        apks = sorted(Path(tmp).rglob("*.apk"))
        if got.returncode != 0 or not apks:
            raise die(
                f"Could not download the CI build of run {run.get('url')}: {got.stderr.strip()}"
            )
        shutil.move(str(apks[0]), dest)
    dest.with_name(dest.name + ".url").write_text(f"{run.get('url')}\n")
    return dest


def pick_ci_build(wt: Path, mode: str) -> Path | None:
    """The CI APK to use for this tree, or None to build locally. `mode`: auto, local or ci."""
    if mode == LOCAL:
        print("building locally (--local).")
        return None
    branch = worktree_branch(wt)
    blocker = ci_blocker(wt, branch)
    if blocker:
        if mode == CI:
            raise die(
                f"--ci needs a clean, pushed tree: {blocker}. Commit and push, or drop --ci."
            )
        print(f"building locally: {blocker}.")
        return None
    sha = git_in(wt, "rev-parse", "HEAD").stdout.strip()
    cached = ci_cached_apk(branch, sha)
    if cached.is_file():
        url = cached.with_name(cached.name + ".url")
        print(
            f"using CI build {url.read_text().strip() if url.is_file() else cached} (cached)."
        )
        return cached
    unavailable = gh_unavailable()
    if unavailable:
        if mode == CI:
            raise die(f"--ci needs gh: {unavailable}.")
        note(f"building locally: {unavailable}.")
        return None
    try:
        run = find_ci_run(wt, branch, sha)
    except BoxError as exc:
        if mode == CI:
            raise
        note(f"building locally: {exc}")
        return None
    if run is None:
        if mode != CI:
            print("building locally: no successful CI box build for this commit.")
            return None
        run = trigger_ci(wt, branch, sha)
    print(f"using CI build {run.get('url')}.")
    return download_ci(wt, branch, sha, run)


# ---- Android: build, install, launch ----------------------------------------------------------


def android_apk(branch: str) -> Path:
    return instance_dir(branch) / "arlesh-box.apk"


def xml_string_file(label: str) -> str:
    from xml.sax.saxutils import escape

    text = escape(label.replace("\\", "\\\\").replace('"', '\\"').replace("'", "\\'"))
    return (
        f'<resources>\n    <string name="app_name">"{text}"</string>\n'
        f'    <string name="main_activity_title">"{text}"</string>\n</resources>\n'
    )


def android_project_files(wt: Path) -> tuple[Path, Path]:
    app = wt / "src-tauri" / "gen" / "android" / "app"
    gradle, strings = app / "build.gradle.kts", app / "src/main/res/values/strings.xml"
    if not gradle.is_file() or not strings.is_file():
        raise die(f"'{wt}' has no generated Android project (src-tauri/gen/android).")
    return gradle, strings


def apply_android_patch(gradle: Path, strings: Path, package: str, label: str) -> None:
    """Rewrite the applicationId and the app name in place; the caller restores or discards."""
    text = gradle.read_text()
    patched_id = f'applicationId = "{package}"'
    if patched_id not in text:
        if 'applicationId = "com.atai.arlesh"' not in text:
            raise die("build.gradle.kts has no applicationId to patch.")
        gradle.write_text(text.replace('applicationId = "com.atai.arlesh"', patched_id))
    strings.write_text(xml_string_file(label))


def build_android(name: str, wt: Path, firebase: bool) -> None:
    package, label = box_package(name), box_label(name)
    android_env()
    need_cmd("npx", "Install Node.")
    need_cmd("rustup", "Install Rust via rustup.")
    require_space()
    signing = choose_signing()
    apksigner = build_tool("apksigner")
    capture(["rustup", "target", "add", "aarch64-linux-android"])
    ensure_node_modules(wt)
    gradle, strings = android_project_files(wt)
    app_dir = gradle.parent
    target = shared_target()

    fb = Firebase()
    if firebase and fb.ready():
        app_id = fb.ensure_app(package, label)
        fb.write_config(app_id, app_dir)
        print(
            f"firebase: {package} registered as {app_id}; google-services.json written (gitignored)."
        )
        note(
            "note: app/build.gradle.kts does not apply the google-services plugin yet, so the file is not read by the build."
        )

    # With one target dir shared across worktrees, the first build in a new worktree otherwise finds
    # the generated TauriActivity missing: cargo thinks tauri and wry are up to date.
    git_dir = Path(
        capture(
            ["git", "-C", str(wt), "rev-parse", "--absolute-git-dir"]
        ).stdout.strip()
    )
    marker = git_dir / "arlesh-box-first-build"
    first = not marker.exists()
    if first:
        cleaned = subprocess.run(
            ["cargo", "clean", "-p", "tauri", "-p", "wry", "--release", "--target",
             "aarch64-linux-android", "--manifest-path", "src-tauri/Cargo.toml"],
            cwd=wt, env={**os.environ, "CARGO_TARGET_DIR": str(target)}, check=False,
        )  # fmt: skip
        if cleaned.returncode != 0:
            note(
                "cargo clean of tauri and wry failed or had nothing to clean; continuing."
            )

    print(f"\n=== {name}: android apk {package} ({label}) ===", flush=True)
    with patched([gradle, strings]):
        apply_android_patch(gradle, strings, package, label)
        # Rebuilt from scratch, so an older APK is never mistaken for this one.
        shutil.rmtree(app_dir / "build" / "outputs" / "apk", ignore_errors=True)
        run_cmd(
            ["npx", "tauri", "android", "build", "--apk", "--target", "aarch64", "--ci",
             "--", "--no-default-features"],
            cwd=wt, env={"CARGO_TARGET_DIR": str(target)}, what=f"{name}: the Android build",
        )  # fmt: skip
    if first:
        marker.touch()
    unsigned = next(
        (app_dir / "build" / "outputs" / "apk").rglob("*-release-unsigned.apk"), None
    )
    if unsigned is None:
        raise die(f"{name}: the build produced no unsigned release APK.")
    out = android_apk(name)
    out.parent.mkdir(parents=True, exist_ok=True)
    run_cmd(
        [str(apksigner), "sign", "--ks", str(signing.keystore), "--ks-key-alias", signing.alias,
         "--ks-pass", apksigner_pass(signing.password),
         "--key-pass", apksigner_pass(signing.password),
         "--out", str(out), str(unsigned)],
        env=dict(signing.env),
        what="apksigner",
    )  # fmt: skip
    print(f"=== {name}: built {out} ({out.stat().st_size / 1e6:.0f}M) ===")


def install_android(name: str, serial: str, reinstall: bool = False) -> None:
    apk = android_apk(name)
    if reinstall:
        print(f"--reinstall: uninstalling {box_package(name)} first.")
        capture(["adb", "-s", serial, "uninstall", box_package(name)])
    res = subprocess.run(
        ["adb", "-s", serial, "install", "-r", str(apk)],
        capture_output=True,
        text=True,
        check=False,
    )
    if res.returncode != 0:
        note(res.stdout + res.stderr)
        if "UPDATE_INCOMPATIBLE" in res.stdout + res.stderr:
            raise die(
                f"The installed {box_package(name)} is signed with a different key than this APK "
                f"(a CI build, a local build and the debug fallback only update one another when "
                f"signed with the same box keystore: `{CMD} keystore init`). Run again with "
                f"--reinstall to uninstall it first; box hands the new app a fresh token."
            )
        raise die("adb install failed.")
    print(f"installed {box_package(name)} on {serial}")


def launch_android(
    name: str, serial: str, bound: tuple[str, str] | None = None
) -> None:
    """Launch the box app; with `bound` (url, token), restart it handed that connection."""
    package = box_package(name)
    if bound:
        # A running app has read its mode already: start it afresh so it reads the provision.
        capture(["adb", "-s", serial, "shell", "am", "force-stop", package])
        res = capture(am_start_argv(serial, package, *bound))
        if res.returncode != 0 or "Error" in res.stdout:
            raise die(f"Could not launch {package} on {serial}.")
    else:
        res = capture(["adb", "-s", serial, "shell", "monkey", "-p", package,
                       "-c", "android.intent.category.LAUNCHER", "1"])  # fmt: skip
        if res.returncode != 0:
            raise die(f"Could not launch {package} on {serial}.")
    print(f"launched {package}")


def android_connection(
    name: str, target: Target, server: str, force: bool, has_local_data: bool
) -> tuple[str, str] | None:
    """(url, token) for the box app on `target`, or None when it is already bound to `server`."""
    server_start(server, PUBLIC, widen=True)
    assert target.host
    addr = pick_server_address(tailnet_ip(), lan_ip())
    url = f"http://{addr}:{server_port_for(server)}"
    client = client_name(target.name)
    holder = token_holder(target.name, name)
    reason = provision_reason(
        force=force,
        record=load_state()["provisioned"].get(target.name, {}).get(name),
        server=server,
        url=url,
        holder=holder,
        holders=load_state()["tokens"].get(server, {}),
        issued=issued_clients(server),
        client=client,
        has_local_data=has_local_data,
    )
    if reason is None:
        print(f"{target.name} is already connected to {server} at {url} as {client}.")
        return None
    print(f"binding {target.name} to {server} at {url} as {client}: {reason}")
    return url, mint_token(server, client, holder)


def ci_mode(args: argparse.Namespace) -> str:
    return LOCAL if args.local else CI if args.ci else AUTO


def prepare_apk(name: str, wt: Path, args: argparse.Namespace) -> str:
    """The branch's APK at `android_apk(name)`, from CI or built locally; its build stamp."""
    stamp = worktree_stamp(wt)
    ci_apk = pick_ci_build(wt, ci_mode(args))
    if ci_apk:
        stamp = f"ci:{stamp}"  # a CI build and a local one of the same commit are different APKs
        if is_stale(ANDROID, name, stamp, android_apk(name), args.force):
            android_apk(name).parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(ci_apk, android_apk(name))
            record_built(ANDROID, name, stamp)
        else:
            print(f"{name}: android build is current, not fetching again.")
    elif is_stale(ANDROID, name, stamp, android_apk(name), args.force):
        build_android(name, wt, firebase=not args.no_firebase)
        record_built(ANDROID, name, stamp)
    else:
        print(f"{name}: android build is current, not rebuilding.")
    return stamp


SSH_APK_DIR = "storage/downloads"  # under the Termux home: Android's Downloads, via termux-setup-storage


def ssh_argv(tool: str, spec: str) -> tuple[list[str], str]:
    """`ssh`/`scp` argv prefix and the `[user@]host` for a `[user@]host[:port]` spec.

    BatchMode=yes: a missing key or an unknown host key is an error, never a prompt.
    """
    host, _, port = (
        spec.rpartition(":") if re.search(r":\d+$", spec) else (spec, "", "")
    )
    flag = "-P" if tool == "scp" else "-p"
    base = [tool, "-o", "BatchMode=yes", "-o", "ConnectTimeout=10"]
    return (base + ([flag, port] if port else []), host)


def ssh_run(argv: Sequence[str]) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        list(argv), capture_output=True, text=True, stdin=subprocess.DEVNULL, check=False, timeout=300
    )  # fmt: skip


def install_over_ssh(name: str, target: Target, why: str) -> None:
    """Hand the APK to a Termux sshd: scp it to Downloads and open Android's installer.

    The fallback for a device adb cannot reach. It cannot pre-bind the app to a server (no
    `am start` extras), and the person confirms the install on the phone.
    """
    assert target.ssh
    note(
        f"adb cannot reach {target.name} ({why.splitlines()[0]}); falling back to ssh ({target.ssh})."
    )
    remote = f"{SSH_APK_DIR}/arlesh-{name}.apk"
    prefix, dest = ssh_argv("scp", target.ssh)
    sent = ssh_run([*prefix, str(android_apk(name)), f"{dest}:{remote}"])
    if sent.returncode != 0:
        raise die(
            f"scp to {target.ssh} failed: {sent.stderr.strip()}\nTermux needs sshd running with "
            f"your key authorised, and `termux-setup-storage` run once for ~/{SSH_APK_DIR}."
        )
    prefix, dest = ssh_argv("ssh", target.ssh)
    opened = ssh_run([*prefix, dest, "termux-open", f"~/{remote}"])
    if opened.returncode != 0:
        raise die(
            f"termux-open failed on {target.ssh}: {opened.stderr.strip()}\nIt needs the Termux:API "
            f"app and `pkg install termux-api`. The APK is at ~/{remote} on the phone: open it "
            f"from a file manager."
        )
    print(f"sent ~/{remote} to {target.name}; confirm the install on the phone.")
    note(
        "Over ssh the app is not pre-bound to a server (that needs `am start` extras through adb), "
        "so it opens on its connect screen, and nothing is recorded as installed. To get the "
        "full flow, pair adb once: on the phone, Developer options > Wireless debugging > Pair "
        f"device with pairing code, then `adb pair <host>:<pairing port>`, and run {CMD} run again."
    )


def run_android(name: str, wt: Path, target: Target, args: argparse.Namespace) -> None:
    android_env()
    serial: str | None
    adb_error = ""
    try:
        serial = resolve_device(
            target
        )  # before a long build: fail early on a missing device
    except BoxError as exc:
        if not target.ssh:
            raise
        serial, adb_error = None, str(exc)
    stamp = prepare_apk(name, wt, args)
    if serial is None:
        install_over_ssh(name, target, adb_error)
        return
    had_package = package_installed(serial, box_package(name)) and not args.reinstall
    reason = (
        "--reinstall"
        if args.reinstall
        else "forced"
        if args.force
        else install_reason(serial, target.name, name, stamp)
    )
    if reason:
        print(f"installing on {target.name}: {reason}")
        install_android(name, serial, args.reinstall)
        update_state(
            lambda s: (
                s["installed"].setdefault(target.name, {}).__setitem__(name, stamp)
            )
        )
    else:
        print(f"{target.name} already has this build installed.")
    bound = None
    if args.standalone:
        print(
            "--standalone: not bound to a server; the app opens on its connect screen."
        )
    else:
        bound = android_connection(
            name, target, args.server or name, args.force, had_package
        )
    launch_android(name, serial, bound)
    if bound:
        record_provisioned(target.name, name, args.server or name, bound[0])


def android_devices() -> list[Target]:
    return [t for t in load_devices().values() if t.os == ANDROID and t.host]


def uninstall_everywhere(package: str, serials: dict[str, str]) -> None:
    for device, serial in serials.items():
        done = capture(["adb", "-s", serial, "uninstall", package])
        if done.returncode == 0 and "Success" in done.stdout:
            print(f"uninstalled {package} from {device}")
        else:
            note(f"{package} was not installed on {device}.")


def reachable_android_devices() -> dict[str, str]:
    """Serials of the registered Android devices that answer; the rest are skipped with a notice."""
    found: dict[str, str] = {}
    devices = android_devices()
    if not devices:
        return found
    try:
        android_env()
    except BoxError as exc:
        note(f"{exc} Not touching devices.")
        return found
    for t in devices:
        try:
            found[t.name] = resolve_device(t)
        except BoxError as exc:
            note(f"{t.name}: {exc}")
    return found


# ---- Commands -------------------------------------------------------------------------------


def list_worktrees_only() -> None:
    """The plain worktree table, for when the open PRs cannot be had."""
    state = load_state()
    print(f"{'BRANCH':<28} {'DESKTOP':<8} {'ANDROID':<8} {'PORT':<7} HEAD")
    for name in all_names():
        port_file = instance_dir(name) / "port"
        head = (
            capture(
                ["git", "-C", str(worktrees_dir() / name), "log", "--oneline", "-1"]
            ).stdout.strip()
            or "?"
        )
        built_d = (
            "yes"
            if name in state["built"][DESKTOP] and desktop_binary(name).exists()
            else "no"
        )
        built_a = (
            "yes"
            if name in state["built"][ANDROID] and android_apk(name).exists()
            else "no"
        )
        port = port_file.read_text().strip() if port_file.exists() else "-"
        branch = worktree_branch(worktrees_dir() / name)
        if branch and branch != name:
            name = f"{name} [{branch}]"
        print(f"{name:<28} {built_d:<8} {built_a:<8} {port:<7} {head[:50]}")
    names = server_names([])
    if names:
        print(f"\n{'SERVER':<28} {'RUNNING':<8} {'PORT':<7} DATABASE")
        for s in names:
            pf = server_dir(s) / "port"
            print(f"{s:<28} {'yes' if server_running(s) else 'no':<8} "
                  f"{pf.read_text().strip() if pf.exists() else '-':<7} {server_db(s)}")  # fmt: skip


def gh_pr_list(state: str, fields: str, *extra: str) -> list[dict[str, Any]]:
    cwd = main_checkout()
    data = gh_json(
        ["pr", "list", "--repo", origin_repo(cwd), "--state", state, "--limit", "200",
         "--json", fields, *extra],
        cwd,
    )  # fmt: skip
    return [d for d in data if isinstance(d, dict)] if isinstance(data, list) else []


def open_prs() -> list[dict[str, Any]]:
    """Every open PR (number, title, headRefName, baseRefName, isDraft, url)."""
    return gh_pr_list("open", "number,title,headRefName,baseRefName,isDraft,url")


def pr_merged(branch: str) -> bool:
    return bool(gh_pr_list("merged", "number", "--head", branch))


def worktree_branches() -> dict[str, str]:
    """Directory name -> checked-out branch ('' when detached) of every box worktree."""
    return {n: worktree_branch(worktrees_dir() / n) for n in all_names()}


def sync_label(wt: Path, branch: str) -> str:
    """How the worktree's branch stands against origin: synced, ahead N, behind N, no upstream."""
    remote = f"refs/remotes/origin/{branch}"
    if not branch:
        return "detached"
    if not ref_exists(wt, remote):
        return "no upstream"
    behind = commit_count(wt, f"{branch}..{remote}")
    ahead = commit_count(wt, f"{remote}..{branch}")
    parts = [f"ahead {ahead}" if ahead else "", f"behind {behind}" if behind else ""]
    return " ".join(p for p in parts if p) or "synced"


def build_label(
    state: dict[str, Any], os_name: str, name: str, stamp: str, artifact: Path
) -> str:
    recorded = state["built"][os_name].get(name)
    if recorded is None or not artifact.exists():
        return "-"
    return "fresh" if recorded == stamp else "stale"


def branch_row(name: str, branch: str, state: dict[str, Any]) -> dict[str, Any]:
    """What box knows about one worktree: sync, builds, installs, server and app."""
    wt = worktrees_dir() / name
    stamp = worktree_stamp(wt)
    installed = {
        dev: ("fresh" if per.get(name) == stamp else "stale")
        for dev, per in sorted(state["installed"].items())
        if name in per
    }
    port_file = server_dir(name) / "port"
    app = read_pid(instance_dir(name) / "run.pid")
    return {
        "worktree": name,
        "sync": sync_label(wt, branch),
        "desktop": build_label(state, DESKTOP, name, stamp, desktop_binary(name)),
        "android": build_label(state, ANDROID, name, stamp, android_apk(name)),
        "installed": installed,
        "server": {
            "running": server_running(name),
            "port": port_file.read_text().strip() if port_file.exists() else None,
        },
        "app": bool(app and pid_alive(app)),
    }


def list_rows(
    prs: list[dict[str, Any]],
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    """(rows for open-PR branches, rows for long-lived branches and worktrees with no open PR)."""
    state = load_state()
    held = {b: n for n, b in worktree_branches().items() if b}
    pr_branches = {str(pr.get("headRefName")) for pr in prs}

    def row(branch: str, pr: dict[str, Any] | None, note_text: str) -> dict[str, Any]:
        name = held.get(branch)
        data = branch_row(name, branch, state) if name else {"worktree": None}
        if name is None and branch == worktree_branch(main_checkout()):
            data = {"worktree": "(main checkout)"}
        return {"branch": branch, "pr": pr, "note": note_text, **data}

    with_pr = [row(str(pr.get("headRefName")), pr, "") for pr in prs]
    others = [
        row(b, None, "long-lived")
        for b in LONG_LIVED
        if b in held or ref_exists(main_checkout(), f"refs/remotes/origin/{b}")
    ]
    others += [
        row(b, None, "no open PR (prunable)")
        for b in sorted(held)
        if b not in pr_branches and b not in LONG_LIVED
    ]
    return with_pr, others


def format_row(r: dict[str, Any]) -> str:
    pr = r["pr"]
    if pr:
        draft = " draft" if pr.get("isDraft") else ""
        what = f"#{pr.get('number')}"
        title = f"{str(pr.get('title'))[:34]} -> {pr.get('baseRefName')}{draft}"
    else:
        what, title = "-", r["note"]
    if r["worktree"] is None:
        cols = ["(none)", "", "", "", "", "", ""]
    elif "sync" not in r:
        cols = [r["worktree"], "", "", "", "", "", ""]
    else:
        inst = ",".join(f"{d}:{v}" for d, v in r["installed"].items()) or "-"
        srv = r["server"]
        server = f"up:{srv['port']}" if srv["running"] else "-"
        cols = [r["worktree"], r["sync"], r["desktop"], r["android"], inst, server, "running" if r["app"] else "-"]  # fmt: skip
    head = f"{what:<6} {r['branch'][:28]:<28} {title:<46}"
    return (
        head
        + f" {cols[0]:<24} {cols[1]:<12} {cols[2]:<8} {cols[3]:<8} {cols[4]:<18} {cols[5]:<9} {cols[6]}"
    )


LIST_HEADER = (
    f"{'PR':<6} {'BRANCH':<28} {'TITLE -> BASE':<46} {'WORKTREE':<24} {'SYNC':<12} "
    f"{'DESKTOP':<8} {'ANDROID':<8} {'INSTALLED':<18} {'SERVER':<9} APP"
)


def cmd_list(args: argparse.Namespace) -> None:
    blocker = gh_unavailable()
    prs: list[dict[str, Any]] | None = None
    if blocker is None:
        try:
            prs = open_prs()
        except BoxError as exc:
            blocker = str(exc)
    if prs is None:
        if getattr(args, "json", False):
            print(json.dumps({"gh": False, "reason": blocker,
                              "worktrees": worktree_branches()}, indent=2))  # fmt: skip
            return
        note(f"Open PRs unavailable ({blocker}); showing the worktrees instead.")
        list_worktrees_only()
    else:
        with_pr, others = list_rows(prs)
        if getattr(args, "json", False):
            print(json.dumps({"gh": True, "pull_requests": with_pr, "other": others}, indent=2))  # fmt: skip
            return
        print(LIST_HEADER)
        for r in with_pr:
            print(format_row(r))
        if others:
            print("-" * 8)
            for r in others:
                print(format_row(r))
        shown = {r["worktree"] for r in with_pr + others}
        extra = [n for n in server_names([]) if n not in shown]
        if extra:
            print(f"\n{'SERVER':<28} {'RUNNING':<8} {'PORT':<7} DATABASE")
            for sname in extra:
                pf = server_dir(sname) / "port"
                print(f"{sname:<28} {'yes' if server_running(sname) else 'no':<8} "
                      f"{pf.read_text().strip() if pf.exists() else '-':<7} {server_db(sname)}")  # fmt: skip
    print(f"\ntargets: {target_names()}\n{free_gb()}G free on /")


def cmd_run(args: argparse.Namespace) -> None:
    target = resolve_target(args.target)
    branch = canonical_branch(args.branch)
    wt = ensure_worktree(branch, report=False)
    sync_worktree(wt, branch, args.stale_ok)
    name = dir_name(branch)
    if args.server:
        ensure_worktree(args.server)
        args.server = dir_name(args.server)
    if target.os != ANDROID and (args.ci or args.reinstall):
        raise UsageError("--ci and --reinstall apply to Android targets only.")
    if target.os == ANDROID:
        run_android(name, wt, target, args)
    else:
        run_desktop(name, wt, target, args)
    record_last_target(target.name)


def resolve_branches(requested: Sequence[str]) -> list[str]:
    if not requested or list(requested) == ["all"]:
        return all_names()
    return [dir_name(b) for b in requested]


def cmd_ci_patch(args: argparse.Namespace) -> None:
    """Patch a checkout in place for a CI box APK; CI discards the tree, so nothing is backed up."""
    gradle, strings = android_project_files(Path(args.root))
    apply_android_patch(
        gradle, strings, box_package(args.branch), box_label(args.branch)
    )
    print(f"patched for {box_package(args.branch)} ({box_label(args.branch)})")
    print(f"segment={box_segment(args.branch)}")


def stop_instance(name: str) -> None:
    """Stop `name`'s app and its Vite dev server, and say if something still serves its port."""
    inst = instance_dir(name)
    kill_pidfile(inst / "run.pid", "app", name)
    kill_pidfile(inst / "vite.pid", "vite", name)
    pf = inst / "port"
    if not pf.exists():
        return
    port = pf.read_text().strip()
    still = False
    for _ in range(3):  # SIGTERM to node is not instant; a false alarm is noise
        still = http_up(f"http://localhost:{port}")
        if not still:
            break
        time.sleep(1)
    if still:
        note(
            f'!! {name}: something is still serving port {port}. Find it with: ss -lptn "sport = :{port}"'
        )


def cmd_stop(args: argparse.Namespace) -> None:
    everything = not args.branches or list(args.branches) == ["all"]
    for name in resolve_branches(args.branches):
        stop_instance(name)
    if everything:
        server_stop([])


def cmd_clean(args: argparse.Namespace) -> None:
    named = bool(args.branches) and list(args.branches) != ["all"]
    for name in resolve_branches(args.branches):
        # Only the binary and APK go. An instance's database is state built up while testing.
        (instance_dir(name) / "arlesh").unlink(missing_ok=True)
        android_apk(name).unlink(missing_ok=True)
        for cached in ci_cache_dir().glob(f"{box_segment(name)}-*.apk*"):
            cached.unlink(missing_ok=True)

        def forget(s: dict[str, Any], n: str = name) -> None:
            for per_os in s["built"].values():
                per_os.pop(n, None)
            for per_device in s["installed"].values():
                per_device.pop(n, None)

        update_state(forget)
        print(
            f"removed builds for {name} (its data and port kept at {instance_dir(name)})"
        )
    # Named branches only: `clean` and `clean all` never reach into Firebase or a phone.
    if named:
        serials = reachable_android_devices()
        for name in resolve_branches(args.branches):
            package = box_package(name)
            Firebase().remove_package(package)
            uninstall_everywhere(package, serials)
    print(f"{free_gb()}G free.")


@dataclass
class PrunePlan:
    """What `prune` would do with the worktrees: the ones to remove and the ones it keeps."""

    remove: list[tuple[str, str, str]] = field(
        default_factory=list
    )  # (dir, branch, fate)
    kept: list[tuple[str, str]] = field(default_factory=list)  # (dir, reason)


def kept_reason(name: str, branch: str) -> str | None:
    """Why a worktree without an open PR must stay, or None when it may go."""
    wt = (worktrees_dir() / name).resolve()
    if not branch:
        return "detached HEAD"
    if branch in LONG_LIVED:
        return "long-lived branch"
    if wt == main_checkout().resolve():
        return "main checkout"
    cwd = Path.cwd().resolve()
    if cwd == wt or wt in cwd.parents:
        return "current directory"
    status = git_in(wt, "status", "--porcelain", "--untracked-files=normal").stdout
    if [ln for ln in status.splitlines() if ln[3:].rstrip("/") != "node_modules"]:
        return "dirty"
    remote = f"refs/remotes/origin/{branch}"
    unpushed = (
        commit_count(wt, f"{remote}..{branch}")
        if ref_exists(wt, remote)
        else commit_count(wt, f"{branch} --not --remotes=origin")
    )
    if unpushed:
        return f"{unpushed} unpushed commits"
    return None


def branch_fate(branch: str) -> str | None:
    """Why the local branch may be deleted after its worktree goes (None: keep it)."""
    main = main_checkout()
    for base in LONG_LIVED:
        ref = f"refs/remotes/origin/{base}"
        if (
            ref_exists(main, ref)
            and git_in(main, "merge-base", "--is-ancestor", branch, ref).returncode == 0
        ):
            return f"merged into origin/{base}"
    return "its PR was merged" if pr_merged(branch) else None


def plan_prune(prs: list[dict[str, Any]]) -> PrunePlan:
    plan = PrunePlan()
    open_branches = {str(pr.get("headRefName")) for pr in prs}
    for name, branch in worktree_branches().items():
        if branch in open_branches:
            continue
        reason = kept_reason(name, branch)
        if reason:
            plan.kept.append((name, reason))
        else:
            fate = branch_fate(branch)
            plan.remove.append((name, branch, fate or ""))
    return plan


def print_prune_plan(plan: PrunePlan) -> None:
    for name, branch, fate in plan.remove:
        print(f"remove worktree {name} ({branch}): no open PR")
        print(
            "  stop its server and app, drop its Firebase app and device installs, git worktree remove"
        )
        print(f"  local branch: {'delete (' + fate + ')' if fate else 'keep (not merged)'}")  # fmt: skip
    for name, reason in plan.kept:
        print(f"kept: {name}: {reason}")
    if not plan.remove and not plan.kept:
        print("no worktrees without an open PR.")


def remove_worktree(name: str, branch: str, fate: str) -> None:
    """Stop `name`, clean its apps, remove the worktree, delete the branch only when `fate` says so."""
    stop_instance(name)
    if server_dir(name).is_dir():
        stop_server(name)
    cmd_clean(argparse.Namespace(branches=[name]))
    link = worktrees_dir() / name / "node_modules"
    if (
        link.is_symlink()
    ):  # box's own link to the main checkout's; git would call it untracked
        link.unlink()
    done = git_in(main_checkout(), "worktree", "remove", str(worktrees_dir() / name))
    if done.returncode != 0:
        note(f"kept {name}: git worktree remove failed: {done.stderr.strip()}")
        return
    print(f"removed worktree {name}")
    if not fate:
        print(f"kept local branch {branch}: not merged")
    elif git_in(main_checkout(), "branch", "-D", branch).returncode == 0:
        print(f"deleted local branch {branch} ({fate})")
    else:
        note(f"could not delete local branch {branch}")


def prune_packages(args: argparse.Namespace, execute: bool) -> None:
    """Remove every com.atai.arlesh.box.* app in Firebase or on a device whose worktree is gone."""
    packages: list[str] = []
    fb = Firebase()
    if fb.ready():
        packages += [
            p for _, p in fb.list_apps() if p.startswith(BOX_PACKAGE_PREFIX + ".")
        ]
    serials: dict[str, str] = {}
    if args.target:
        target = resolve_target(args.target)
        if target.os != ANDROID or not target.host:
            raise UsageError(f"'{args.target}' is not an android device.")
        android_env()
        serials = {target.name: resolve_device(target)}
    else:
        serials = reachable_android_devices()
    for serial in serials.values():
        listed = capture(
            ["adb", "-s", serial, "shell", "pm", "list", "packages", BOX_PACKAGE_PREFIX + "."]
        ).stdout  # fmt: skip
        packages += [
            ln.strip().removeprefix("package:")
            for ln in listed.replace("\r", "").splitlines()
            if ln.strip()
        ]
    orphans = [p for p in dict.fromkeys(packages) if not box_owners(p)]
    for package in orphans:
        if execute:
            fb.remove_package(package)
            uninstall_everywhere(package, serials)
        else:
            print(f"remove test app {package} (its worktree is gone)")
    verb = "pruned" if execute else "would prune"
    print(f"{verb} {len(orphans)} test app(s) whose worktree is gone.")


def interactive() -> bool:
    return sys.stdin.isatty()


def ask(prompt: str) -> str:
    try:
        return input(prompt)
    except EOFError:
        return ""


def cmd_prune(args: argparse.Namespace) -> None:
    """Print the plan; apply it after a y/N prompt, or at once with -y. `--dry-run` never applies."""
    blocker = gh_unavailable()
    plan: PrunePlan | None = None
    if blocker is None:
        plan = plan_prune(open_prs())
        print_prune_plan(plan)
    else:
        note(f"Not pruning worktrees: open PRs unavailable ({blocker}).")
    prune_packages(args, False)
    if args.dry_run:
        print("dry run: nothing changed.")
        return
    if not args.yes:
        if not interactive():
            raise die(
                "Not applying the plan without a terminal: re-run with -y to apply."
            )
        if ask("Proceed? [y/N] ").strip().lower() not in ("y", "yes"):
            print("aborted; nothing changed.")
            return
    if plan:
        for name, branch, fate in plan.remove:
            remove_worktree(name, branch, fate)
    prune_packages(args, True)


def cmd_devices(args: argparse.Namespace) -> None:
    if args.devices_cmd == "add":
        device_add(args.name, args.os, args.host, args.serial, args.ssh)
    elif args.devices_cmd == "rm":
        device_rm(args.name)
    else:
        device_list()


def cmd_keystore(args: argparse.Namespace) -> None:
    if args.keystore_cmd == "rotate-password":
        keystore_rotate_password()
    else:
        keystore_init(args.force)


def cmd_server(args: argparse.Namespace) -> None:
    sub = args.server_cmd
    if sub == "start":
        ensure_worktree(args.branch)
        name = dir_name(args.branch)
        server_start(name, "0.0.0.0" if args.public else "127.0.0.1")
        print_connection(name, args.public)
    elif sub == "stop":
        server_stop(args.branches)
    elif sub == "token":
        if not args.rest:
            raise UsageError(
                f"Usage: {CMD} server token <branch> <arlesh-server token args...>"
            )
        ensure_worktree(args.branch)
        server_cli_checked(dir_name(args.branch), "token", args.rest)
    else:
        if not args.rest or args.rest[0] not in ("approve", "list"):
            raise UsageError(
                f"Usage: {CMD} server pin <branch> {{approve <pin> [--name <device>] | list}}"
            )
        ensure_worktree(args.branch)
        server_cli_checked(dir_name(args.branch), "pin", args.rest)


# ---- Argument parsing -----------------------------------------------------------------------


class Parser(argparse.ArgumentParser):
    def error(self, message: str) -> Any:  # type: ignore[override]
        raise UsageError(f"{message}\n\n{self.format_usage()}")


def build_parser() -> argparse.ArgumentParser:
    p = Parser(
        prog=CMD,
        description="Isolated per-branch Arlesh instances (desktop and Android).",
    )
    sub = p.add_subparsers(dest="cmd", parser_class=Parser)
    ls = sub.add_parser(
        "list", help="open-PR branches with their worktrees, builds and servers"
    )
    ls.add_argument("--json", action="store_true", help="machine-readable output")
    ls.set_defaults(fn=cmd_list)

    dev = sub.add_parser("devices", help="the named target registry")
    dsub = dev.add_subparsers(dest="devices_cmd", required=True, parser_class=Parser)
    add = dsub.add_parser("add", help="register a target")
    add.add_argument("name")
    add.add_argument("--os", required=True, choices=OSES)
    add.add_argument(
        "--host",
        help="host[:port]; an Android host without a port is found by adb mdns",
    )
    add.add_argument(
        "--serial",
        help="the device's hardware serial (adb shell getprop ro.serialno): matches it by serial "
        "alone, so a tailnet name works",
    )
    add.add_argument(
        "--ssh",
        help="[user@]host[:port] of a Termux sshd: install over scp + termux-open when adb cannot reach it",
    )
    rm = dsub.add_parser("rm", help="forget a target")
    rm.add_argument("name")
    dsub.add_parser("list", help="show the registered targets")
    dev.set_defaults(fn=cmd_devices)

    run = sub.add_parser("run", help="build if stale, install if stale, launch")
    run.add_argument("branch")
    run.add_argument(
        "target", nargs="?", help="desktop, or a device from `devices list`"
    )
    group = run.add_mutually_exclusive_group()
    group.add_argument("--server", metavar="BRANCH", help="use another branch's server")
    group.add_argument(
        "--standalone",
        action="store_true",
        help="use no server (the app opens unbound)",
    )
    run.add_argument(
        "--no-firebase", action="store_true", help="skip the Firebase app (android)"
    )
    run.add_argument(
        "--force", action="store_true", help="rebuild and reinstall even if current"
    )
    run.add_argument(
        "--stale-ok",
        action="store_true",
        help="build the current HEAD even when it is behind origin and cannot be fast-forwarded",
    )
    source = run.add_mutually_exclusive_group()
    source.add_argument(
        "--local",
        action="store_true",
        help="build locally even if a CI build matches (android)",
    )
    source.add_argument(
        "--ci",
        action="store_true",
        help="use the CI build, triggering bundles.yml if there is none (android; needs a clean, pushed tree)",
    )
    run.add_argument(
        "--reinstall",
        action="store_true",
        help="uninstall the app first (after a signature mismatch); box re-provisions the token (android)",
    )
    run.add_argument("--local-seed", action="store_true", help=LOCAL_SEED_HELP)
    run.set_defaults(fn=cmd_run)

    ks = sub.add_parser("keystore", help="the shared box signing key")
    ksub = ks.add_subparsers(dest="keystore_cmd", required=True, parser_class=Parser)
    init = ksub.add_parser(
        "init", help="create the box keystore and upload it as a repo secret for CI"
    )
    init.add_argument(
        "--force", action="store_true", help="replace an existing keystore"
    )
    ksub.add_parser(
        "rotate-password",
        help="move a keystore made with the old fixed password onto a random one (same key)",
    )
    ks.set_defaults(fn=cmd_keystore)

    ci = sub.add_parser(
        "ci-patch",
        help="patch a checkout in place for a CI box APK (no backup; CI discards the tree)",
    )
    ci.add_argument("branch")
    ci.add_argument(
        "--root", default=str(repo_root()), help="the checkout (default: this repo)"
    )
    ci.set_defaults(fn=cmd_ci_patch)

    stop = sub.add_parser(
        "stop", help="stop instances (servers too with no names or `all`)"
    )
    stop.add_argument("branches", nargs="*")
    stop.set_defaults(fn=cmd_stop)

    clean = sub.add_parser(
        "clean", help="remove builds; named branches also drop Firebase and uninstall"
    )
    clean.add_argument("branches", nargs="*")
    clean.set_defaults(fn=cmd_clean)

    prune = sub.add_parser(
        "prune",
        help="remove worktrees without an open PR and orphaned test apps, after a prompt (-y skips it)",
    )
    prune.add_argument("-y", "--yes", action="store_true", help="apply without asking")
    prune.add_argument(
        "--dry-run", action="store_true", help="print the plan only, never ask"
    )
    prune.add_argument(
        "target", nargs="?", help="one android device (default: every registered one)"
    )
    prune.set_defaults(fn=cmd_prune)

    srv = sub.add_parser("server", help="arlesh-server from a worktree")
    ssub = srv.add_subparsers(dest="server_cmd", required=True, parser_class=Parser)
    start = ssub.add_parser("start")
    start.add_argument("branch")
    start.add_argument(
        "--public", action="store_true", help="listen on 0.0.0.0 (LAN and tailnet URLs)"
    )
    start.add_argument("--local-seed", action="store_true", help=LOCAL_SEED_HELP)
    stp = ssub.add_parser("stop")
    stp.add_argument("branches", nargs="*")
    for cmd in ("token", "pin"):
        c = ssub.add_parser(cmd, help=f"arlesh-server {cmd} <args> on that server")
        c.add_argument("branch")
        c.add_argument("rest", nargs=argparse.REMAINDER)
    srv.set_defaults(fn=cmd_server)

    seed = sub.add_parser("seed", help="where new branch databases are seeded from")
    seedsub = seed.add_subparsers(dest="seed_cmd", required=True, parser_class=Parser)
    sset = seedsub.add_parser(
        "set", help="set the server URL; the backup token comes from stdin or a prompt"
    )
    sset.add_argument("url")
    seedsub.add_parser("show", help="what is configured (never prints the token)")
    seed.set_defaults(fn=cmd_seed)

    reseed = sub.add_parser(
        "reseed", help="replace a branch's databases with a fresh server snapshot"
    )
    reseed.add_argument("branch")
    reseed.add_argument("-y", "--yes", action="store_true", help="do not ask first")
    reseed.set_defaults(fn=cmd_reseed)
    return p


def parse_args(argv: Sequence[str]) -> argparse.Namespace:
    args = build_parser().parse_args(list(argv))
    if not getattr(args, "fn", None):
        args.fn = cmd_list
    return args


def main(argv: Sequence[str] | None = None) -> int:
    try:
        load_env_file()
        args = parse_args(sys.argv[1:] if argv is None else argv)
        SEED.local = bool(getattr(args, "local_seed", False))
        args.fn(args)
    except UsageError as exc:
        note(str(exc))
        return 2
    except BoxError as exc:
        note(str(exc))
        return 1
    except KeyboardInterrupt:
        return 130
    return 0


if __name__ == "__main__":
    sys.exit(main())
