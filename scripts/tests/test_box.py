"""Tests for scripts/box.py (stdlib unittest): `python -m unittest scripts/tests/test_box.py`."""

from __future__ import annotations

import importlib.util
import os
import stat
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

SCRIPT = Path(__file__).resolve().parent.parent / "box.py"
spec = importlib.util.spec_from_file_location("box", SCRIPT)
assert spec and spec.loader
box = importlib.util.module_from_spec(spec)
sys.modules["box"] = box
spec.loader.exec_module(box)


class IsolatedEnv(unittest.TestCase):
    """Points HOME and the XDG dirs at a temp dir so no test touches the real config or state."""

    def setUp(self) -> None:
        self._tmp = tempfile.TemporaryDirectory()
        self.tmp = Path(self._tmp.name)
        self._saved = dict(os.environ)
        for var in ("HOME", "XDG_CONFIG_HOME", "XDG_STATE_HOME"):
            os.environ[var] = str(self.tmp / var.lower())
        self.addCleanup(self._restore)

    def _restore(self) -> None:
        os.environ.clear()
        os.environ.update(self._saved)
        self._tmp.cleanup()


class PackageNames(unittest.TestCase):
    def test_sanitises(self) -> None:
        self.assertEqual(
            box.box_package("My-Branch.x"), "com.atai.arlesh.box.my_branch_x"
        )

    def test_leading_digit_gets_a_prefix(self) -> None:
        self.assertEqual(
            box.box_package("289-pairing"), "com.atai.arlesh.box.b289_pairing"
        )

    def test_empty_gets_a_prefix(self) -> None:
        self.assertEqual(box.box_segment(""), "b")

    def test_label(self) -> None:
        self.assertEqual(box.box_label("x"), "Arlesh (x)")


def git(cwd: Path, *args: str) -> None:
    subprocess.run(
        ["git", "-c", "user.email=t@t", "-c", "user.name=t", *args],
        cwd=cwd, check=True, capture_output=True,
    )  # fmt: skip


class Stamp(unittest.TestCase):
    def setUp(self) -> None:
        self._tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self._tmp.cleanup)
        self.wt = Path(self._tmp.name)
        git(self.wt, "init", "-q")
        (self.wt / "a.txt").write_text("one\n")
        git(self.wt, "add", ".")
        git(self.wt, "commit", "-qm", "init")

    def test_stable_when_nothing_changes(self) -> None:
        self.assertEqual(box.worktree_stamp(self.wt), box.worktree_stamp(self.wt))

    def test_changes_with_head(self) -> None:
        before = box.worktree_stamp(self.wt)
        git(self.wt, "commit", "-q", "--allow-empty", "-m", "next")
        self.assertNotEqual(before, box.worktree_stamp(self.wt))

    def test_changes_with_tracked_diff(self) -> None:
        before = box.worktree_stamp(self.wt)
        (self.wt / "a.txt").write_text("two\n")
        edited = box.worktree_stamp(self.wt)
        self.assertNotEqual(before, edited)
        (self.wt / "a.txt").write_text("three\n")
        self.assertNotEqual(edited, box.worktree_stamp(self.wt))

    def test_changes_with_untracked_file_but_not_ignored_or_node_modules(self) -> None:
        (self.wt / ".gitignore").write_text("ignored.txt\n")
        git(self.wt, "add", ".")
        git(self.wt, "commit", "-qm", "ignore")
        before = box.worktree_stamp(self.wt)
        (self.wt / "ignored.txt").write_text("x")
        (self.wt / "node_modules").symlink_to(self.wt)
        self.assertEqual(before, box.worktree_stamp(self.wt))
        (self.wt / "new.txt").write_text("x")
        self.assertNotEqual(before, box.worktree_stamp(self.wt))

    def test_is_stale_follows_recorded_stamp(self) -> None:
        with tempfile.TemporaryDirectory() as t:
            os.environ["XDG_STATE_HOME"] = t
            artifact = Path(t) / "bin"
            self.assertTrue(box.is_stale("desktop", "b", "s1", artifact))  # no artifact
            artifact.write_text("x")
            self.assertTrue(
                box.is_stale("desktop", "b", "s1", artifact)
            )  # nothing recorded
            box.record_built("desktop", "b", "s1")
            self.assertFalse(box.is_stale("desktop", "b", "s1", artifact))
            self.assertTrue(box.is_stale("desktop", "b", "s2", artifact))
            self.assertTrue(box.is_stale("desktop", "b", "s1", artifact, force=True))
            self.assertTrue(box.is_stale("android", "b", "s1", artifact))  # per OS


