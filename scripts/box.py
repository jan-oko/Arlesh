#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.11"
# dependencies = []
# ///
"""Build and run isolated Arlesh instances per branch worktree: `npm run box -- <command>`.

    box list
    box devices add <name> --os android|desktop [--host host[:port]]
    box devices list
    box devices rm <name>
    box run <branch> [<target>] [--server <branch> | --standalone] [--no-firebase] [--force]
    box stop [branch ... | all]
    box clean [branch ... | all]
    box prune [<target>]
    box server start <branch> [--public]
    box server stop [branch ... | all]
    box server token <branch> <arlesh-server token args...>
    box server pin <branch> approve <pin> [--name <device>] | list

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
restored. The APK is signed with the debug keystore. Needs ANDROID_HOME, ANDROID_NDK_HOME and a JDK
(ARLESH_BOX_JAVA_HOME wins over JAVA_HOME). Never pairs: pair once by hand with `adb pair`.
Firebase, per branch: with ARLESH_BOX_FIREBASE_PROJECT set and gcloud application-default
credentials, the package is registered as an Android app and its config written as a gitignored
google-services.json; --no-firebase turns it off.

Servers: `server start <branch>` runs arlesh-server from that worktree's own venv, on its own port,
over a read-only `.backup` copy of the real database. `run` on desktop connects the instance to its
own branch's server (started if it is not up) unless --server picks another or --standalone uses
none. An Android `run` does the same, over a server that listens publicly (restarted public, with a
notice, if it was on loopback): the URL the phone can reach (tailnet or LAN) and a token are handed
to the box app as intent extras, so it starts already connected, without the PIN flow. Either way
the token's client name is the device's name (`desktop` for this machine). `server pin` is for
pairing real (non-box) devices.
"""

from __future__ import annotations

import argparse
import base64
import contextlib
import hashlib
import ipaddress
import json
import os
import re
import shlex
import shutil
import signal
import socket
import sqlite3
import subprocess
import sys
import time
import urllib.error
import urllib.request
from collections.abc import Iterator, Sequence
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path
from typing import Any

BOX_PACKAGE_PREFIX = "com.atai.arlesh.box"
FIREBASE_API = "https://firebase.googleapis.com/v1beta1"
DESKTOP = "desktop"
ANDROID = "android"
OSES = (ANDROID, DESKTOP)
CMD = "npm run box --"
LOOPBACK = "127.0.0.1"
PUBLIC = "0.0.0.0"
MAIN_ACTIVITY = "com.atai.arlesh.MainActivity"
URL_EXTRA = "arlesh_box_url"
TOKEN_EXTRA = "arlesh_box_token"
TAILNET = ipaddress.ip_network("100.64.0.0/10")


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


def worktree_path(name: str) -> Path:
    path = worktrees_dir() / name
    if not path.is_dir():
        raise die(f"No worktree '{name}'. Try: {CMD} list")
    return path


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


def run_cmd(
    cmd: Sequence[str],
    *,
    cwd: Path | None = None,
    env: dict[str, str] | None = None,
    what: str | None = None,
) -> None:
    """Run with inherited stdio; a non-zero exit is a BoxError."""
    merged = {**os.environ, **env} if env else None
    result = subprocess.run(list(cmd), cwd=cwd, env=merged, check=False)
    if result.returncode != 0:
        raise die(f"{what or cmd[0]} failed (exit {result.returncode}).")


def capture(
    cmd: Sequence[str], *, cwd: Path | None = None
) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        list(cmd), cwd=cwd, capture_output=True, text=True, check=False
    )


# ---- Branch names, packages --------------------------------------------------------------------


def box_segment(branch: str) -> str:
    """One Java package segment: lowercase, [a-z0-9_], never starting with a digit."""
    seg = re.sub(r"[^a-z0-9_]", "_", branch.lower())
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
            found[name] = Target(
                name, entry["os"], host if isinstance(host, str) else None
            )
    return found


