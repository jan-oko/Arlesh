"""Tests for scripts/box.py (stdlib unittest): `python -m unittest scripts/tests/test_box.py`."""

from __future__ import annotations

import base64
import importlib.util
import json
import os
import stat
import subprocess
import sys
import tempfile
import time
import unittest
from dataclasses import replace
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


class CiPatch(unittest.TestCase):
    def make_tree(self, root: Path) -> tuple[Path, Path]:
        app = root / "src-tauri/gen/android/app"
        (app / "src/main/res/values").mkdir(parents=True)
        gradle, strings = (
            app / "build.gradle.kts",
            app / "src/main/res/values/strings.xml",
        )
        gradle.write_text('android {\n  applicationId = "com.atai.arlesh"\n}\n')
        strings.write_text(
            '<resources><string name="app_name">Arlesh</string></resources>'
        )
        return gradle, strings

    def test_patches_both_files_idempotently_with_the_run_names(self) -> None:
        branch = "289-pairing"
        with tempfile.TemporaryDirectory() as tmp:
            gradle, strings = self.make_tree(Path(tmp))
            args = ["ci-patch", branch, "--root", tmp]
            self.assertEqual(box.main(args), 0)
            first = (gradle.read_text(), strings.read_text())
            self.assertIn(f'applicationId = "{box.box_package(branch)}"', first[0])
            self.assertIn("Arlesh (289-pairing)", first[1])
            self.assertEqual(
                box.box_package(branch), "com.atai.arlesh.box.b289_pairing"
            )
            self.assertEqual(box.main(args), 0)
            self.assertEqual((gradle.read_text(), strings.read_text()), first)

    def test_missing_project_fails(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            self.assertEqual(box.main(["ci-patch", "x", "--root", tmp]), 1)


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


MDNS_LINE = "adb-R5CT123ABC-xYz1Qw _adb-tls-connect._tcp. 192.168.68.111:33691"


class DeviceResolution(IsolatedEnv):
    """A fake adb that lists $FAKE_MDNS, answers connect/get-state, and reports its serial."""

    def setUp(self) -> None:
        super().setUp()
        bindir = self.tmp / "bin"
        bindir.mkdir()
        adb = bindir / "adb"
        adb.write_text(
            "#!/bin/sh\n"
            'case "$*" in\n'
            '  "mdns services") echo "List of discovered mdns services"; '
            'printf "%s\\n" "$FAKE_MDNS" ;;\n'
            "  *get-state*) echo device ;;\n"
            "  *get-serialno*) echo R5CT123ABC ;;\n"
            "esac\n"
        )
        adb.chmod(adb.stat().st_mode | stat.S_IXUSR)
        os.environ["PATH"] = f"{bindir}{os.pathsep}{os.environ['PATH']}"
        os.environ["FAKE_MDNS"] = MDNS_LINE

    def resolve(
        self, host: str, adb_serial: str | None = None, ip: str | None = None
    ) -> str:
        box.device_add("miniseer", "android", host)
        if adb_serial:
            box.save_devices(
                {"miniseer": box.Target("miniseer", "android", host, adb_serial)}
            )
        info = [(2, 1, 6, "", (ip, 0))] if ip else []
        with mock.patch.object(box.socket, "getaddrinfo", return_value=info):
            return box.resolve_device(box.load_devices()["miniseer"])

    def test_registered_name_resolving_to_the_mdns_ip(self) -> None:
        self.assertEqual(
            self.resolve("miniseer", ip="192.168.68.111"), "192.168.68.111:33691"
        )

    def test_serial_is_stored_after_first_sight(self) -> None:
        self.resolve("miniseer", ip="192.168.68.111")
        self.assertEqual(box.load_devices()["miniseer"].adb_serial, "R5CT123ABC")

    def test_serial_matches_when_the_ip_differs(self) -> None:
        self.assertEqual(
            self.resolve("100.64.0.9", adb_serial="R5CT123ABC", ip="100.64.0.9"),
            "100.64.0.9:33691",  # adbd listens on every interface: the tailnet address, LAN port
        )

    def test_nothing_matches_lists_the_mdns_entries(self) -> None:
        with self.assertRaises(box.BoxError) as ctx:
            self.resolve("other", ip="10.0.0.5")
        self.assertIn("adb-R5CT123ABC-xYz1Qw", str(ctx.exception))
        self.assertIn("192.168.68.111:33691", str(ctx.exception))

    def test_registered_port_is_tried_when_not_advertised(self) -> None:
        os.environ["FAKE_MDNS"] = ""
        self.assertEqual(self.resolve("10.0.0.5:5555", ip="10.0.0.5"), "10.0.0.5:5555")

    def test_serial_parsed_from_the_service_name(self) -> None:
        e = box.MdnsEntry("adb-R5CT123ABC-xYz1Qw", "1.2.3.4", "1")
        self.assertEqual(e.hardware_serial, "R5CT123ABC")


class OriginFixture(IsolatedEnv):
    """A temp main checkout cloned from a bare "origin" holding master, qa/2026-11-round, feature."""

    def setUp(self) -> None:
        super().setUp()
        self.origin = self.tmp / "origin.git"
        seed = self.tmp / "seed"
        main = self.tmp / "main"
        subprocess.run(
            ["git", "init", "-q", "--bare", "-b", "master", str(self.origin)],
            check=True,
        )
        seed.mkdir()
        git(seed, "init", "-q", "-b", "master")
        git(seed, "remote", "add", "origin", str(self.origin))
        (seed / "a.txt").write_text("one\n")
        git(seed, "add", ".")
        git(seed, "commit", "-qm", "init")
        for branch in ("qa/2026-11-round", "feature"):
            git(seed, "checkout", "-q", "-b", branch, "master")
            git(seed, "commit", "-q", "--allow-empty", "-m", branch)
        git(seed, "push", "-q", "origin", "--all")
        self.seed = seed
        subprocess.run(["git", "clone", "-q", str(self.origin), str(main)], check=True)
        self.main = main
        patcher = mock.patch.object(box, "main_checkout", return_value=main)
        patcher.start()
        self.addCleanup(patcher.stop)

    def push_to_origin(self, branch: str) -> None:
        git(self.seed, "checkout", "-q", branch)
        git(self.seed, "commit", "-q", "--allow-empty", "-m", "more")
        git(self.seed, "push", "-q", "origin", branch)


class Worktrees(OriginFixture):
    def test_slash_maps_to_dash_everywhere(self) -> None:
        self.assertEqual(box.dir_name("qa/2026-11-round"), "qa-2026-11-round")
        self.assertEqual(
            box.box_package("qa/2026-11-round"), box.box_package("qa-2026-11-round")
        )
        path = box.ensure_worktree("qa/2026-11-round")
        self.assertEqual(path, self.main / ".claude/worktrees/qa-2026-11-round")
        self.assertEqual(box.all_names(), ["qa-2026-11-round"])
        self.assertEqual(
            box.box_owners(box.box_package("qa/2026-11-round")), ["qa-2026-11-round"]
        )
        self.assertEqual(
            box.resolve_branches(["qa/2026-11-round"]), ["qa-2026-11-round"]
        )

    def test_creates_from_origin_with_tracking_and_node_modules(self) -> None:
        path = box.ensure_worktree("feature")
        self.assertEqual(box.worktree_branch(path), "feature")
        up = box.git_in(path, "rev-parse", "--abbrev-ref", "feature@{u}").stdout.strip()
        self.assertEqual(up, "origin/feature")
        self.assertTrue((path / "node_modules").is_symlink())

    def test_existing_local_branch_is_reused(self) -> None:
        git(self.main, "branch", "feature", "origin/feature")
        path = box.ensure_worktree("feature")
        self.assertEqual(box.worktree_branch(path), "feature")

    def test_missing_branch_is_an_error_and_makes_nothing(self) -> None:
        with self.assertRaises(box.BoxError) as ctx:
            box.ensure_worktree("nope")
        self.assertIn("neither locally nor on origin", str(ctx.exception))
        self.assertEqual(box.all_names(), [])
        self.assertFalse(box.ref_exists(self.main, "refs/heads/nope"))

    def test_dir_holding_an_unrelated_branch_names_the_expected_one(self) -> None:
        git(self.main, "branch", "feature", "origin/feature")
        folder = box.worktrees_dir() / "qa-2026-11-round"
        git(self.main, "worktree", "add", str(folder), "feature")
        with self.assertRaises(box.BoxError) as ctx:
            box.ensure_worktree("qa-2026-11-round")
        self.assertIn("holds feature", str(ctx.exception))
        self.assertIn("run feature", str(ctx.exception))

    def test_behind_origin_is_reported_and_nothing_is_pulled(self) -> None:
        path = box.ensure_worktree("feature")
        before = box.git_in(path, "rev-parse", "HEAD").stdout
        self.push_to_origin("feature")
        with mock.patch.object(box, "note") as note:
            self.assertEqual(box.ensure_worktree("feature"), path)
        note.assert_called_once_with(
            "feature is 1 commits behind origin; pull to update"
        )
        self.assertEqual(box.git_in(path, "rev-parse", "HEAD").stdout, before)

    def test_up_to_date_is_silent(self) -> None:
        box.ensure_worktree("feature")
        with mock.patch.object(box, "note") as note:
            box.ensure_worktree("feature")
        note.assert_not_called()


class Patching(IsolatedEnv):
    def setUp(self) -> None:
        super().setUp()
        self.repo = self.tmp / "repo"
        self.repo.mkdir()
        self.f = self.repo / "f.txt"
        self.f.write_text("orig")

    def test_restored_on_success_and_on_error(self) -> None:
        with box.patched([self.f]):
            self.f.write_text("patched")
        self.assertEqual(self.f.read_text(), "orig")
        with self.assertRaises(RuntimeError), box.patched([self.f]):
            self.f.write_text("patched")
            raise RuntimeError
        self.assertEqual(self.f.read_text(), "orig")
        self.assertEqual([p.name for p in self.repo.iterdir()], ["f.txt"])

    def test_backup_is_never_inside_the_repo(self) -> None:
        with box.patched([self.f]):
            backup = box.backup_for(self.f)
            self.assertTrue(backup.exists())
            self.assertFalse(backup.is_relative_to(self.repo))
            self.assertTrue(backup.is_relative_to(box.state_dir() / "backups"))
            self.assertEqual([p.name for p in self.repo.iterdir()], ["f.txt"])

    def test_leftover_backup_from_a_killed_run_wins(self) -> None:
        killed = box.patched([self.f])
        killed.__enter__()  # never exited: the run was killed
        self.f.write_text("patched")
        with box.patched([self.f]):
            self.assertEqual(self.f.read_text(), "orig")
        self.assertEqual(self.f.read_text(), "orig")
        self.assertEqual(list(box.backups_dir().iterdir()), [])

    def test_old_style_leftover_beside_the_file_is_restored(self) -> None:
        self.f.write_text("patched")
        legacy = self.repo / "f.txt.box-orig"
        legacy.write_text("orig")
        with box.patched([self.f]):
            self.assertEqual(self.f.read_text(), "orig")
        self.assertEqual(self.f.read_text(), "orig")
        self.assertFalse(legacy.exists())


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


FAKE_GH = """#!__PY__
import json, os, sys
d = os.environ["FAKE_GH_DIR"]
state = json.load(open(d + "/state.json"))
args = sys.argv[1:]
open(d + "/calls.log", "a").write(" ".join(args) + "\\n")
def save():
    json.dump(state, open(d + "/state.json", "w"))
if args[:2] == ["auth", "status"]:
    sys.exit(0 if state.get("auth", True) else 1)
if args[:2] == ["run", "list"]:
    print(json.dumps(state["runs"]))
elif args[:1] == ["api"]:
    run_id = args[1].split("/")[-2]
    print("\\n".join(state["artifacts"].get(run_id, [])))
elif args[:2] == ["workflow", "run"]:
    run = state.pop("on_trigger")
    state["runs"].append(run)
    state["artifacts"][str(run["databaseId"])] = state.pop("trigger_artifacts", [])
    save()
elif args[:2] == ["run", "download"]:
    out = args[args.index("-D") + 1]
    open(out + "/arlesh-box-x.apk", "w").write("apk-of-run-" + args[2])
elif args[:2] == ["secret", "set"]:
    open(d + "/secret.txt", "w").write(sys.stdin.read())
    open(d + "/secret.args", "w").write(" ".join(args))
    sys.exit(0 if state.get("secret_ok", True) else 1)
"""

FAKE_KEYTOOL = """#!__PY__
import sys
args = sys.argv[1:]
open(args[args.index("-keystore") + 1], "w").write("KEYSTORE:" + " ".join(args))
"""


def write_exe(path: Path, text: str) -> None:
    path.write_text(text.replace("__PY__", sys.executable))
    path.chmod(path.stat().st_mode | stat.S_IXUSR)


class CiFixture(IsolatedEnv):
    """A pushed git clone on branch `feat`, plus fake `gh`, `adb` and `keytool` first on PATH."""

    def git(self, *args: str, cwd: Path | None = None) -> str:
        return subprocess.run(
            ["git", *args],
            cwd=cwd or self.wt,
            check=True,
            capture_output=True,
            text=True,
            env={**os.environ, "GIT_AUTHOR_NAME": "t", "GIT_AUTHOR_EMAIL": "t@t",
                 "GIT_COMMITTER_NAME": "t", "GIT_COMMITTER_EMAIL": "t@t"},
        ).stdout.strip()  # fmt: skip

    def setUp(self) -> None:
        super().setUp()
        self.wt = self.tmp / "wt"
        origin = self.tmp / "origin.git"
        self.git("init", "--bare", "-q", str(origin), cwd=self.tmp)
        self.git("init", "-q", "-b", "feat", str(self.wt), cwd=self.tmp)
        self.git("remote", "add", "origin", "git@github.com:jan-oko/Arlesh.git")
        (self.wt / "f.txt").write_text("1")
        self.git("add", ".")
        self.git("commit", "-q", "-m", "one")
        # Pushing is simulated: the remote-tracking ref is what box compares HEAD with.
        self.git("update-ref", "refs/remotes/origin/feat", "HEAD")
        self.sha = self.git("rev-parse", "HEAD")
        self.artifact = f"arlesh-box-feat-{self.sha[:7]}-android-apk"

        self.bin = self.tmp / "bin"
        self.bin.mkdir()
        self.gh_dir = self.tmp / "gh"
        self.gh_dir.mkdir()
        os.environ["FAKE_GH_DIR"] = str(self.gh_dir)
        os.environ["ARLESH_BOX_POLL_SECONDS"] = "0"
        write_exe(self.bin / "gh", FAKE_GH)
        write_exe(self.bin / "keytool", FAKE_KEYTOOL)
        os.environ["PATH"] = f"{self.bin}{os.pathsep}{os.environ['PATH']}"
        self.gh_state()

    def gh_state(self, **state: object) -> None:
        base: dict[str, object] = {"auth": True, "runs": [], "artifacts": {}}
        (self.gh_dir / "state.json").write_text(json.dumps({**base, **state}))

    def run_entry(self, run_id: int = 7, **over: object) -> dict[str, object]:
        return {"databaseId": run_id, "headSha": self.sha, "status": "completed",
                "conclusion": "success", "event": "workflow_dispatch",
                "url": f"https://github.com/jan-oko/Arlesh/actions/runs/{run_id}", **over}  # fmt: skip

    def gh_calls(self) -> list[str]:
        log = self.gh_dir / "calls.log"
        return log.read_text().splitlines() if log.exists() else []

    def matching_run(self) -> None:
        self.gh_state(runs=[self.run_entry()], artifacts={"7": [self.artifact]})


class CiDecision(CiFixture):
    def test_clean_pushed_with_a_run_uses_ci(self) -> None:
        self.matching_run()
        apk = box.pick_ci_build(self.wt, box.AUTO)
        assert apk is not None
        self.assertEqual(apk.read_text(), "apk-of-run-7")
        self.assertEqual(apk.parent, box.ci_cache_dir())
        self.assertTrue(
            any(
                c.startswith("run download 7 -n " + self.artifact)
                for c in self.gh_calls()
            )
        )

    def test_dirty_tree_builds_locally_without_asking_gh(self) -> None:
        self.matching_run()
        (self.wt / "f.txt").write_text("changed")
        self.assertIsNone(box.pick_ci_build(self.wt, box.AUTO))
        self.assertEqual(self.gh_calls(), [])

    def test_untracked_file_counts_as_dirty_but_node_modules_does_not(self) -> None:
        self.matching_run()
        (self.wt / "node_modules").symlink_to(self.tmp)
        self.assertIsNotNone(box.pick_ci_build(self.wt, box.AUTO))
        (self.wt / "new.txt").write_text("x")
        self.assertIsNone(box.pick_ci_build(self.wt, box.AUTO))

    def test_unpushed_head_builds_locally(self) -> None:
        self.matching_run()
        (self.wt / "f.txt").write_text("2")
        self.git("commit", "-q", "-am", "two")
        self.assertIsNone(box.pick_ci_build(self.wt, box.AUTO))

    def test_no_run_for_head_builds_locally(self) -> None:
        self.gh_state(
            runs=[self.run_entry(headSha="0" * 40)], artifacts={"7": [self.artifact]}
        )
        self.assertIsNone(box.pick_ci_build(self.wt, box.AUTO))

    def test_failed_run_or_missing_artifact_does_not_count(self) -> None:
        self.gh_state(
            runs=[self.run_entry(conclusion="failure")],
            artifacts={"7": [self.artifact]},
        )
        self.assertIsNone(box.pick_ci_build(self.wt, box.AUTO))
        self.gh_state(runs=[self.run_entry()], artifacts={"7": []})
        self.assertIsNone(box.pick_ci_build(self.wt, box.AUTO))

    def test_local_flag_wins(self) -> None:
        self.matching_run()
        self.assertIsNone(box.pick_ci_build(self.wt, box.LOCAL))
        self.assertEqual(self.gh_calls(), [])

    def test_ci_flag_triggers_waits_and_downloads(self) -> None:
        self.gh_state(
            on_trigger=self.run_entry(run_id=42),
            trigger_artifacts=[self.artifact],
        )
        apk = box.pick_ci_build(self.wt, box.CI)
        assert apk is not None
        self.assertEqual(apk.read_text(), "apk-of-run-42")
        calls = self.gh_calls()
        self.assertTrue(
            any(
                c.startswith(
                    "workflow run bundles.yml --ref feat -f box=true -f publish=false"
                )
                for c in calls
            )
        )

    def test_ci_flag_waits_for_an_unfinished_run(self) -> None:
        self.gh_state(
            on_trigger=self.run_entry(run_id=43, status="in_progress", conclusion=None),
            trigger_artifacts=[self.artifact],
        )
        calls = {"n": 0}
        real = box.list_bundle_runs

        def finishing(wt, branch):  # type: ignore[no-untyped-def]
            runs = real(wt, branch)
            calls["n"] += 1
            if calls["n"] >= 4:  # finish after a few polls
                for r in runs:
                    r.update(status="completed", conclusion="success")
            return runs

        with mock.patch.object(box, "list_bundle_runs", finishing):
            apk = box.pick_ci_build(self.wt, box.CI)
        assert apk is not None
        self.assertEqual(apk.read_text(), "apk-of-run-43")

    def test_ci_flag_reports_a_failed_run(self) -> None:
        self.gh_state(on_trigger=self.run_entry(run_id=44, conclusion="failure"))
        with self.assertRaises(box.BoxError) as ctx:
            box.pick_ci_build(self.wt, box.CI)
        self.assertIn("failed", str(ctx.exception))

    def test_ci_flag_with_a_dirty_or_unpushed_tree_is_an_error(self) -> None:
        (self.wt / "f.txt").write_text("changed")
        with self.assertRaises(box.BoxError) as ctx:
            box.pick_ci_build(self.wt, box.CI)
        self.assertIn("uncommitted", str(ctx.exception))
        self.git("commit", "-q", "-am", "two")
        with self.assertRaises(box.BoxError) as ctx:
            box.pick_ci_build(self.wt, box.CI)
        self.assertIn("not pushed", str(ctx.exception))

    def test_cache_hit_downloads_nothing(self) -> None:
        self.matching_run()
        first = box.pick_ci_build(self.wt, box.AUTO)
        before = len(self.gh_calls())
        self.gh_state()  # even with no runs and no network, the cache answers
        second = box.pick_ci_build(self.wt, box.AUTO)
        self.assertEqual(first, second)
        self.assertEqual(len(self.gh_calls()), before)

    def test_cache_is_per_commit(self) -> None:
        self.matching_run()
        box.pick_ci_build(self.wt, box.AUTO)
        (self.wt / "f.txt").write_text("2")
        self.git("commit", "-q", "-am", "two")
        self.git("update-ref", "refs/remotes/origin/feat", "HEAD")
        self.gh_state()
        self.assertIsNone(box.pick_ci_build(self.wt, box.AUTO))

    def test_gh_missing_falls_back_to_local(self) -> None:
        real = box.shutil.which
        with mock.patch.object(
            box.shutil, "which", lambda n: None if n == "gh" else real(n)
        ):
            self.assertIsNone(box.pick_ci_build(self.wt, box.AUTO))
            with self.assertRaises(box.BoxError) as ctx:
                box.pick_ci_build(self.wt, box.CI)
        self.assertIn("gh", str(ctx.exception))

    def test_gh_unauthenticated_falls_back_to_local(self) -> None:
        self.gh_state(auth=False)
        self.assertIsNone(box.pick_ci_build(self.wt, box.AUTO))
        with self.assertRaises(box.BoxError):
            box.pick_ci_build(self.wt, box.CI)

    def test_ci_mode_from_flags(self) -> None:
        def mode(*flags: str) -> str:
            return box.ci_mode(box.parse_args(["run", "b", "pixel", *flags]))

        self.assertEqual(mode(), box.AUTO)
        self.assertEqual(mode("--local"), box.LOCAL)
        self.assertEqual(mode("--ci"), box.CI)
        with self.assertRaises(box.UsageError):
            box.parse_args(["run", "b", "--ci", "--local"])


class KeystoreInit(CiFixture):
    def test_writes_the_file_and_sets_the_secret(self) -> None:
        with mock.patch.object(box, "repo_root", lambda: self.wt):
            box.keystore_init(force=False)
        ks = box.box_keystore()
        self.assertTrue(ks.is_file())
        self.assertIn("-alias arlesh-box", ks.read_text())
        self.assertEqual(oct(ks.stat().st_mode & 0o777), "0o600")
        self.assertEqual(
            (self.gh_dir / "secret.args").read_text(),
            "secret set ARLESH_BOX_KEYSTORE_B64 --repo jan-oko/Arlesh",
        )
        self.assertEqual(
            base64.b64decode((self.gh_dir / "secret.txt").read_text()), ks.read_bytes()
        )

    def test_refuses_to_overwrite_without_force(self) -> None:
        ks = box.box_keystore()
        ks.parent.mkdir(parents=True)
        ks.write_text("old")
        with mock.patch.object(box, "repo_root", lambda: self.wt):
            with self.assertRaises(box.BoxError) as ctx:
                box.keystore_init(force=False)
            self.assertIn("--force", str(ctx.exception))
            self.assertEqual(ks.read_text(), "old")
            self.assertFalse((self.gh_dir / "secret.txt").exists())
            box.keystore_init(force=True)
        self.assertNotEqual(ks.read_text(), "old")

    def test_a_failed_upload_keeps_the_old_keystore(self) -> None:
        ks = box.box_keystore()
        ks.parent.mkdir(parents=True)
        ks.write_text("old")
        self.gh_state(secret_ok=False)
        with (
            mock.patch.object(box, "repo_root", lambda: self.wt),
            self.assertRaises(box.BoxError),
        ):
            box.keystore_init(force=True)
        self.assertEqual(ks.read_text(), "old")

    def test_origin_repo_forms(self) -> None:
        for url in (
            "git@github.com:jan-oko/Arlesh.git",
            "https://github.com/jan-oko/Arlesh",
            "https://github.com/jan-oko/Arlesh.git",
        ):
            self.git("remote", "set-url", "origin", url)
            self.assertEqual(box.origin_repo(self.wt), "jan-oko/Arlesh")


class SigningSelection(IsolatedEnv):
    def test_shared_keystore_when_present(self) -> None:
        ks = box.box_keystore()
        ks.parent.mkdir(parents=True)
        ks.write_text("k")
        sign = box.choose_signing()
        self.assertEqual(
            (sign.keystore, sign.alias, sign.shared), (ks, "arlesh-box", True)
        )

    def test_debug_keystore_fallback_with_a_notice(self) -> None:
        debug = box.home() / ".android" / "debug.keystore"
        debug.parent.mkdir(parents=True)
        debug.write_text("d")
        with mock.patch.object(box, "note") as note:
            sign = box.choose_signing()
        self.assertEqual(
            (sign.keystore, sign.alias, sign.shared), (debug, "androiddebugkey", False)
        )
        self.assertIn("keystore init", note.call_args.args[0])


class InstallMismatch(IsolatedEnv):
    def setUp(self) -> None:
        super().setUp()
        bindir = self.tmp / "bin"
        bindir.mkdir()
        self.log = self.tmp / "adb.log"
        write_exe(
            bindir / "adb",
            "#!__PY__\nimport os, sys\n"
            f"open({str(self.log)!r}, 'a').write(' '.join(sys.argv[1:]) + '\\n')\n"
            f"gone = os.path.exists({str(self.tmp / 'uninstalled')!r})\n"
            "if 'uninstall' in sys.argv:\n"
            f"    open({str(self.tmp / 'uninstalled')!r}, 'w').write('x')\n"
            "elif 'install' in sys.argv and not gone:\n"
            "    print('Failure [INSTALL_FAILED_UPDATE_INCOMPATIBLE: signatures do not match]')\n"
            "    sys.exit(1)\n",
        )
        os.environ["PATH"] = f"{bindir}{os.pathsep}{os.environ['PATH']}"
        apk = box.android_apk("b")
        apk.parent.mkdir(parents=True)
        apk.write_text("apk")

    def test_mismatch_says_so_and_offers_reinstall_without_uninstalling(self) -> None:
        with self.assertRaises(box.BoxError) as ctx:
            box.install_android("b", "s:1")
        self.assertIn("different key", str(ctx.exception))
        self.assertIn("--reinstall", str(ctx.exception))
        self.assertNotIn("uninstall", self.log.read_text())

    def test_reinstall_uninstalls_first(self) -> None:
        box.install_android("b", "s:1", reinstall=True)
        lines = self.log.read_text().splitlines()
        self.assertIn("uninstall com.atai.arlesh.box.b", lines[0])
        self.assertIn("install -r", lines[1])


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

    def test_run_source_flags(self) -> None:
        a = box.parse_args(["run", "b", "pixel", "--ci", "--reinstall"])
        self.assertEqual((a.ci, a.local, a.reinstall), (True, False, True))

    def test_keystore_init(self) -> None:
        a = box.parse_args(["keystore", "init", "--force"])
        self.assertEqual((a.fn, a.force), (box.cmd_keystore, True))

    def test_default_command_is_list(self) -> None:
        self.assertIs(box.parse_args([]).fn, box.cmd_list)


def fake_bin(root: Path, name: str, script: str) -> Path:
    """An executable `name` in `root/bin`, for a test that puts that directory first on PATH."""
    bindir = root / "bin"
    bindir.mkdir(exist_ok=True)
    path = bindir / name
    path.write_text("#!/bin/sh\n" + script + "\n")
    path.chmod(0o755)
    return bindir


class ProjectEnv(unittest.TestCase):
    def test_the_scripts_virtualenv_is_not_leaked_into_children(self) -> None:
        leaked = {
            "VIRTUAL_ENV": "/x/uv/environments-v2/box-1",
            "UV_RUN_RECURSION_DEPTH": "1",
            "UV_INTERNAL__PARENT_INTERPRETER": "/x/python",
            "KEEP": "1",
        }
        with mock.patch.dict(os.environ, leaked):
            env = box.project_env({"EXTRA": "2"})
        self.assertEqual((env["KEEP"], env["EXTRA"]), ("1", "2"))
        for gone in (
            "VIRTUAL_ENV",
            "UV_RUN_RECURSION_DEPTH",
            "UV_INTERNAL__PARENT_INTERPRETER",
        ):
            self.assertNotIn(gone, env)

    def test_spawn_detached_passes_the_clean_env_and_can_skip_the_pidfile(self) -> None:
        with (
            tempfile.TemporaryDirectory() as tmp,
            mock.patch.dict(os.environ, {"VIRTUAL_ENV": "/leak"}),
            mock.patch.object(box.subprocess, "Popen") as popen,
        ):
            popen.return_value.pid = 4242
            pidfile = Path(tmp) / "x.pid"
            self.assertEqual(
                box.spawn_detached(["true"], None, Path(tmp) / "x.log", None), 4242
            )
            self.assertFalse(pidfile.exists())
            self.assertNotIn("VIRTUAL_ENV", popen.call_args.kwargs["env"])
            self.assertTrue(popen.call_args.kwargs["start_new_session"])


class StopServer(IsolatedEnv):
    def test_a_process_that_ignores_sigterm_is_killed_with_its_group(self) -> None:
        proc = subprocess.Popen(
            ["sh", "-c", "trap '' TERM; sleep 30 & wait"], start_new_session=True
        )
        self.addCleanup(proc.kill)
        time.sleep(0.3)  # let the shell install its trap
        with mock.patch.object(box, "note"):
            self.assertTrue(box.stop_pid(proc.pid, grace=0.5))
        self.assertIsNotNone(proc.poll())
        self.assertFalse(box.pid_alive(proc.pid))

    def test_stop_pid_on_a_dead_pid_is_a_no_op(self) -> None:
        proc = subprocess.Popen(["true"])
        proc.wait()
        self.assertFalse(box.stop_pid(proc.pid))

    def test_lock_holders_reads_lsof_and_falls_back_to_fuser(self) -> None:
        db = self.tmp / "data" / "arlesh.db"
        db.parent.mkdir(parents=True)
        db.with_name("arlesh.db.lock").write_text("")
        both = fake_bin(self.tmp, "lsof", "echo 2843941")
        with mock.patch.dict(os.environ, {"PATH": f"{both}:/usr/bin:/bin"}):
            self.assertEqual(box.lock_holders(db), [2843941])
        fuser_only = self.tmp / "only"
        fuser_only.mkdir()
        bindir = fake_bin(fuser_only, "fuser", "echo '  77 78'")
        with (
            mock.patch.object(
                box.shutil, "which", lambda n: f"{bindir}/{n}" if n == "fuser" else None
            ),
            mock.patch.object(box, "capture") as cap,
        ):
            cap.return_value = subprocess.CompletedProcess([], 0, "  77 78\n", "")
            self.assertEqual(box.lock_holders(db), [77, 78])

    def test_no_lock_file_means_no_holder(self) -> None:
        self.assertEqual(box.lock_holders(self.tmp / "none.db"), [])

    def test_stop_server_takes_the_recorded_group_then_the_real_holder(self) -> None:
        sdir = box.server_dir("b")
        sdir.mkdir(parents=True)
        (sdir / "server.pid").write_text("100")
        stopped: list[int] = []
        holders = [[200], []]  # held before the second look, free after

        def fake_stop(pid: int, grace: float = 10.0) -> bool:
            stopped.append(pid)
            return True

        with (
            mock.patch.object(box, "stop_pid", fake_stop),
            mock.patch.object(box, "read_pid", return_value=100),
            mock.patch.object(
                box,
                "lock_holders",
                side_effect=lambda _db: holders.pop(0) if holders else [],
            ),
            mock.patch.object(box, "port_open", return_value=False),
        ):
            box.stop_server("b")
        self.assertEqual(stopped, [100, 200])
        self.assertFalse((sdir / "server.pid").exists())


class StartServer(IsolatedEnv):
    def setUp(self) -> None:
        super().setUp()
        self.sdir = box.server_dir("b")
        self.sdir.mkdir(parents=True)
        (self.sdir / "port").write_text("14700")
        (self.sdir / "server.pid").write_text("2843938")
        (self.sdir / "host").write_text("0.0.0.0")

    def start(self, *, up: bool, log: str = "") -> None:
        def spawn(cmd, pidfile, logfile, cwd, env=None):  # type: ignore[no-untyped-def]
            self.assertIsNone(pidfile)
            logfile.write_text(log)
            return 555

        with (
            mock.patch.object(box, "server_running", return_value=False),
            mock.patch.object(box, "build_server"),
            mock.patch.object(box, "seed_server"),
            mock.patch.object(box, "py_dir", return_value=self.tmp),
            mock.patch.object(box, "spawn_detached", spawn),
            mock.patch.object(box, "http_up", return_value=up),
            mock.patch.object(box, "wait_gone", return_value=True),
            mock.patch.object(box, "stop_pid") as stop,
            mock.patch.object(box, "lock_holders", return_value=[2843941]),
            mock.patch.object(box.time, "sleep"),
        ):
            self.stopped = stop
            box.server_start("b", "127.0.0.1")

    def test_the_pid_is_written_only_after_the_server_answers(self) -> None:
        self.start(up=True)
        self.assertEqual((self.sdir / "server.pid").read_text(), "555")
        self.assertEqual((self.sdir / "host").read_text(), "127.0.0.1")

    def test_a_failed_start_keeps_the_previous_pid_and_names_the_lock_holder(
        self,
    ) -> None:
        log = "NotPermitted: arlesh.db is held by another writer"
        with self.assertRaises(box.BoxError) as caught:
            self.start(up=False, log=log)
        self.assertEqual((self.sdir / "server.pid").read_text(), "2843938")
        self.assertEqual((self.sdir / "host").read_text(), "0.0.0.0")
        self.stopped.assert_called_once()
        message = str(caught.exception)
        self.assertIn("pid 2843941", message)
        self.assertIn("server stop b", message)
        self.assertIn("kill 2843941", message)

    def test_another_failure_does_not_blame_the_database(self) -> None:
        with self.assertRaises(box.BoxError) as caught:
            self.start(up=False, log="Traceback: boom")
        self.assertNotIn("held by", str(caught.exception))


class SyncWorktree(OriginFixture):
    def setUp(self) -> None:
        super().setUp()
        self.wt = box.ensure_worktree("feature")
        self.head = box.git_in(self.wt, "rev-parse", "HEAD").stdout

    def refetch(self) -> None:
        box.git_in(self.main, "fetch", "--quiet", "origin", "feature")

    def test_up_to_date_is_silent_and_untouched(self) -> None:
        box.sync_worktree(self.wt, "feature")
        self.assertEqual(box.git_in(self.wt, "rev-parse", "HEAD").stdout, self.head)

    def test_behind_and_clean_fast_forwards_and_says_so(self) -> None:
        self.push_to_origin("feature")
        self.refetch()
        with mock.patch("builtins.print") as out:
            box.sync_worktree(self.wt, "feature")
        self.assertIn("fast-forwarded feature by 1 commits", out.call_args.args[0])
        want = box.git_in(self.main, "rev-parse", "origin/feature").stdout
        self.assertEqual(box.git_in(self.wt, "rev-parse", "HEAD").stdout, want)

    def test_behind_and_dirty_is_refused_unless_stale_ok(self) -> None:
        self.push_to_origin("feature")
        self.refetch()
        (self.wt / "a.txt").write_text("edited\n")
        with self.assertRaises(box.BoxError) as ctx:
            box.sync_worktree(self.wt, "feature")
        self.assertIn("uncommitted changes", str(ctx.exception))
        self.assertIn("--stale-ok", str(ctx.exception))
        with mock.patch.object(box, "note") as note:
            box.sync_worktree(self.wt, "feature", stale_ok=True)
        self.assertIn("--stale-ok", note.call_args.args[0])
        self.assertEqual(box.git_in(self.wt, "rev-parse", "HEAD").stdout, self.head)

    def test_diverged_is_refused(self) -> None:
        git(self.wt, "commit", "-q", "--allow-empty", "-m", "local")
        self.push_to_origin("feature")
        self.refetch()
        with self.assertRaises(box.BoxError) as ctx:
            box.sync_worktree(self.wt, "feature")
        self.assertIn("diverged from origin (1 ahead, 1 behind)", str(ctx.exception))

    def test_ahead_builds_locally_without_a_word(self) -> None:
        git(self.wt, "commit", "-q", "--allow-empty", "-m", "local")
        with (
            mock.patch.object(box, "note") as note,
            mock.patch("builtins.print") as out,
        ):
            box.sync_worktree(self.wt, "feature")
        note.assert_not_called()
        out.assert_not_called()

    def test_run_syncs_before_building(self) -> None:
        self.push_to_origin("feature")
        args = box.parse_args(["run", "feature", "desktop", "--stale-ok"])
        self.assertTrue(args.stale_ok)
        with (
            mock.patch.object(box, "run_desktop"),
            mock.patch.object(box, "record_last_target"),
        ):
            box.cmd_run(box.parse_args(["run", "feature", "desktop"]))
        want = box.git_in(self.main, "rev-parse", "origin/feature").stdout
        self.assertEqual(box.git_in(self.wt, "rev-parse", "HEAD").stdout, want)


class FolderNames(OriginFixture):
    def test_the_folder_name_maps_to_its_branch(self) -> None:
        box.ensure_worktree("qa/2026-11-round")
        self.assertEqual(box.canonical_branch("qa-2026-11-round"), "qa/2026-11-round")
        self.assertEqual(box.canonical_branch("qa/2026-11-round"), "qa/2026-11-round")
        path = box.ensure_worktree("qa-2026-11-round")
        self.assertEqual(box.worktree_branch(path), "qa/2026-11-round")

    def test_an_unknown_folder_name_is_left_alone(self) -> None:
        self.assertEqual(box.canonical_branch("feature"), "feature")
        self.assertEqual(box.canonical_branch("qa-2026-11-round"), "qa-2026-11-round")

    def test_run_accepts_the_folder_name(self) -> None:
        box.ensure_worktree("qa/2026-11-round")
        with (
            mock.patch.object(box, "run_desktop") as run,
            mock.patch.object(box, "record_last_target"),
        ):
            box.cmd_run(box.parse_args(["run", "qa-2026-11-round", "desktop"]))
        self.assertEqual(run.call_args.args[0], "qa-2026-11-round")


DEVICES_L = (
    "192.168.68.111:46175   device product:tokay model:Pixel_9 device:tokay transport_id:1\n"
    "adb-5C190DLCH0015M-tFcyKY._adb-tls-connect._tcp device product:tokay model:Pixel_9 "
    "device:tokay transport_id:2"
)
AVAHI = (
    "+;wlan0;IPv4;adb-5C190DLCH0015M-tFcyKY;_adb-tls-connect._tcp;local\n"
    "=;wlan0;IPv6;adb-5C190DLCH0015M-tFcyKY;_adb-tls-connect._tcp;local;Android_LALRN9NC.local;"
    'fe80::1;46175;"serial=5C190DLCH0015M"\n'
    "=;wlan0;IPv4;adb-5C190DLCH0015M-tFcyKY;_adb-tls-connect._tcp;local;Android_LALRN9NC.local;"
    '192.168.68.111;46175;"serial=5C190DLCH0015M"'
)
TAILNET_IP, LAN_IP = "100.76.177.38", "192.168.68.111"


class WirelessDevices(IsolatedEnv):
    """Fake adb and avahi-browse reproducing a real Linux machine: adb 1.0.41 with an empty
    `adb mdns services`, avahi seeing the phone, a mDNS auto-connect transport beside ip:port."""

    def setUp(self) -> None:
        super().setUp()
        bindir = fake_bin(
            self.tmp,
            "adb",
            'echo "$*" >> "$FAKE_LOG"\n'
            'case "$*" in\n'
            '  "devices -l") echo "List of devices attached"; printf "%s\\n" "$FAKE_DEVICES" ;;\n'
            '  "mdns services") echo "List of discovered mdns services"; printf "%s\\n" "$FAKE_MDNS" ;;\n'
            '  "connect "*) echo "connected to $2" ;;\n'
            '  "-s "*" get-state") case " $FAKE_UP " in *" $2 "*) echo device ;; '
            "*) echo 'error: device not found' >&2; exit 1 ;; esac ;;\n"
            '  "-s "*" shell getprop ro.serialno") echo 5C190DLCH0015M ;;\n'
            '  "-s "*" get-serialno") echo "$2" ;;\n'
            "esac",
        )
        fake_bin(self.tmp, "avahi-browse", 'printf "%s\\n" "$FAKE_AVAHI"')
        self.log = self.tmp / "adb.log"
        self.log.write_text("")
        os.environ.update(
            PATH=f"{bindir}{os.pathsep}{os.environ['PATH']}",
            FAKE_LOG=str(self.log),
            FAKE_DEVICES="",
            FAKE_MDNS="",
            FAKE_AVAHI=AVAHI,
            FAKE_UP="",
        )

    def resolve(
        self, host: str | None, ip: str | None, serial: str | None = None, **more: str
    ) -> str:
        box.device_add("miniseer", "android", host, serial)
        if more:
            box.save_devices(
                {"miniseer": replace(box.load_devices()["miniseer"], **more)}
            )
        info = [(2, 1, 6, "", (ip, 0))] if ip else []
        with mock.patch.object(box.socket, "getaddrinfo", return_value=info):
            return box.resolve_device(box.load_devices()["miniseer"])

    def adb_calls(self) -> list[str]:
        return self.log.read_text().splitlines()

    def test_the_avahi_listing_parses_to_one_ipv4_entry_with_its_serial(self) -> None:
        self.assertEqual(
            box.discover(),
            [
                box.MdnsEntry(
                    "adb-5C190DLCH0015M-tFcyKY", LAN_IP, "46175", "5C190DLCH0015M"
                )
            ],
        )

    def test_an_adb_listing_wins_over_avahi(self) -> None:
        os.environ["FAKE_MDNS"] = MDNS_LINE
        self.assertEqual([e.port for e in box.discover()], ["33691"])

    def test_a_known_serial_uses_the_connected_mdns_transport_without_connecting(
        self,
    ) -> None:
        os.environ["FAKE_DEVICES"] = DEVICES_L
        got = self.resolve("miniseer", TAILNET_IP, serial="5C190DLCH0015M")
        self.assertEqual(got, "adb-5C190DLCH0015M-tFcyKY._adb-tls-connect._tcp")
        self.assertFalse([c for c in self.adb_calls() if c.startswith("connect")])

    def test_miniseer_local_matches_the_connected_ip_transport_by_address(self) -> None:
        os.environ["FAKE_DEVICES"] = DEVICES_L.splitlines()[0]
        self.assertEqual(self.resolve("miniseer.local", LAN_IP), f"{LAN_IP}:46175")
        self.assertEqual(box.load_devices()["miniseer"].adb_serial, "5C190DLCH0015M")

    def test_a_connected_transport_is_found_by_asking_it_for_the_serial(self) -> None:
        os.environ["FAKE_DEVICES"] = f"{LAN_IP}:46175 device product:tokay"
        self.assertEqual(
            self.resolve("miniseer", TAILNET_IP, serial="5C190DLCH0015M"),
            f"{LAN_IP}:46175",
        )

    def test_a_tailnet_name_with_a_known_serial_connects_on_the_tailnet_ip_and_found_port(
        self,
    ) -> None:
        os.environ["FAKE_UP"] = f"{TAILNET_IP}:46175"
        got = self.resolve("miniseer", TAILNET_IP, serial="5C190DLCH0015M")
        self.assertEqual(got, f"{TAILNET_IP}:46175")
        self.assertEqual(box.load_devices()["miniseer"].last_port, "46175")

    def test_first_run_with_a_tailnet_name_and_no_serial_proves_it_by_connecting(
        self,
    ) -> None:
        os.environ["FAKE_UP"] = f"{TAILNET_IP}:46175"
        got = self.resolve("miniseer", TAILNET_IP)
        self.assertEqual(got, f"{TAILNET_IP}:46175")
        stored = box.load_devices()["miniseer"]
        self.assertEqual(
            (stored.adb_serial, stored.last_port), ("5C190DLCH0015M", "46175")
        )

    def test_the_serial_is_read_from_the_device_never_from_the_transport_name(
        self,
    ) -> None:
        os.environ["FAKE_UP"] = "10.0.0.5:5555"
        self.assertEqual(self.resolve("10.0.0.5:5555", "10.0.0.5"), "10.0.0.5:5555")
        self.assertEqual(box.load_devices()["miniseer"].adb_serial, "5C190DLCH0015M")
        self.assertNotIn("get-serialno", self.log.read_text())

    def test_nothing_discovered_falls_back_to_the_last_port_that_worked(self) -> None:
        os.environ.update(FAKE_AVAHI="", FAKE_UP="miniseer:40001")
        self.assertEqual(
            self.resolve("miniseer", TAILNET_IP, last_port="40001"),
            "miniseer:40001",
        )

    def test_a_registered_port_is_tried_before_the_last_one(self) -> None:
        os.environ.update(FAKE_AVAHI="", FAKE_UP="miniseer:5555 miniseer:40001")
        self.assertEqual(
            self.resolve("miniseer:5555", TAILNET_IP, last_port="40001"),
            "miniseer:5555",
        )

    def test_when_everything_fails_the_error_offers_tcpip_5555(self) -> None:
        os.environ["FAKE_AVAHI"] = ""
        with self.assertRaises(box.BoxError) as ctx:
            self.resolve("miniseer", TAILNET_IP)
        self.assertIn("adb tcpip 5555", str(ctx.exception))
        self.assertIn("miniseer:5555", str(ctx.exception))

    def test_serial_alone_registers_and_matches(self) -> None:
        a = box.parse_args(
            ["devices", "add", "p", "--os", "android", "--serial", "5C190DLCH0015M"]
        )
        self.assertEqual((a.host, a.serial), (None, "5C190DLCH0015M"))
        box.cmd_devices(a)
        self.assertEqual(box.load_devices()["p"].adb_serial, "5C190DLCH0015M")
        os.environ["FAKE_DEVICES"] = DEVICES_L
        with mock.patch.object(box.socket, "getaddrinfo", return_value=[]):
            self.assertEqual(
                box.resolve_device(box.load_devices()["p"]),
                "adb-5C190DLCH0015M-tFcyKY._adb-tls-connect._tcp",
            )

    def test_addresses_and_transport_names_are_not_serials(self) -> None:
        for bad in (
            "192.168.68.111:46175",
            "10.0.0.5",
            "adb-5C190DLCH0015M-tFcyKY._adb-tls-connect._tcp",
            "adb-5C190DLCH0015M-tFcyKY",
            "unknown",
            "",
        ):
            self.assertFalse(box.plausible_serial(bad), bad)
        self.assertTrue(box.plausible_serial("5C190DLCH0015M"))
        with self.assertRaises(box.UsageError):
            box.device_add("x", "android", "h", serial="10.0.0.5:5555")


if __name__ == "__main__":
    unittest.main()