class Devices(IsolatedEnv):
    def test_round_trip_in_xdg_config(self) -> None:
        box.device_add("pixel", "android", "pixel.local")
        box.device_add("laptop", "desktop", None)
        path = self.tmp / "xdg_config_home" / "arlesh" / "box-devices.json"
        self.assertTrue(path.is_file())
        loaded = box.load_devices()
        self.assertEqual(loaded["pixel"], box.Target("pixel", "android", "pixel.local"))
        self.assertEqual(loaded["laptop"], box.Target("laptop", "desktop", None))
        box.device_rm("pixel")
        self.assertEqual(list(box.load_devices()), ["laptop"])

    def test_validation(self) -> None:
        with self.assertRaises(box.UsageError):
            box.device_add("desktop", "desktop", None)
        with self.assertRaises(box.UsageError):
            box.device_add("p", "android", None)
        with self.assertRaises(box.UsageError):
            box.device_add("p", "desktop", "h")
        with self.assertRaises(box.UsageError):
            box.device_rm("nope")

    def test_config_respects_xdg(self) -> None:
        os.environ.pop("XDG_CONFIG_HOME")
        self.assertEqual(
            box.config_file(), self.tmp / "home" / ".config/arlesh/box-devices.json"
        )


class TargetResolution(IsolatedEnv):
    def test_no_target_and_no_history_is_a_usage_error_listing_targets(self) -> None:
        box.device_add("pixel", "android", "pixel.local")
        with self.assertRaises(box.UsageError) as ctx:
            box.resolve_target(None)
        self.assertIn("desktop", str(ctx.exception))
        self.assertIn("pixel (android)", str(ctx.exception))

    def test_default_is_the_last_target_used(self) -> None:
        box.device_add("pixel", "android", "pixel.local")
        box.record_last_target("pixel")
        self.assertEqual(box.resolve_target(None).name, "pixel")
        box.record_last_target("desktop")
        self.assertEqual(box.resolve_target(None).name, "desktop")
        box.record_last_target("pixel")
        box.device_rm("pixel")  # a removed device is no longer a default
        with self.assertRaises(box.UsageError):
            box.resolve_target(None)

    def test_explicit_target_wins_over_last(self) -> None:
        box.device_add("pixel", "android", "pixel.local")
        box.record_last_target("pixel")
        self.assertEqual(box.resolve_target("desktop").name, "desktop")

    def test_desktop_is_built_in(self) -> None:
        self.assertEqual(
            box.resolve_target("desktop"), box.Target("desktop", "desktop")
        )

    def test_named_device(self) -> None:
        box.device_add("pixel", "android", "h:1234")
        self.assertEqual(box.resolve_target("pixel").host, "h:1234")

    def test_unknown_target(self) -> None:
        with self.assertRaises(box.UsageError):
            box.resolve_target("ghost")