def save_devices(devices: dict[str, Target]) -> None:
    path = config_file()
    path.parent.mkdir(parents=True, exist_ok=True)
    body = {
        "devices": {
            n: {"os": t.os, **({"host": t.host} if t.host else {})}
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


def device_add(name: str, os_name: str, host: str | None) -> None:
    if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._-]*", name):
        raise UsageError(
            f"'{name}' is not a usable device name (letters, digits, . _ -)."
        )
    if name == DESKTOP:
        raise UsageError("'desktop' is built in: this machine is always a target.")
    if os_name == ANDROID and not host:
        raise UsageError("An android device needs --host host[:port].")
    if os_name == DESKTOP and host:
        raise UsageError(
            "A desktop target runs on this machine: --host does not apply."
        )
    devices = load_devices()
    devices[name] = Target(name, os_name, host)
    save_devices(devices)
    print(f"registered {name} ({os_name}{', ' + host if host else ''})")


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
        print(f"{t.name:<20} {t.os:<8} {t.host or '-'}")
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
        # The symlink to the main checkout's node_modules is box's own, not a change.
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


@contextlib.contextmanager
def patched(files: Sequence[Path]) -> Iterator[None]:
    """Back the files up, and restore them on exit: success, failure, SIGINT, SIGTERM or SIGHUP."""
    old_handlers: dict[int, Any] = {}

    def on_signal(signum: int, _frame: Any) -> None:
        raise SystemExit(128 + signum)

    for sig in (signal.SIGTERM, signal.SIGHUP):
        old_handlers[sig] = signal.signal(sig, on_signal)
    backups = [(f, f.with_name(f.name + ".box-orig")) for f in files]
    try:
        for original, backup in backups:
            if backup.exists():
                # A killed earlier run left the true original here; the file itself is patched.
                os.replace(backup, original)
            shutil.copy2(original, backup)
        yield
    finally:
        for original, backup in backups:
            if backup.exists():
                os.replace(backup, original)
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


def kill_pidfile(pidfile: Path, what: str, name: str) -> None:
    pid = read_pid(pidfile)
    if pid is None:
        pidfile.unlink(missing_ok=True)
        return
    if pid_alive(pid):
        # Take the whole group, but only when the pid is a session leader: a recycled or plain-child
        # pid must not have a signal fired into some unrelated process group.
        try:
            leader = os.getsid(pid) == pid
        except OSError:
            leader = False
        try:
            if leader:
                os.killpg(pid, signal.SIGTERM)
            else:
                os.kill(pid, signal.SIGTERM)
        except OSError:
            pass
        print(f"stopped {name} {what} (pid {pid})")
    pidfile.unlink(missing_ok=True)


def http_up(url: str) -> bool:
    try:
        with urllib.request.urlopen(url, timeout=2):
            return True
    except (OSError, urllib.error.URLError, ValueError):
        return False


def spawn_detached(
    cmd: Sequence[str],
    pidfile: Path,
    log: Path,
    cwd: Path | None,
    env: dict[str, str] | None = None,
) -> int:
    """Start in a new session (so it outlives this shell); the pid recorded is the session leader."""
    merged = {**os.environ, **env} if env else None
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
    pidfile.write_text(str(proc.pid))
    return proc.pid


def ensure_node_modules(wt: Path) -> None:
    # A symlink to the main checkout's costs nothing; npm install must never run in a worktree.
    link = wt / "node_modules"
    if not link.exists() and not link.is_symlink():
        link.symlink_to(main_checkout() / "node_modules")


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
    if not db.exists() and real_db().is_file():
        shutil.copy2(real_db(), db)
        print(f"    seeded from {real_db()}")
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
    """A read-only snapshot of the real database, once: the real file is never written."""
    db = server_db(name)
    if db.exists():
        return
    db.parent.mkdir(parents=True, exist_ok=True)
    if real_db().is_file():
        src = sqlite3.connect(f"file:{real_db()}?mode=ro", uri=True)
        try:
            dst = sqlite3.connect(db)
            try:
                src.backup(dst)
            finally:
                dst.close()
        finally:
            src.close()
        print(f"    seeded from {real_db()} (read-only)")


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


def wait_exit(pid: int | None, seconds: int = 10) -> None:
    for _ in range(seconds * 10):
        if pid is None or not pid_alive(pid):
            return
        time.sleep(0.1)


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
            pid = read_pid(sdir / "server.pid")
            kill_pidfile(sdir / "server.pid", "server", name)
            wait_exit(pid)
        else:
            print(f"  server {name:<21} already up on {port}")
            if current != host and not (current == PUBLIC and host == LOOPBACK):
                note(
                    f"  (it listens on {current}, not {host}: stop it first to change that)"
                )
            return
    build_server(name)
    seed_server(name)
    spawn_detached(
        ["uv", "run", "--no-sync", "arlesh-server", "--db", str(server_db(name)),
         "--host", host, "--port", str(port)],
        sdir / "server.pid",
        sdir / "server.log",
        py_dir(name),
    )  # fmt: skip
    (sdir / "host").write_text(host)
    for _ in range(60):
        if http_up(f"http://127.0.0.1:{port}/openapi.json"):
            print(
                f"  server {name:<21} up on {port}, db {server_db(name)}, logs {sdir / 'server.log'}"
            )
            return
        if not server_running(name):
            break
        time.sleep(1)
    raise die(
        f"arlesh-server '{name}' never came up on port {port} — see {sdir / 'server.log'}"
    )


def server_names(requested: Sequence[str]) -> list[str]:
    if not requested or list(requested) == ["all"]:
        root = servers_dir()
        return (
            sorted(p.name for p in root.iterdir() if p.is_dir())
            if root.is_dir()
            else []
        )
    return list(requested)


def server_stop(requested: Sequence[str]) -> None:
    for name in server_names(requested):
        kill_pidfile(server_dir(name) / "server.pid", "server", name)


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


def is_tailnet_host(host: str) -> bool:
    """Whether a device's host is a tailnet address: 100.64.0.0/10 or a *.ts.net name."""
    name = host.partition(":")[0].lower()
    try:
        return ipaddress.ip_address(name) in TAILNET
    except ValueError:
        return name.endswith(".ts.net")


def parse_interfaces(
    ip_output: str, ifconfig_output: str = ""
) -> list[ipaddress.IPv4Interface]:
    """IPv4 addresses with their prefix, from `ip -o -4 addr` or (macOS) `ifconfig`."""
    found: list[ipaddress.IPv4Interface] = []
    for line in ip_output.splitlines():
        parts = line.split()
        if "inet" in parts and parts.index("inet") + 1 < len(parts):
            with contextlib.suppress(ValueError):
                found.append(ipaddress.IPv4Interface(parts[parts.index("inet") + 1]))
    for line in ifconfig_output.splitlines():
        parts = line.split()
        if parts[:1] == ["inet"] and "netmask" in parts and len(parts) > 3:
            mask = parts[parts.index("netmask") + 1]
            with contextlib.suppress(ValueError):
                if mask.startswith("0x"):
                    mask = str(ipaddress.IPv4Address(int(mask, 16)))
                found.append(ipaddress.IPv4Interface(f"{parts[1]}/{mask}"))
    return found


def local_interfaces() -> list[ipaddress.IPv4Interface]:
    ip_out = (
        capture(["ip", "-o", "-4", "addr", "show"]).stdout if shutil.which("ip") else ""
    )
    ifconfig_out = (
        capture(["ifconfig"]).stdout if not ip_out and shutil.which("ifconfig") else ""
    )
    return parse_interfaces(ip_out, ifconfig_out)


def resolve_host(host: str) -> str:
    try:
        return socket.gethostbyname(host)
    except OSError as exc:
        raise die(
            f"Cannot resolve '{host}' to an address to pick this machine's matching network. "
            f"Register the device by IP: {CMD} devices add <name> --os android --host <ip>[:port]"
        ) from exc


def pick_server_address(
    device_host: str,
    interfaces: Sequence[ipaddress.IPv4Interface],
    tailnet: str,
    resolve: Any = resolve_host,
) -> str:
    """The address of this machine the phone can reach.

    The tailnet address when the device's host is a tailnet IP or a .ts.net name; otherwise the
    address of this machine on the same subnet as the device's host.
    """
    host = device_host.partition(":")[0]
    if is_tailnet_host(host):
        if not tailnet:
            raise die(
                f"{host} is a tailnet host but this machine has no tailnet address (is tailscale up?)."
            )
        return tailnet
    ip = ipaddress.ip_address(resolve(host))
    if ip in TAILNET:
        if not tailnet:
            raise die(
                f"{host} is on the tailnet but this machine has no tailnet address."
            )
        return tailnet
    for iface in interfaces:
        if ip in iface.network and iface.ip not in TAILNET:
            return str(iface.ip)
    raise die(
        f"No address of this machine is on the same network as {host} ({ip}); "
        "is this machine on the phone's Wi-Fi or tailnet?"
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
    made = capture([
        "keytool", "-genkeypair", "-keystore", str(ks), "-storepass", "android", "-keypass", "android",
        "-alias", "androiddebugkey", "-keyalg", "RSA", "-keysize", "2048", "-validity", "10000",
        "-dname", "CN=Android Debug,O=Android,C=US",
    ])  # fmt: skip
    if made.returncode != 0:
        raise die(f"Could not create {ks}.")
    note(f"created {ks}")


def mdns_port(host: str) -> str:
    out = capture(["adb", "mdns", "services"]).stdout
    for line in out.splitlines():
        parts = line.split()
        if len(parts) >= 3 and "_adb-tls-connect" in parts[1] and ":" in parts[2]:
            h, _, p = parts[2].rpartition(":")
            if h == host:
                return p
    return ""


def resolve_device(spec: str) -> str:
    """The adb serial (host:port) for `host[:port]`, connected. Never pairs."""
    need_cmd("adb", "Install platform-tools and put it on PATH (or set ANDROID_HOME).")
    host, _, port = spec.partition(":")
    if not port:
        port = mdns_port(host)
        if not port:
            with contextlib.suppress(OSError):
                ip = socket.gethostbyname(host)
                if ip != host:
                    port = mdns_port(ip)
        if not port:
            raise die(
                f"{host} does not show up in 'adb mdns services' (_adb-tls-connect). Turn on Wireless "
                f"debugging on the device, or register it as host:port. If it was never paired: "
                f"adb pair {host}:<pairing port>. This tool does not pair."
            )
    serial = f"{host}:{port}"
    capture(["adb", "connect", serial])
    if capture(["adb", "-s", serial, "get-state"]).stdout.strip() != "device":
        raise die(
            f"Could not reach {serial} over adb. If it is not paired yet, run: adb pair {host}:<pairing port>"
        )
    return serial


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


def build_android(name: str, wt: Path, firebase: bool) -> None:
    package, label = box_package(name), box_label(name)
    android_env()
    need_cmd("npx", "Install Node.")
    need_cmd("rustup", "Install Rust via rustup.")
    require_space()
    ensure_debug_keystore()
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
        text = gradle.read_text()
        if 'applicationId = "com.atai.arlesh"' not in text:
            raise die("build.gradle.kts has no applicationId to patch.")
        gradle.write_text(
            text.replace(
                'applicationId = "com.atai.arlesh"', f'applicationId = "{package}"'
            )
        )
        strings.write_text(xml_string_file(label))
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
        [str(apksigner), "sign", "--ks", str(debug_keystore()), "--ks-key-alias", "androiddebugkey",
         "--ks-pass", "pass:android", "--key-pass", "pass:android", "--out", str(out), str(unsigned)],
        what="apksigner",
    )  # fmt: skip
    print(f"=== {name}: built {out} ({out.stat().st_size / 1e6:.0f}M) ===")


def install_android(name: str, serial: str) -> None:
    apk = android_apk(name)
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
                f"The installed {box_package(name)} is signed with another key. Uninstall it ({CMD} clean {name}) and retry."
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
    addr = pick_server_address(target.host, local_interfaces(), tailnet_ip())
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


def run_android(name: str, wt: Path, target: Target, args: argparse.Namespace) -> None:
    assert target.host  # registry guarantees it for android
    android_env()
    serial = resolve_device(
        target.host
    )  # before a long build: fail early on a missing device
    stamp = worktree_stamp(wt)
    if is_stale(ANDROID, name, stamp, android_apk(name), args.force):
        build_android(name, wt, firebase=not args.no_firebase)
        record_built(ANDROID, name, stamp)
    else:
        print(f"{name}: android build is current, not rebuilding.")
    had_package = package_installed(serial, box_package(name))
    reason = (
        "forced" if args.force else install_reason(serial, target.name, name, stamp)
    )
    if reason:
        print(f"installing on {target.name}: {reason}")
        install_android(name, serial)
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
            found[t.name] = resolve_device(t.host or "")
        except BoxError as exc:
            note(f"{t.name}: {exc}")
    return found


# ---- Commands -------------------------------------------------------------------------------


def cmd_list(_args: argparse.Namespace) -> None:
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
        print(f"{name:<28} {built_d:<8} {built_a:<8} {port:<7} {head[:50]}")
    names = server_names([])
    if names:
        print(f"\n{'SERVER':<28} {'RUNNING':<8} {'PORT':<7} DATABASE")
        for s in names:
            pf = server_dir(s) / "port"
            print(f"{s:<28} {'yes' if server_running(s) else 'no':<8} "
                  f"{pf.read_text().strip() if pf.exists() else '-':<7} {server_db(s)}")  # fmt: skip
    print(f"\ntargets: {target_names()}\n{free_gb()}G free on /")


def cmd_run(args: argparse.Namespace) -> None:
    target = resolve_target(args.target)
    wt = worktree_path(args.branch)
    if target.os == ANDROID:
        run_android(args.branch, wt, target, args)
    else:
        run_desktop(args.branch, wt, target, args)
    record_last_target(target.name)


def resolve_branches(requested: Sequence[str]) -> list[str]:
    if not requested or list(requested) == ["all"]:
        return all_names()
    return list(requested)


def cmd_stop(args: argparse.Namespace) -> None:
    everything = not args.branches or list(args.branches) == ["all"]
    for name in resolve_branches(args.branches):
        inst = instance_dir(name)
        kill_pidfile(inst / "run.pid", "app", name)
        kill_pidfile(inst / "vite.pid", "vite", name)
        pf = inst / "port"
        if not pf.exists():
            continue
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
    if everything:
        server_stop([])


def cmd_clean(args: argparse.Namespace) -> None:
    named = bool(args.branches) and list(args.branches) != ["all"]
    for name in resolve_branches(args.branches):
        # Only the binary and APK go. An instance's database is state built up while testing.
        (instance_dir(name) / "arlesh").unlink(missing_ok=True)
        android_apk(name).unlink(missing_ok=True)

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
        for name in args.branches:
            package = box_package(name)
            Firebase().remove_package(package)
            uninstall_everywhere(package, serials)
    print(f"{free_gb()}G free.")


def cmd_prune(args: argparse.Namespace) -> None:
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
        serials = {target.name: resolve_device(target.host)}
    else:
        serials = reachable_android_devices()
    for serial in serials.values():
        listed = capture(
            [
                "adb",
                "-s",
                serial,
                "shell",
                "pm",
                "list",
                "packages",
                BOX_PACKAGE_PREFIX + ".",
            ]
        ).stdout
        packages += [
            ln.strip().removeprefix("package:")
            for ln in listed.replace("\r", "").splitlines()
            if ln.strip()
        ]
    removed = 0
    for package in dict.fromkeys(packages):
        if box_owners(package):
            continue
        fb.remove_package(package)
        uninstall_everywhere(package, serials)
        removed += 1
    print(f"pruned {removed} test app(s) whose worktree is gone.")


def cmd_devices(args: argparse.Namespace) -> None:
    if args.devices_cmd == "add":
        device_add(args.name, args.os, args.host)
    elif args.devices_cmd == "rm":
        device_rm(args.name)
    else:
        device_list()


def cmd_server(args: argparse.Namespace) -> None:
    sub = args.server_cmd
    if sub == "start":
        server_start(args.branch, "0.0.0.0" if args.public else "127.0.0.1")
        print_connection(args.branch, args.public)
    elif sub == "stop":
        server_stop(args.branches)
    elif sub == "token":
        if not args.rest:
            raise UsageError(
                f"Usage: {CMD} server token <branch> <arlesh-server token args...>"
            )
        server_cli_checked(args.branch, "token", args.rest)
    else:
        if not args.rest or args.rest[0] not in ("approve", "list"):
            raise UsageError(
                f"Usage: {CMD} server pin <branch> {{approve <pin> [--name <device>] | list}}"
            )
        server_cli_checked(args.branch, "pin", args.rest)


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
    sub.add_parser("list", help="worktrees, builds, servers and targets").set_defaults(
        fn=cmd_list
    )

    dev = sub.add_parser("devices", help="the named target registry")
    dsub = dev.add_subparsers(dest="devices_cmd", required=True, parser_class=Parser)
    add = dsub.add_parser("add", help="register a target")
    add.add_argument("name")
    add.add_argument("--os", required=True, choices=OSES)
    add.add_argument(
        "--host",
        help="host[:port]; an Android host without a port is found by adb mdns",
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
    run.set_defaults(fn=cmd_run)

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

    prune = sub.add_parser("prune", help="remove test apps whose worktree is gone")
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
    stp = ssub.add_parser("stop")
    stp.add_argument("branches", nargs="*")
    for cmd in ("token", "pin"):
        c = ssub.add_parser(cmd, help=f"arlesh-server {cmd} <args> on that server")
        c.add_argument("branch")
        c.add_argument("rest", nargs=argparse.REMAINDER)
    srv.set_defaults(fn=cmd_server)
    return p


def parse_args(argv: Sequence[str]) -> argparse.Namespace:
    args = build_parser().parse_args(list(argv))
    if not getattr(args, "fn", None):
        args.fn = cmd_list
    return args


def main(argv: Sequence[str] | None = None) -> int:
    try:
        args = parse_args(sys.argv[1:] if argv is None else argv)
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