class InstallStale(IsolatedEnv):
    """install_reason with a fake `adb` first on PATH."""

    def setUp(self) -> None:
        super().setUp()
        bindir = self.tmp / "bin"
        bindir.mkdir()
        adb = bindir / "adb"
        adb.write_text(
            "#!/bin/sh\n"
            'case "$*" in\n'
            '  *"pm path"*) [ "$FAKE_INSTALLED" = yes ] && echo "package:/data/app/base.apk" '
            "|| exit 1 ;;\n"
            "esac\n"
        )
        adb.chmod(adb.stat().st_mode | stat.S_IXUSR)
        os.environ["PATH"] = f"{bindir}{os.pathsep}{os.environ['PATH']}"

    def test_installed_and_recorded_stamp_matches(self) -> None:
        os.environ["FAKE_INSTALLED"] = "yes"
        box.update_state(
            lambda s: s["installed"].setdefault("pixel", {}).__setitem__("b", "s1")
        )
        self.assertIsNone(box.install_reason("h:1", "pixel", "b", "s1"))

    def test_stamp_differs(self) -> None:
        os.environ["FAKE_INSTALLED"] = "yes"
        box.update_state(
            lambda s: s["installed"].setdefault("pixel", {}).__setitem__("b", "s1")
        )
        self.assertIn(
            "not the one installed", box.install_reason("h:1", "pixel", "b", "s2") or ""
        )

    def test_package_missing_despite_stamp(self) -> None:
        os.environ["FAKE_INSTALLED"] = "no"
        box.update_state(
            lambda s: s["installed"].setdefault("pixel", {}).__setitem__("b", "s1")
        )
        self.assertIn(
            "is not installed", box.install_reason("h:1", "pixel", "b", "s1") or ""
        )

    def test_nothing_recorded(self) -> None:
        os.environ["FAKE_INSTALLED"] = "yes"
        self.assertIsNotNone(box.install_reason("h:1", "pixel", "b", "s1"))

    def test_stamp_is_per_device(self) -> None:
        os.environ["FAKE_INSTALLED"] = "yes"
        box.update_state(
            lambda s: s["installed"].setdefault("other", {}).__setitem__("b", "s1")
        )
        self.assertIsNotNone(box.install_reason("h:1", "pixel", "b", "s1"))


class Patching(unittest.TestCase):
    def test_restored_on_success_and_on_error(self) -> None:
        with tempfile.TemporaryDirectory() as t:
            f = Path(t) / "f.txt"
            f.write_text("orig")
            with box.patched([f]):
                f.write_text("patched")
            self.assertEqual(f.read_text(), "orig")
            with self.assertRaises(RuntimeError), box.patched([f]):
                f.write_text("patched")
                raise RuntimeError
            self.assertEqual(f.read_text(), "orig")
            self.assertFalse((Path(t) / "f.txt.box-orig").exists())

    def test_leftover_backup_from_a_killed_run_wins(self) -> None:
        with tempfile.TemporaryDirectory() as t:
            f = Path(t) / "f.txt"
            f.write_text("patched")
            (Path(t) / "f.txt.box-orig").write_text("orig")
            with box.patched([f]):
                pass
            self.assertEqual(f.read_text(), "orig")


class ClientNaming(unittest.TestCase):
    def test_token_client_is_the_device_name(self) -> None:
        self.assertEqual(box.client_name("pixel"), "pixel")
        self.assertEqual(box.client_name("desktop"), "desktop")

    def test_names_are_kept_inside_the_servers_alphabet_and_length(self) -> None:
        self.assertEqual(box.client_name("my phone!"), "my-phone-")
        self.assertEqual(len(box.client_name("a" * 100)), 64)
        self.assertEqual(box.client_name(""), "device")


class ServerAddress(unittest.TestCase):
    def test_a_tailnet_address_wins(self) -> None:
        self.assertEqual(
            box.pick_server_address("100.100.1.1", "192.168.1.5"), "100.100.1.1"
        )

    def test_without_a_tailnet_the_lan_address(self) -> None:
        self.assertEqual(box.pick_server_address("", "192.168.1.5"), "192.168.1.5")

    def test_neither_is_an_error(self) -> None:
        with self.assertRaises(box.BoxError):
            box.pick_server_address("", "")


class RestartPublic(unittest.TestCase):
    def test_a_loopback_server_is_restarted_public(self) -> None:
        self.assertTrue(box.needs_public_restart(True, "127.0.0.1", "0.0.0.0"))

    def test_a_public_server_is_left_alone(self) -> None:
        self.assertFalse(box.needs_public_restart(True, "0.0.0.0", "0.0.0.0"))

    def test_a_stopped_server_is_just_started(self) -> None:
        self.assertFalse(box.needs_public_restart(False, "127.0.0.1", "0.0.0.0"))

    def test_loopback_wanted_never_restarts(self) -> None:
        self.assertFalse(box.needs_public_restart(True, "0.0.0.0", "127.0.0.1"))
        self.assertFalse(box.needs_public_restart(True, "127.0.0.1", "127.0.0.1"))


class ProvisionDecision(unittest.TestCase):
    URL = "http://192.168.1.5:14701"

    def reason(self, **over: object) -> str | None:
        args: dict = {
            "force": False,
            "record": {"server": "b", "url": self.URL},
            "server": "b",
            "url": self.URL,
            "holder": "pixel/b",
            "holders": {"pixel": "pixel/b"},
            "issued": {"pixel"},
            "client": "pixel",
            "has_local_data": True,
        }
        args.update(over)
        return box.provision_reason(**args)

    def test_a_live_matching_connection_is_reused(self) -> None:
        self.assertIsNone(self.reason())

    def test_force_reprovisions(self) -> None:
        self.assertEqual(self.reason(force=True), "forced")

    def test_a_fresh_install_reprovisions(self) -> None:
        self.assertIsNotNone(self.reason(has_local_data=False))

    def test_a_changed_url_or_server_reprovisions(self) -> None:
        self.assertIsNotNone(self.reason(url="http://100.64.0.9:14701"))
        self.assertIsNotNone(self.reason(server="other"))
        self.assertIsNotNone(self.reason(record=None))

    def test_a_revoked_token_reprovisions(self) -> None:
        self.assertIsNotNone(self.reason(issued=set()))

    def test_a_token_re_minted_by_another_holder_reprovisions(self) -> None:
        self.assertIsNotNone(self.reason(holders={"pixel": "pixel/other"}))


class FakeProc:
    def __init__(self, out: str = "", code: int = 0) -> None:
        self.stdout, self.stderr, self.returncode = out, "", code


class MintToken(IsolatedEnv):
    def setUp(self) -> None:
        super().setUp()
        for name in ("py_dir", "server_db"):
            patcher = mock.patch.object(box, name, lambda n: self.tmp / n)
            patcher.start()
            self.addCleanup(patcher.stop)

    def test_revokes_an_existing_client_then_adds_and_records_the_holder(self) -> None:
        calls: list[list[str]] = []

        def fake_capture(cmd, cwd=None):  # type: ignore[no-untyped-def]
            calls.append(list(cmd))
            if "list" in cmd:
                return FakeProc("pixel\t2026-11-01 10:00\n")
            return FakeProc("tok-123\n" if "add" in cmd else "")

        with mock.patch.object(box, "capture", fake_capture):
            token = box.mint_token("b", "pixel", "pixel/b")
        self.assertEqual(token, "tok-123")
        verbs = [c[c.index("token") + 1] for c in calls]
        self.assertEqual(verbs, ["list", "revoke", "add"])
        self.assertIn("pixel", calls[-1])
        self.assertEqual(box.load_state()["tokens"]["b"]["pixel"], "pixel/b")

    def test_skips_the_revoke_for_a_new_client(self) -> None:
        verbs: list[str] = []

        def fake_capture(cmd, cwd=None):  # type: ignore[no-untyped-def]
            verbs.append(cmd[cmd.index("token") + 1])
            return FakeProc("" if "list" in cmd else "t\n")

        with mock.patch.object(box, "capture", fake_capture):
            box.mint_token("b", "pixel", "pixel/b")
        self.assertEqual(verbs, ["list", "add"])

    def test_a_failed_add_is_an_error_that_does_not_echo_output(self) -> None:
        with (
            mock.patch.object(box, "capture", lambda cmd, cwd=None: FakeProc("", 1)),
            self.assertRaises(box.BoxError),
        ):
            box.mint_token("b", "pixel", "pixel/b")


class LaunchBound(unittest.TestCase):
    def test_am_start_argv_carries_the_extras(self) -> None:
        argv = box.am_start_argv(
            "10.0.0.7:5555",
            "com.atai.arlesh.box.b289_x",
            "http://10.0.0.2:14701",
            "tok_1-A",
        )
        self.assertEqual(argv[:4], ["adb", "-s", "10.0.0.7:5555", "shell"])
        self.assertEqual(
            argv[4],
            "am start -n com.atai.arlesh.box.b289_x/com.atai.arlesh.MainActivity "
            "--es arlesh_box_url http://10.0.0.2:14701 --es arlesh_box_token tok_1-A",
        )

    def test_a_token_with_shell_characters_is_quoted(self) -> None:
        argv = box.am_start_argv("s", "p", "http://h:1", "a b;c")
        self.assertIn("'a b;c'", argv[4])

    def test_bound_launch_force_stops_then_starts_with_a_fake_adb(self) -> None:
        calls: list[list[str]] = []

        def fake_capture(cmd, cwd=None):  # type: ignore[no-untyped-def]
            calls.append(list(cmd))
            return FakeProc("Starting: Intent { cmp=... }\n")

        with mock.patch.object(box, "capture", fake_capture):
            box.launch_android("b", "s:1", ("http://h:1", "tok"))
        self.assertEqual(calls[0][-3:], ["am", "force-stop", "com.atai.arlesh.box.b"])
        self.assertIn("--es arlesh_box_token tok", calls[1][-1])

    def test_unbound_launch_uses_the_launcher_intent(self) -> None:
        calls: list[list[str]] = []

        def fake_capture(cmd, cwd=None):  # type: ignore[no-untyped-def]
            calls.append(list(cmd))
            return FakeProc()

        with mock.patch.object(box, "capture", fake_capture):
            box.launch_android("b", "s:1")
        self.assertEqual(len(calls), 1)
        self.assertIn("monkey", calls[0])

    def test_an_am_error_is_a_failure_without_the_token(self) -> None:
        with (
            mock.patch.object(
                box,
                "capture",
                lambda cmd, cwd=None: FakeProc(
                    "Error: Activity class does not exist.\n"
                ),
            ),
            self.assertRaises(box.BoxError) as ctx,
        ):
            box.launch_android("b", "s:1", ("http://h:1", "SECRET"))
        self.assertNotIn("SECRET", str(ctx.exception))


class Arguments(unittest.TestCase):
    def test_run_takes_branch_and_positional_target(self) -> None:
        a = box.parse_args(["run", "201-x", "pixel", "--server", "9f0", "--force"])
        self.assertEqual(
            (a.branch, a.target, a.server, a.force), ("201-x", "pixel", "9f0", True)
        )

    def test_run_without_target_parses(self) -> None:
        a = box.parse_args(["run", "b"])
        self.assertIsNone(a.target)

    def test_no_target_flag(self) -> None:
        with self.assertRaises(box.UsageError):
            box.parse_args(["run", "b", "--target", "x"])

    def test_android_run_accepts_server_and_standalone(self) -> None:
        a = box.parse_args(["run", "b", "pixel", "--server", "x"])
        self.assertEqual((a.server, a.standalone), ("x", False))
        self.assertTrue(
            box.parse_args(["run", "b", "pixel", "--standalone"]).standalone
        )

    def test_server_and_standalone_are_exclusive(self) -> None:
        with self.assertRaises(box.UsageError):
            box.parse_args(["run", "b", "desktop", "--server", "x", "--standalone"])

    def test_dropped_commands(self) -> None:
        for cmd in ("apk", "start"):
            with self.assertRaises(box.UsageError):
                box.parse_args([cmd, "b"])

    def test_devices_add(self) -> None:
        a = box.parse_args(
            ["devices", "add", "pixel", "--os", "android", "--host", "p.local:5555"]
        )
        self.assertEqual((a.name, a.os, a.host), ("pixel", "android", "p.local:5555"))
        with self.assertRaises(box.UsageError):
            box.parse_args(["devices", "add", "x", "--os", "ios"])

    def test_prune_optional_target(self) -> None:
        self.assertIsNone(box.parse_args(["prune"]).target)
        self.assertEqual(box.parse_args(["prune", "pixel"]).target, "pixel")

    def test_server_passthrough(self) -> None:
        a = box.parse_args(["server", "token", "x", "add", "phone", "--name", "n"])
        self.assertEqual((a.branch, a.rest), ("x", ["add", "phone", "--name", "n"]))
        a = box.parse_args(["server", "pin", "x", "approve", "123", "--name", "d"])
        self.assertEqual(a.rest, ["approve", "123", "--name", "d"])
        self.assertTrue(box.parse_args(["server", "start", "x", "--public"]).public)

    def test_default_command_is_list(self) -> None:
        self.assertIs(box.parse_args([]).fn, box.cmd_list)


if __name__ == "__main__":
    unittest.main()
