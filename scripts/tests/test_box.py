"""Tests for scripts/box.py (stdlib unittest): `python -m unittest scripts/tests/test_box.py`."""

from __future__ import annotations

import base64
import contextlib
import http.server
import importlib.util
import io
import json
import os
import secrets
import shutil
import sqlite3
import stat
import subprocess
import sys
import tempfile
import threading
import time
import unittest
from dataclasses import replace
from pathlib import Path
from typing import Any, Self
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


MDNS_LINE = "adb-SERIAL0002-xYz1Qw _adb-tls-connect._tcp. 192.0.2.11:33691"


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
            '  "connect "*) printf "%s\\n" "${FAKE_CONNECT:-connected to $2}" ;;\n'
            "  *get-state*) echo device ;;\n"
            "  *get-serialno*) echo SERIAL0002 ;;\n"
            "esac\n"
        )
        adb.chmod(adb.stat().st_mode | stat.S_IXUSR)
        os.environ["PATH"] = f"{bindir}{os.pathsep}{os.environ['PATH']}"
        os.environ["FAKE_MDNS"] = MDNS_LINE

    def resolve(
        self, host: str, adb_serial: str | None = None, ip: str | None = None
    ) -> str:
        box.device_add("phone", "android", host)
        if adb_serial:
            box.save_devices(
                {"phone": box.Target("phone", "android", host, adb_serial)}
            )
        info = [(2, 1, 6, "", (ip, 0))] if ip else []
        with mock.patch.object(box.socket, "getaddrinfo", return_value=info):
            return box.resolve_device(box.load_devices()["phone"])

    def test_registered_name_resolving_to_the_mdns_ip(self) -> None:
        self.assertEqual(self.resolve("phone", ip="192.0.2.11"), "192.0.2.11:33691")

    def test_serial_is_stored_after_first_sight(self) -> None:
        self.resolve("phone", ip="192.0.2.11")
        self.assertEqual(box.load_devices()["phone"].adb_serial, "SERIAL0002")

    def test_serial_matches_when_the_ip_differs(self) -> None:
        self.assertEqual(
            self.resolve("100.64.0.9", adb_serial="SERIAL0002", ip="100.64.0.9"),
            "100.64.0.9:33691",  # adbd listens on every interface: the tailnet address, LAN port
        )

    def test_nothing_matches_lists_the_mdns_entries(self) -> None:
        with self.assertRaises(box.BoxError) as ctx:
            self.resolve("other", ip="10.0.0.5")
        self.assertIn("adb-SERIAL0002-xYz1Qw", str(ctx.exception))
        self.assertIn("192.0.2.11:33691", str(ctx.exception))

    def test_registered_port_is_tried_when_not_advertised(self) -> None:
        os.environ["FAKE_MDNS"] = ""
        self.assertEqual(self.resolve("10.0.0.5:5555", ip="10.0.0.5"), "10.0.0.5:5555")

    def test_a_handshake_failure_says_re_pair_with_the_steps(self) -> None:
        os.environ["FAKE_CONNECT"] = "failed to connect to 192.0.2.11:33691"
        with self.assertRaises(box.BoxError) as ctx:
            self.resolve("phone", ip="192.0.2.11")
        said = str(ctx.exception)
        self.assertIn("rejected this computer's key", said)
        self.assertIn("adb pair 192.0.2.11:<pairing port> <code>", said)
        self.assertIn("Pair device with pairing code", said)
        self.assertNotIn("Could not reach", said)

    def test_a_refused_connection_keeps_the_generic_message(self) -> None:
        os.environ["FAKE_CONNECT"] = "failed to connect to '192.0.2.11:33691': Connection refused"
        with self.assertRaises(box.BoxError) as ctx:
            self.resolve("phone", ip="192.0.2.11")
        self.assertIn("Could not reach", str(ctx.exception))

    def test_a_good_connection_is_unaffected(self) -> None:
        os.environ["FAKE_CONNECT"] = "connected to 192.0.2.11:33691"
        self.assertEqual(self.resolve("phone", ip="192.0.2.11"), "192.0.2.11:33691")

    def test_serial_parsed_from_the_service_name(self) -> None:
        e = box.MdnsEntry("adb-SERIAL0002-xYz1Qw", "1.2.3.4", "1")
        self.assertEqual(e.hardware_serial, "SERIAL0002")


class ConnectOutcome(unittest.TestCase):
    def classify(self, output: str, log_text: str | None = None) -> str:
        with tempfile.TemporaryDirectory() as tmp:
            log = Path(tmp) / "adb.log"
            if log_text is not None:
                log.write_text(log_text)
            return box.classify_connect(output, log)

    def test_connected(self) -> None:
        self.assertEqual(self.classify("connected to 192.168.68.111:37000\n"), box.CONNECTED)
        self.assertEqual(self.classify("already connected to 192.168.68.111:37000\n"), box.CONNECTED)

    def test_a_closed_port_is_refused(self) -> None:
        out = "failed to connect to '192.168.68.111:37000': Connection refused\n"
        self.assertEqual(self.classify(out), box.REFUSED)

    def test_a_failure_with_no_reason_is_a_rejected_key(self) -> None:
        self.assertEqual(self.classify("failed to connect to 192.168.68.111:37000\n"), box.REJECTED)
        self.assertEqual(self.classify("failed to connect to '192.168.68.111:37000'\n"), box.REJECTED)

    def test_a_failure_with_a_socket_reason_is_not_a_rejected_key(self) -> None:
        out = "failed to connect to '192.168.68.111:37000': Connection timed out\n"
        self.assertEqual(self.classify(out, "tls_connection.cpp Handshake failed"), box.UNREACHABLE)

    def test_the_log_is_only_a_fallback_for_an_unexplained_failure(self) -> None:
        text = "unable to connect to 192.168.68.111:37000: something new\n"
        self.assertEqual(self.classify(text, "tls_connection.cpp: Handshake failed in SSL_accept"), box.REJECTED)
        self.assertEqual(self.classify(text, "nothing relevant"), box.UNREACHABLE)
        self.assertEqual(self.classify(text), box.UNREACHABLE)  # no log at all

    def test_only_the_tail_of_a_large_log_counts(self) -> None:
        log_text = "Handshake failed\n" + "x" * 40000
        self.assertEqual(self.classify("failed to connect to h: odd\n", log_text), box.UNREACHABLE)


class OriginFixture(IsolatedEnv):
    """A temp main checkout cloned from a bare "origin" holding master, qa/2026-11-round, feature."""

    def setUp(self) -> None:
        super().setUp()
        # The fixture repo has no package-lock.json to install from.
        self.ensure_node_modules = mock.patch.object(box, "ensure_node_modules").start()
        self.addCleanup(mock.patch.stopall)
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

    def test_creates_from_origin_with_tracking_and_installs_dependencies(self) -> None:
        path = box.ensure_worktree("feature")
        self.assertEqual(box.worktree_branch(path), "feature")
        up = box.git_in(path, "rev-parse", "--abbrev-ref", "feature@{u}").stdout.strip()
        self.assertEqual(up, "origin/feature")
        self.ensure_node_modules.assert_called_once_with(path)

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


class WorktreeByBranch(OriginFixture):
    """A worktree made by hand under a folder name that is not the branch's `dir_name`."""

    def test_a_branch_held_by_a_differently_named_folder_is_reused(self) -> None:
        folder = box.worktrees_dir() / "fix-274"
        git(self.main, "worktree", "add", "-q", "-b", "feature", str(folder), "origin/feature")
        self.assertEqual(box.ensure_worktree("feature").resolve(), folder.resolve())
        self.assertEqual(box.all_names(), ["fix-274"])

    def test_the_instance_name_still_finds_that_worktree(self) -> None:
        folder = box.worktrees_dir() / "fix-274"
        git(self.main, "worktree", "add", "-q", "-b", "feature", str(folder), "origin/feature")
        self.assertEqual(box.worktree_path("feature").resolve(), folder.resolve())

    def test_a_slash_branch_in_a_differently_named_folder_is_reused(self) -> None:
        folder = box.worktrees_dir() / "round"
        git(self.main, "worktree", "add", "-q", "-b", "qa/2026-11-round", str(folder), "origin/qa/2026-11-round")
        self.assertEqual(box.ensure_worktree("qa/2026-11-round").resolve(), folder.resolve())

    def test_a_branch_checked_out_in_the_main_checkout_is_an_error_naming_where(self) -> None:
        with self.assertRaises(box.BoxError) as ctx:
            box.ensure_worktree("master")
        self.assertIn("already checked out at", str(ctx.exception))
        self.assertIn("outside .claude/worktrees", str(ctx.exception))

    def test_an_unknown_name_is_still_no_worktree(self) -> None:
        with self.assertRaises(box.BoxError):
            box.worktree_path("ghost")

    def test_porcelain_parsing_skips_detached_worktrees(self) -> None:
        text = "worktree /r\nHEAD a\nbranch refs/heads/dev\n\nworktree /r/w\nHEAD b\ndetached\n"
        self.assertEqual(box.parse_worktree_list(text), {"dev": Path("/r")})


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
            box.pick_server_address("100.100.1.1", "192.0.2.5"), "100.100.1.1"
        )

    def test_without_a_tailnet_the_lan_address(self) -> None:
        self.assertEqual(box.pick_server_address("", "192.0.2.5"), "192.0.2.5")

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
    URL = "http://192.0.2.5:14701"

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
        self.assertEqual(calls[1][-3:], ["am", "force-stop", "com.atai.arlesh.box.b"])
        self.assertIn("--es arlesh_box_token tok", calls[2][-1])

    def test_unbound_launch_uses_the_launcher_intent(self) -> None:
        calls: list[list[str]] = []

        def fake_capture(cmd, cwd=None):  # type: ignore[no-untyped-def]
            calls.append(list(cmd))
            return FakeProc()

        with mock.patch.object(box, "capture", fake_capture):
            box.launch_android("b", "s:1")
        self.assertEqual(len(calls), 2)
        self.assertIn("monkey", calls[1])

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


HASH = "0123456789abcdef"


def make_member_artifacts(target: Path, profile: str, name: str, hash_: str) -> Path:
    """A fake cargo fingerprint and build-script dir for workspace crate `name`."""
    fingerprint = target / profile / ".fingerprint" / f"{name}-{hash_}"
    fingerprint.mkdir(parents=True)
    (fingerprint / "lib-x").write_text("fingerprint")
    (fingerprint / "invoked.timestamp").write_text("")
    (target / profile / "build" / f"{name}-{hash_}").mkdir(parents=True)
    return fingerprint


CORE = box.Crate("arlesh-core", "crates/arlesh-core")
APP = box.Crate("arlesh", "src-tauri", ("arlesh-core",))


class SharedTargetOwnership(IsolatedEnv):
    """Worktrees share one cargo target; cargo's fingerprints cannot tell their crates apart, so
    each crate's records are kept only when built from this tree's content key."""

    def setUp(self) -> None:
        super().setUp()
        self.target = self.tmp / "target"
        self.target.mkdir()
        self.wt_a, self.wt_b = self.tmp / "a", self.tmp / "b"
        # What each worktree's crates hash to; a test changes these to change a worktree's content.
        self.keys: dict[str, dict[str, str | None]] = {
            "a": {"arlesh-core": "core-1", "arlesh": "app-a"},
            "b": {"arlesh-core": "core-1", "arlesh": "app-b"},
        }
        self.shared = {"a": "shared-1", "b": "shared-1"}
        for patcher in (
            mock.patch.object(box, "workspace_crates", lambda wt: {c.name: c for c in (CORE, APP)}),
            mock.patch.object(box, "content_keys", lambda wt, crates, unkeyed=(): dict(self.keys[wt.name])),
            mock.patch.object(box, "shared_inputs_key", lambda wt: self.shared[wt.name]),
            mock.patch.object(box, "note"),
        ):
            patcher.start()
            self.addCleanup(patcher.stop)
        self.dependency = make_member_artifacts(self.target, "debug", "serde", HASH)

    def fingerprint(self, name: str) -> Path:
        return self.target / "debug" / ".fingerprint" / f"{name}-{HASH}"

    @property
    def core(self) -> Path:
        return self.fingerprint("arlesh-core")

    def build(self, wt: Path) -> dict[str, str]:
        """A cargo run: compiles a crate only where no fingerprint says it is fresh."""
        with box.owned_target(wt, self.target):
            for name in ("arlesh-core", "arlesh"):
                if not self.fingerprint(name).exists():
                    make_member_artifacts(self.target, "debug", name, HASH)
                    (self.fingerprint(name) / "lib-x").write_text(f"compiled in {wt.name}")
            return {n: (self.fingerprint(n) / "lib-x").read_text() for n in ("arlesh-core", "arlesh")}

    def test_the_first_use_of_a_target_compiles_the_members(self) -> None:
        make_member_artifacts(self.target, "debug", "arlesh-core", HASH)
        (self.core / "lib-x").write_text("unknown origin")
        self.assertEqual(self.build(self.wt_a)["arlesh-core"], "compiled in a")

    def test_the_dependencies_are_never_touched(self) -> None:
        self.build(self.wt_a)
        self.build(self.wt_b)
        self.assertTrue(self.dependency.exists())

    def test_the_same_worktree_building_again_keeps_every_crate(self) -> None:
        self.build(self.wt_a)
        self.assertEqual(self.build(self.wt_a), {"arlesh-core": "compiled in a", "arlesh": "compiled in a"})

    def test_another_worktree_with_the_same_content_keeps_the_crate_and_rebuilds_the_one_that_differs(self) -> None:
        self.build(self.wt_a)
        self.assertEqual(self.build(self.wt_b), {"arlesh-core": "compiled in a", "arlesh": "compiled in b"})

    def test_alternating_worktrees_rebuild_only_what_differs_each_time(self) -> None:
        got = [self.build(wt)["arlesh"] for wt in (self.wt_a, self.wt_b, self.wt_a, self.wt_b)]
        self.assertEqual(got, ["compiled in a", "compiled in b", "compiled in a", "compiled in b"])
        self.assertEqual((self.core / "lib-x").read_text(), "compiled in a")

    def test_a_crate_whose_content_differs_is_rebuilt(self) -> None:
        self.build(self.wt_a)
        self.keys["b"]["arlesh-core"] = "core-2"
        self.assertEqual(self.build(self.wt_b)["arlesh-core"], "compiled in b")

    def test_a_different_shared_input_drops_every_crate(self) -> None:
        self.build(self.wt_a)
        self.shared["b"] = "shared-2"
        self.assertEqual(self.build(self.wt_b), {"arlesh-core": "compiled in b", "arlesh": "compiled in b"})

    def test_a_crate_that_cannot_be_keyed_is_rebuilt_every_time(self) -> None:
        self.keys["a"]["arlesh"] = None
        self.build(self.wt_a)
        (self.fingerprint("arlesh") / "lib-x").write_text("stale")
        self.assertEqual(self.build(self.wt_a), {"arlesh-core": "compiled in a", "arlesh": "compiled in a"})
        self.assertNotIn("arlesh", box.read_owner(self.target)["crates"])

    def test_a_crate_cargo_did_not_build_keeps_its_old_key(self) -> None:
        self.build(self.wt_a)
        with box.owned_target(self.wt_b, self.target):  # builds nothing
            pass
        self.assertEqual(box.read_owner(self.target)["crates"]["arlesh-core"]["key"], "core-1")
        self.assertNotIn("arlesh", box.read_owner(self.target)["crates"])  # dropped, not rebuilt

    def test_records_written_under_another_key_are_not_adopted(self) -> None:
        self.build(self.wt_a)
        self.keys["b"]["arlesh-core"] = "core-2"
        self.build(self.wt_b)
        self.assertEqual(self.build(self.wt_a)["arlesh-core"], "compiled in a")

    def test_a_build_outside_box_invalidates_that_crate(self) -> None:
        self.build(self.wt_a)
        (self.core / "lib-x").write_text("a cargo run in some other worktree")
        self.assertEqual(self.build(self.wt_a)["arlesh-core"], "compiled in a")

    def test_a_fresh_check_by_cargo_does_not_invalidate(self) -> None:
        self.build(self.wt_a)
        (self.core / "invoked.timestamp").write_text("touched")
        self.assertEqual(self.build(self.wt_a)["arlesh-core"], "compiled in a")
        self.assertEqual(box.read_owner(self.target)["crates"]["arlesh-core"]["key"], "core-1")

    def test_a_record_in_the_old_format_drops_everything(self) -> None:
        self.build(self.wt_a)
        (self.target / box.OWNER_FILE).write_text(json.dumps({"worktree": str(self.wt_a), "signature": "x"}))
        self.assertEqual(self.build(self.wt_a), {"arlesh-core": "compiled in a", "arlesh": "compiled in a"})

    def test_a_crate_whose_name_starts_with_a_members_is_left_alone(self) -> None:
        other = make_member_artifacts(self.target, "debug", "arlesh-core-extra", HASH)
        self.build(self.wt_a)
        self.assertTrue(other.exists())

    def test_every_profile_and_target_triple_is_covered(self) -> None:
        android = make_member_artifacts(self.target, "aarch64-linux-android/release", "arlesh", HASH)
        self.build(self.wt_a)
        self.assertFalse(android.exists())

    def test_the_build_scripts_outputs_go_too(self) -> None:
        script = self.target / "debug" / "build" / f"arlesh-core-{HASH}"
        script.mkdir(parents=True)
        with box.owned_target(self.wt_a, self.target):
            self.assertFalse(script.exists())

    def test_a_failed_build_still_records_what_cargo_wrote(self) -> None:
        with self.assertRaises(RuntimeError), box.owned_target(self.wt_a, self.target):
            make_member_artifacts(self.target, "debug", "arlesh-core", HASH)
            (self.core / "lib-x").write_text("partial, from a")
            raise RuntimeError("compile error")
        self.assertEqual(self.build(self.wt_a)["arlesh-core"], "partial, from a")
        self.keys["b"]["arlesh-core"] = "core-2"
        self.assertEqual(self.build(self.wt_b)["arlesh-core"], "compiled in b")


class ContentKeys(unittest.TestCase):
    """The content key of a crate, on a real git repository."""

    def setUp(self) -> None:
        self._tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self._tmp.cleanup)
        self.wt = Path(self._tmp.name).resolve()
        git(self.wt, "init", "-q")
        self.write("crates/lib/src/lib.rs", "pub fn f() {}\n")
        self.write("crates/app/src/main.rs", "fn main() {}\n")
        self.write("shared/data.txt", "one\n")
        self.write("Cargo.toml", "[workspace]\n")
        self.write("Cargo.lock", "lock 1\n")
        self.commit()
        self.crates = {
            "lib": box.Crate("lib", "crates/lib"),
            "app": box.Crate("app", "crates/app", ("lib",)),
        }

    def write(self, rel: str, text: str) -> None:
        path = self.wt / rel
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(text)

    def commit(self) -> None:
        git(self.wt, "add", "-A")
        git(self.wt, "commit", "-qm", "c")

    def keys(self, unkeyed: tuple[str, ...] = ()) -> dict[str, str | None]:
        return box.content_keys(self.wt, self.crates, unkeyed)

    def changes(self, edit: Any) -> set[str]:
        before = self.keys()
        edit()
        after = self.keys()
        return {n for n in before if before[n] != after[n]}

    def test_the_same_tree_has_the_same_keys(self) -> None:
        self.assertEqual(self.keys(), self.keys())

    def test_two_worktrees_with_the_same_content_have_the_same_key(self) -> None:
        other = self.wt.parent / (self.wt.name + "-b")
        git(self.wt, "worktree", "add", "-q", str(other), "-b", "other")
        self.addCleanup(shutil.rmtree, other, True)
        self.assertEqual(box.content_keys(other, self.crates), self.keys())

    def test_an_uncommitted_edit_changes_that_crate_and_its_dependents_only(self) -> None:
        self.assertEqual(self.changes(lambda: self.write("crates/lib/src/lib.rs", "pub fn g() {}\n")), {"lib", "app"})
        self.assertEqual(self.changes(lambda: self.write("crates/app/src/main.rs", "fn main() { }\n")), {"app"})

    def test_a_new_untracked_file_changes_the_key(self) -> None:
        self.assertEqual(self.changes(lambda: self.write("crates/app/src/new.rs", "x\n")), {"app"})

    def test_a_commit_of_an_edit_already_hashed_is_a_change_only_for_its_crate(self) -> None:
        self.write("README.md", "docs\n")
        self.assertEqual(self.changes(self.commit), set())

    def test_a_change_outside_every_crate_changes_no_crate_key(self) -> None:
        self.assertEqual(self.changes(lambda: self.write("docs/spec.md", "x\n")), set())

    def test_include_str_from_outside_the_crate_is_part_of_the_key(self) -> None:
        self.write("crates/lib/src/lib.rs", 'const D: &str = include_str!("../../../shared/data.txt");\n')
        self.commit()
        self.assertEqual(self.changes(lambda: self.write("shared/data.txt", "two\n")), {"lib", "app"})

    def test_include_bytes_through_the_manifest_dir_is_part_of_the_key(self) -> None:
        self.write(
            "crates/app/src/main.rs",
            'const D: &[u8] = include_bytes!(concat!(env!("CARGO_MANIFEST_DIR"), "/../../shared/data.txt"));\n',
        )
        self.commit()
        self.assertEqual(self.changes(lambda: self.write("shared/data.txt", "two\n")), {"app"})

    def test_a_macro_inside_test_code_is_not_part_of_the_key(self) -> None:
        self.write("crates/app/src/tests.rs", 'const D: &str = include_str!("../../../shared/data.txt");\n')
        self.commit()
        self.assertEqual(self.changes(lambda: self.write("shared/data.txt", "two\n")), set())

    def test_a_macro_path_inside_the_crate_adds_nothing(self) -> None:
        self.write("crates/lib/src/lib.rs", 'const D: &str = include_str!("data.txt");\n')
        self.write("crates/lib/src/data.txt", "in\n")
        self.commit()
        self.assertIsNotNone(self.keys()["lib"])

    def test_a_symlink_out_of_the_crate_hashes_its_target(self) -> None:
        (self.wt / "crates/app/migrations").symlink_to("../../shared")
        self.commit()
        self.assertEqual(self.changes(lambda: self.write("shared/data.txt", "two\n")), {"app"})

    def test_sqlx_migrate_through_a_symlink_is_part_of_the_key(self) -> None:
        self.write("crates/app/src/main.rs", 'static M: Migrator = sqlx::migrate!("./migrations");\n')
        (self.wt / "crates/app/migrations").symlink_to("../../shared")
        self.commit()
        self.assertEqual(self.changes(lambda: self.write("shared/new.sql", "select 1;\n")), {"app"})

    def test_a_path_that_is_not_a_literal_makes_the_crate_unkeyable(self) -> None:
        self.write("crates/lib/src/lib.rs", 'include!(concat!(env!("OUT_DIR"), "/gen.rs"));\n')
        self.commit()
        keys = self.keys()
        self.assertIsNone(keys["lib"])
        self.assertIsNone(keys["app"])  # a crate above an unkeyable one cannot be keyed either

    def test_an_unclosed_macro_makes_the_crate_unkeyable(self) -> None:
        self.write("crates/lib/src/lib.rs", 'include_str!("a.txt"\n')
        self.commit()
        self.assertIsNone(self.keys()["lib"])

    def test_a_tauri_crates_frontend_dist_is_part_of_the_key(self) -> None:
        self.write("crates/app/tauri.conf.json", json.dumps({"build": {"frontendDist": "../../dist"}}))
        self.commit()
        self.assertEqual(self.changes(lambda: self.write("dist/index.html", "<p>x")), {"app"})

    def test_an_unkeyed_directory_is_never_keyed(self) -> None:
        self.assertEqual(self.keys(("crates/app",))["app"], None)
        self.assertIsNotNone(self.keys(("crates/app",))["lib"])

    def test_every_shared_input_changes_the_shared_key(self) -> None:
        before = box.shared_inputs_key(self.wt)
        self.assertEqual(box.shared_inputs_key(self.wt), before)
        for rel in ("Cargo.lock", "Cargo.toml", "rust-toolchain.toml", ".cargo/config.toml"):
            self.write(rel, "changed\n")
            after = box.shared_inputs_key(self.wt)
            self.assertNotEqual(after, before, rel)
            before = after

    def test_the_workspace_crates_come_from_cargo_metadata(self) -> None:
        meta = {"packages": [
            {"name": "lib", "manifest_path": str(self.wt / "crates/lib/Cargo.toml"), "dependencies": []},
            {"name": "app", "manifest_path": str(self.wt / "crates/app/Cargo.toml"), "dependencies": [
                {"name": "lib", "path": "/x"}, {"name": "serde"}, {"name": "lib2", "path": "/y", "kind": "dev"}]},
        ]}  # fmt: skip
        with mock.patch.object(box, "capture", return_value=FakeProc(json.dumps(meta))):
            self.assertEqual(box.workspace_crates(self.wt), self.crates)


class NotificationGrant(unittest.TestCase):
    def run_grant(self, out: str, code: int = 0, package: str = "com.atai.arlesh.box.b") -> list[list[str]]:
        calls: list[list[str]] = []

        def fake_capture(cmd, cwd=None):  # type: ignore[no-untyped-def]
            calls.append(list(cmd))
            return FakeProc(out, code)

        with mock.patch.object(box, "capture", fake_capture):
            box.grant_notifications("s:1", package)
        return calls

    def test_grants_post_notifications_to_the_box_package(self) -> None:
        calls = self.run_grant("")
        self.assertEqual(
            calls,
            [["adb", "-s", "s:1", "shell", "pm", "grant", "com.atai.arlesh.box.b",
              "android.permission.POST_NOTIFICATIONS"]],
        )

    def test_never_touches_the_release_app(self) -> None:
        with self.assertRaises(box.BoxError):
            self.run_grant("", package="com.atai.arlesh")

    def test_an_unknown_permission_is_a_note_not_a_failure(self) -> None:
        err = io.StringIO()
        with contextlib.redirect_stderr(err):
            self.run_grant("Exception occurred while executing 'grant':\nUnknown permission: android.permission.POST_NOTIFICATIONS\n")
        self.assertIn("POST_NOTIFICATIONS", err.getvalue())

    def test_a_nonzero_exit_is_a_note_not_a_failure(self) -> None:
        with contextlib.redirect_stderr(io.StringIO()):
            self.run_grant("", code=255)

    def test_launch_grants_before_it_starts_the_app(self) -> None:
        calls: list[list[str]] = []

        def fake_capture(cmd, cwd=None):  # type: ignore[no-untyped-def]
            calls.append(list(cmd))
            return FakeProc()

        with mock.patch.object(box, "capture", fake_capture):
            box.launch_android("b", "s:1")
        self.assertIn("grant", calls[0])
        self.assertIn("monkey", calls[1])


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
    body = sys.stdin.read()
    open(d + "/secret." + args[2] + ".txt", "w").write(body)
    open(d + "/secret.txt", "w").write(body)
    open(d + "/secret.args", "a").write(" ".join(args) + "\\n")
    sys.exit(0 if state.get("secret_ok", True) else 1)
"""

FAKE_KEYTOOL = """#!__PY__
import json, os, sys
args = sys.argv[1:]
# Record the argv, and what each `-opt:env NAME` argument points at, as keytool would read it.
envs = {}
for i, a in enumerate(args):
    if a.endswith(":env"):
        envs[args[i + 1]] = os.environ.get(args[i + 1], "")
with open(os.environ["FAKE_GH_DIR"] + "/keytool.log", "a") as log:
    log.write(json.dumps({"argv": args, "envs": envs}) + "\\n")
if args[0] == "-list":
    print("Keystore type: " + os.environ.get("FAKE_KEYTOOL_TYPE", "PKCS12"))
    sys.exit(0)
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

    def keytool_calls(self) -> list[dict[str, Any]]:
        log = self.gh_dir / "keytool.log"
        return (
            [json.loads(line) for line in log.read_text().splitlines()]
            if log.exists()
            else []
        )

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
    def secret(self, name: str) -> str:
        return (self.gh_dir / f"secret.{name}.txt").read_text()

    def init(self, force: bool = False) -> None:
        with mock.patch.object(box, "repo_root", lambda: self.wt):
            box.keystore_init(force=force)

    def test_writes_the_keystore_and_env_line_and_sets_both_secrets(self) -> None:
        self.init()
        ks = box.box_keystore()
        self.assertTrue(ks.is_file())
        self.assertIn("-alias arlesh-box", ks.read_text())
        self.assertEqual(oct(ks.stat().st_mode & 0o777), "0o600")
        env = box.env_file()
        self.assertEqual(oct(env.stat().st_mode & 0o777), "0o600")
        pw = box.parse_env_file(env.read_text())[box.BOX_PASSWORD_ENV]
        self.assertGreaterEqual(len(pw), 32)
        self.assertEqual(
            (self.gh_dir / "secret.args").read_text().splitlines(),
            [
                "secret set ARLESH_BOX_KEYSTORE_B64 --repo jan-oko/Arlesh",
                "secret set ARLESH_BOX_KEYSTORE_PASSWORD --repo jan-oko/Arlesh",
            ],
        )
        self.assertEqual(
            base64.b64decode(self.secret("ARLESH_BOX_KEYSTORE_B64")), ks.read_bytes()
        )
        self.assertEqual(self.secret("ARLESH_BOX_KEYSTORE_PASSWORD"), pw)
        self.assertEqual(list(ks.parent.glob("box.keystore.password")), [])
        self.assertFalse(list(ks.parent.glob("*.new")))

    def test_the_value_is_in_no_argv_and_never_printed(self) -> None:
        out = io.StringIO()
        with contextlib.redirect_stdout(out), contextlib.redirect_stderr(out):
            self.init()
        pw = box.parse_env_file(box.env_file().read_text())[box.BOX_PASSWORD_ENV]
        (call,) = self.keytool_calls()
        self.assertNotIn(pw, " ".join(call["argv"]))
        self.assertIn("-storepass:env", call["argv"])
        self.assertIn("-keypass:env", call["argv"])
        self.assertEqual(call["envs"], {box.BOX_PASSWORD_ENV: pw})
        self.assertNotIn(pw, out.getvalue())
        for line in self.gh_calls():
            self.assertNotIn(pw, line)

    def test_updates_an_existing_line_in_place_and_keeps_the_rest(self) -> None:
        env = box.env_file()
        env.parent.mkdir(parents=True)
        before = f"{box.BOX_PASSWORD_ENV}={secrets.token_urlsafe(18)}"
        env.write_text(f"FIRST=1\n{before}\nLAST=2\n")
        env.chmod(0o644)
        self.init()
        lines = env.read_text().splitlines()
        self.assertEqual((lines[0], lines[2]), ("FIRST=1", "LAST=2"))
        self.assertEqual(len(lines), 3)
        self.assertTrue(lines[1].startswith(box.BOX_PASSWORD_ENV + "="))
        self.assertNotEqual(lines[1], before)
        self.assertEqual(oct(env.stat().st_mode & 0o777), "0o600")

    def test_appends_when_the_variable_is_absent(self) -> None:
        env = box.env_file()
        env.parent.mkdir(parents=True)
        env.write_text("FIRST=1")
        self.init()
        lines = env.read_text().splitlines()
        self.assertEqual(lines[0], "FIRST=1")
        self.assertTrue(lines[1].startswith(box.BOX_PASSWORD_ENV + "="))

    def test_refuses_to_overwrite_without_force(self) -> None:
        ks = box.box_keystore()
        ks.parent.mkdir(parents=True)
        ks.write_text("old")
        with self.assertRaises(box.BoxError) as ctx:
            self.init()
        self.assertIn("--force", str(ctx.exception))
        self.assertEqual(ks.read_text(), "old")
        self.assertFalse((self.gh_dir / "secret.txt").exists())
        self.init(force=True)
        self.assertNotEqual(ks.read_text(), "old")

    def test_a_failed_upload_keeps_the_old_keystore_and_env(self) -> None:
        ks = box.box_keystore()
        ks.parent.mkdir(parents=True)
        ks.write_text("old")
        self.gh_state(secret_ok=False)
        with self.assertRaises(box.BoxError):
            self.init(force=True)
        self.assertEqual(ks.read_text(), "old")
        self.assertFalse(box.env_file().exists())
        self.assertFalse(list(ks.parent.glob("*.new")))

    def test_replacing_removes_the_old_password_file(self) -> None:
        ks = box.box_keystore()
        ks.parent.mkdir(parents=True)
        ks.write_text("old")
        box.legacy_password_file().write_text("x")
        self.init(force=True)
        self.assertFalse(box.legacy_password_file().exists())

    def test_origin_repo_forms(self) -> None:
        for url in (
            "git@github.com:jan-oko/Arlesh.git",
            "https://github.com/jan-oko/Arlesh",
            "https://github.com/jan-oko/Arlesh.git",
        ):
            self.git("remote", "set-url", "origin", url)
            self.assertEqual(box.origin_repo(self.wt), "jan-oko/Arlesh")


class KeystoreRotate(CiFixture):
    def make_keystore(self) -> tuple[Path, str]:
        ks = box.box_keystore()
        ks.parent.mkdir(parents=True)
        ks.write_text("existing")
        old = secrets.token_urlsafe(18)
        os.environ[box.BOX_PASSWORD_ENV] = old
        return ks, old

    def rotate(self) -> None:
        with mock.patch.object(box, "repo_root", lambda: self.wt):
            box.keystore_rotate_password()

    def check_env_only(self, calls: list[dict[str, Any]], old: str, pw: str) -> None:
        for call in calls:
            argv = call["argv"]
            for value in (old, pw):
                self.assertNotIn(value, " ".join(argv))
            for plain in ("-storepass", "-keypass", "-new"):
                self.assertNotIn(plain, argv)  # only the :env forms

    def test_a_pkcs12_store_changes_its_one_password_and_sets_both_secrets(
        self,
    ) -> None:
        ks, old = self.make_keystore()
        self.rotate()
        pw = box.parse_env_file(box.env_file().read_text())[box.BOX_PASSWORD_ENV]
        self.assertNotEqual(pw, old)
        calls = self.keytool_calls()
        self.assertEqual([c["argv"][0] for c in calls], ["-list", "-storepasswd"])
        store = calls[1]
        self.assertIn("-new:env", store["argv"])
        self.assertEqual(store["envs"][box.NEW_PASSWORD_ENV], pw)
        self.assertEqual(store["envs"][box.BOX_PASSWORD_ENV], old)
        self.check_env_only(calls, old, pw)
        self.assertEqual(
            base64.b64decode(
                (self.gh_dir / "secret.ARLESH_BOX_KEYSTORE_B64.txt").read_text()
            ),
            ks.read_bytes(),
        )
        self.assertEqual(
            (self.gh_dir / "secret.ARLESH_BOX_KEYSTORE_PASSWORD.txt").read_text(), pw
        )
        self.assertEqual(len((self.gh_dir / "secret.args").read_text().splitlines()), 2)

    def test_a_jks_store_also_changes_the_key_password(self) -> None:
        _, old = self.make_keystore()
        os.environ["FAKE_KEYTOOL_TYPE"] = "jks"
        try:
            self.rotate()
        finally:
            del os.environ["FAKE_KEYTOOL_TYPE"]
        pw = box.parse_env_file(box.env_file().read_text())[box.BOX_PASSWORD_ENV]
        calls = self.keytool_calls()
        self.assertEqual(
            [c["argv"][0] for c in calls], ["-list", "-storepasswd", "-keypasswd"]
        )
        key = calls[2]
        self.assertIn("-alias", key["argv"])
        self.assertEqual(key["envs"][box.NEW_PASSWORD_ENV], pw)
        self.assertEqual(key["envs"][box.BOX_PASSWORD_ENV], old)
        self.check_env_only(calls, old, pw)

    def test_a_failed_upload_changes_nothing_locally(self) -> None:
        ks, _ = self.make_keystore()
        self.gh_state(secret_ok=False)
        with self.assertRaises(box.BoxError):
            self.rotate()
        self.assertEqual(ks.read_text(), "existing")
        self.assertFalse(box.env_file().exists())
        self.assertFalse(list(ks.parent.glob("*.new")))

    def test_needs_a_keystore_and_the_old_value_in_the_environment(self) -> None:
        with self.assertRaises(box.BoxError) as ctx:
            self.rotate()
        self.assertIn("keystore init", str(ctx.exception))
        self.make_keystore()
        del os.environ[box.BOX_PASSWORD_ENV]
        with self.assertRaises(box.BoxError) as ctx:
            self.rotate()
        self.assertIn(box.BOX_PASSWORD_ENV, str(ctx.exception))
        self.assertEqual(self.keytool_calls(), [])

    def test_parse(self) -> None:
        a = box.parse_args(["keystore", "rotate-password"])
        self.assertEqual((a.fn, a.keystore_cmd), (box.cmd_keystore, "rotate-password"))


class KeystoreMigrate(IsolatedEnv):
    def setUp(self) -> None:
        super().setUp()
        os.environ.pop(box.BOX_PASSWORD_ENV, None)
        self.legacy = box.legacy_password_file()
        self.legacy.parent.mkdir(parents=True)
        self.value = secrets.token_urlsafe(18)
        self.legacy.write_text(self.value + "\n")

    def test_moves_the_value_into_box_env_and_deletes_the_file(self) -> None:
        with contextlib.redirect_stdout(io.StringIO()) as out:
            box.keystore_migrate(yes=True)
        values = box.parse_env_file(box.env_file().read_text())
        self.assertEqual(values[box.BOX_PASSWORD_ENV], self.value)
        self.assertEqual(oct(box.env_file().stat().st_mode & 0o777), "0o600")
        self.assertFalse(self.legacy.exists())
        self.assertNotIn(self.value, out.getvalue())

    def test_asks_first_and_a_no_changes_nothing(self) -> None:
        with (
            mock.patch.object(box, "interactive", lambda: True),
            mock.patch.object(box, "ask", lambda prompt: "n"),
            contextlib.redirect_stdout(io.StringIO()),
        ):
            box.keystore_migrate(yes=False)
        self.assertTrue(self.legacy.exists())
        self.assertFalse(box.env_file().exists())

    def test_without_a_terminal_it_needs_yes(self) -> None:
        with (
            mock.patch.object(box, "interactive", lambda: False),
            self.assertRaises(box.BoxError),
        ):
            box.keystore_migrate(yes=False)
        self.assertTrue(self.legacy.exists())

    def test_a_different_value_already_in_the_environment_is_not_replaced(self) -> None:
        os.environ[box.BOX_PASSWORD_ENV] = secrets.token_urlsafe(18)
        with self.assertRaises(box.BoxError):
            box.keystore_migrate(yes=True)
        self.assertTrue(self.legacy.exists())

    def test_parse(self) -> None:
        a = box.parse_args(["keystore", "migrate", "-y"])
        self.assertEqual(
            (a.fn, a.keystore_cmd, a.yes), (box.cmd_keystore, "migrate", True)
        )


class SigningSelection(IsolatedEnv):
    def setUp(self) -> None:
        super().setUp()
        os.environ.pop(box.BOX_PASSWORD_ENV, None)

    def test_the_box_keystore_with_the_variable_set(self) -> None:
        ks = box.box_keystore()
        ks.parent.mkdir(parents=True)
        ks.write_text("k")
        os.environ[box.BOX_PASSWORD_ENV] = secrets.token_urlsafe(18)
        sign = box.choose_signing()
        self.assertEqual((sign.keystore, sign.alias), (ks, "arlesh-box"))

    def test_a_missing_variable_says_how_to_fix_it(self) -> None:
        ks = box.box_keystore()
        ks.parent.mkdir(parents=True)
        ks.write_text("k")
        with self.assertRaises(box.BoxError) as ctx:
            box.choose_signing()
        message = str(ctx.exception)
        self.assertIn(box.BOX_PASSWORD_ENV, message)
        self.assertIn("box.env", message)
        self.assertIn("keystore init", message)

    def test_a_leftover_password_file_is_pointed_at_migrate(self) -> None:
        ks = box.box_keystore()
        ks.parent.mkdir(parents=True)
        ks.write_text("k")
        box.legacy_password_file().write_text("x")
        with self.assertRaises(box.BoxError) as ctx:
            box.choose_signing()
        self.assertIn("keystore migrate", str(ctx.exception))

    def test_no_keystore_never_falls_back_to_a_debug_one(self) -> None:
        debug = box.home() / ".android" / "debug.keystore"
        debug.parent.mkdir(parents=True)
        debug.write_text("d")
        os.environ[box.BOX_PASSWORD_ENV] = secrets.token_urlsafe(18)
        with self.assertRaises(box.BoxError) as ctx:
            box.choose_signing()
        self.assertIn("keystore init", str(ctx.exception))


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
    "192.0.2.11:46175   device product:phonex model:Phone_X device:phonex transport_id:1\n"
    "adb-SERIAL0001-abc123._adb-tls-connect._tcp device product:phonex model:Phone_X "
    "device:phonex transport_id:2"
)
AVAHI = (
    "+;wlan0;IPv4;adb-SERIAL0001-abc123;_adb-tls-connect._tcp;local\n"
    "=;wlan0;IPv6;adb-SERIAL0001-abc123;_adb-tls-connect._tcp;local;Android_TEST.local;"
    'fe80::1;46175;"serial=SERIAL0001"\n'
    "=;wlan0;IPv4;adb-SERIAL0001-abc123;_adb-tls-connect._tcp;local;Android_TEST.local;"
    '192.0.2.11;46175;"serial=SERIAL0001"'
)
TAILNET_IP, LAN_IP = "100.64.0.10", "192.0.2.11"


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
            '  "-s "*" shell getprop ro.serialno") echo SERIAL0001 ;;\n'
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
        box.device_add("phone", "android", host, serial)
        if more:
            box.save_devices({"phone": replace(box.load_devices()["phone"], **more)})
        info = [(2, 1, 6, "", (ip, 0))] if ip else []
        with mock.patch.object(box.socket, "getaddrinfo", return_value=info):
            return box.resolve_device(box.load_devices()["phone"])

    def adb_calls(self) -> list[str]:
        return self.log.read_text().splitlines()

    def test_the_avahi_listing_parses_to_one_ipv4_entry_with_its_serial(self) -> None:
        self.assertEqual(
            box.discover(),
            [box.MdnsEntry("adb-SERIAL0001-abc123", LAN_IP, "46175", "SERIAL0001")],
        )

    def test_an_adb_listing_wins_over_avahi(self) -> None:
        os.environ["FAKE_MDNS"] = MDNS_LINE
        self.assertEqual([e.port for e in box.discover()], ["33691"])

    def test_a_known_serial_uses_the_connected_mdns_transport_without_connecting(
        self,
    ) -> None:
        os.environ["FAKE_DEVICES"] = DEVICES_L
        got = self.resolve("phone", TAILNET_IP, serial="SERIAL0001")
        self.assertEqual(got, "adb-SERIAL0001-abc123._adb-tls-connect._tcp")
        self.assertFalse([c for c in self.adb_calls() if c.startswith("connect")])

    def test_phone_local_matches_the_connected_ip_transport_by_address(self) -> None:
        os.environ["FAKE_DEVICES"] = DEVICES_L.splitlines()[0]
        self.assertEqual(self.resolve("phone.local", LAN_IP), f"{LAN_IP}:46175")
        self.assertEqual(box.load_devices()["phone"].adb_serial, "SERIAL0001")

    def test_a_connected_transport_is_found_by_asking_it_for_the_serial(self) -> None:
        os.environ["FAKE_DEVICES"] = f"{LAN_IP}:46175 device product:phonex"
        self.assertEqual(
            self.resolve("phone", TAILNET_IP, serial="SERIAL0001"),
            f"{LAN_IP}:46175",
        )

    def test_a_tailnet_name_with_a_known_serial_connects_on_the_tailnet_ip_and_found_port(
        self,
    ) -> None:
        os.environ["FAKE_UP"] = f"{TAILNET_IP}:46175"
        got = self.resolve("phone", TAILNET_IP, serial="SERIAL0001")
        self.assertEqual(got, f"{TAILNET_IP}:46175")
        self.assertEqual(box.load_devices()["phone"].last_port, "46175")

    def test_first_run_with_a_tailnet_name_and_no_serial_proves_it_by_connecting(
        self,
    ) -> None:
        os.environ["FAKE_UP"] = f"{TAILNET_IP}:46175"
        got = self.resolve("phone", TAILNET_IP)
        self.assertEqual(got, f"{TAILNET_IP}:46175")
        stored = box.load_devices()["phone"]
        self.assertEqual((stored.adb_serial, stored.last_port), ("SERIAL0001", "46175"))

    def test_the_serial_is_read_from_the_device_never_from_the_transport_name(
        self,
    ) -> None:
        os.environ["FAKE_UP"] = "10.0.0.5:5555"
        self.assertEqual(self.resolve("10.0.0.5:5555", "10.0.0.5"), "10.0.0.5:5555")
        self.assertEqual(box.load_devices()["phone"].adb_serial, "SERIAL0001")
        self.assertNotIn("get-serialno", self.log.read_text())

    def test_nothing_discovered_falls_back_to_the_last_port_that_worked(self) -> None:
        os.environ.update(FAKE_AVAHI="", FAKE_UP="phone:40001")
        self.assertEqual(
            self.resolve("phone", TAILNET_IP, last_port="40001"),
            "phone:40001",
        )

    def test_a_registered_port_is_tried_before_the_last_one(self) -> None:
        os.environ.update(FAKE_AVAHI="", FAKE_UP="phone:5555 phone:40001")
        self.assertEqual(
            self.resolve("phone:5555", TAILNET_IP, last_port="40001"),
            "phone:5555",
        )

    def test_when_everything_fails_the_error_offers_tcpip_5555(self) -> None:
        os.environ["FAKE_AVAHI"] = ""
        with self.assertRaises(box.BoxError) as ctx:
            self.resolve("phone", TAILNET_IP)
        self.assertIn("adb tcpip 5555", str(ctx.exception))
        self.assertIn("phone:5555", str(ctx.exception))

    def test_serial_alone_registers_and_matches(self) -> None:
        a = box.parse_args(
            ["devices", "add", "p", "--os", "android", "--serial", "SERIAL0001"]
        )
        self.assertEqual((a.host, a.serial), (None, "SERIAL0001"))
        box.cmd_devices(a)
        self.assertEqual(box.load_devices()["p"].adb_serial, "SERIAL0001")
        os.environ["FAKE_DEVICES"] = DEVICES_L
        with mock.patch.object(box.socket, "getaddrinfo", return_value=[]):
            self.assertEqual(
                box.resolve_device(box.load_devices()["p"]),
                "adb-SERIAL0001-abc123._adb-tls-connect._tcp",
            )

    def test_addresses_and_transport_names_are_not_serials(self) -> None:
        for bad in (
            "192.0.2.11:46175",
            "10.0.0.5",
            "adb-SERIAL0001-abc123._adb-tls-connect._tcp",
            "adb-SERIAL0001-abc123",
            "unknown",
            "",
        ):
            self.assertFalse(box.plausible_serial(bad), bad)
        self.assertTrue(box.plausible_serial("SERIAL0001"))
        with self.assertRaises(box.UsageError):
            box.device_add("x", "android", "h", serial="10.0.0.5:5555")


class SshFallback(IsolatedEnv):
    """Fake scp and ssh that log their argv, as a Termux sshd on port 8022 would be reached."""

    def setUp(self) -> None:
        super().setUp()
        self.log = self.tmp / "calls.log"
        fake = 'echo "$0 $*" >> "$FAKE_LOG"; exit ${FAKE_EXIT:-0}'
        bindir = fake_bin(self.tmp, "scp", fake)
        fake_bin(self.tmp, "ssh", fake)
        os.environ.update(
            PATH=f"{bindir}{os.pathsep}{os.environ['PATH']}", FAKE_LOG=str(self.log)
        )
        self.target = box.Target("phone", "android", "phone", ssh="phone:8022")
        apk = box.android_apk("b")
        apk.parent.mkdir(parents=True)
        apk.write_text("apk")

    def calls(self) -> list[str]:
        return [
            c.replace(f"{self.tmp}/bin/", "") for c in self.log.read_text().splitlines()
        ]

    def test_scp_then_termux_open_with_batchmode_and_the_port(self) -> None:
        with mock.patch.object(box, "note") as note:
            box.install_over_ssh("b", self.target, "no route")
        scp, ssh = self.calls()
        self.assertTrue(
            scp.startswith("scp -o BatchMode=yes -o ConnectTimeout=10 -P 8022 ")
        )
        self.assertTrue(scp.endswith("phone:storage/downloads/arlesh-b.apk"))
        self.assertTrue(
            ssh.startswith("ssh -o BatchMode=yes -o ConnectTimeout=10 -p 8022 phone")
        )
        self.assertTrue(ssh.endswith("termux-open ~/storage/downloads/arlesh-b.apk"))
        said = " ".join(c.args[0] for c in note.call_args_list)
        self.assertIn("not pre-bound", said)
        self.assertIn("adb pair", said)

    def test_a_user_and_no_port(self) -> None:
        prefix, dest = box.ssh_argv("ssh", "u0_a1@phone")
        self.assertEqual((prefix[-1], dest), ("ConnectTimeout=10", "u0_a1@phone"))

    def test_a_failed_scp_says_how_to_fix_termux(self) -> None:
        os.environ["FAKE_EXIT"] = "1"
        with mock.patch.object(box, "note"), self.assertRaises(box.BoxError) as ctx:
            box.install_over_ssh("b", self.target, "no route")
        self.assertIn("termux-setup-storage", str(ctx.exception))
        self.assertEqual(len(self.calls()), 1)

    def test_run_android_falls_back_only_when_ssh_is_registered(self) -> None:
        args = box.parse_args(["run", "b", "phone"])
        boom = box.BoxError("Could not reach phone\nmore")
        with (
            mock.patch.object(box, "android_env"),
            mock.patch.object(box, "resolve_device", side_effect=boom),
            mock.patch.object(box, "prepare_apk", return_value="s"),
            mock.patch.object(box, "install_over_ssh") as over,
            mock.patch.object(box, "package_installed") as installed,
        ):
            box.run_android("b", self.tmp, self.target, args)
            over.assert_called_once()
            installed.assert_not_called()
            with self.assertRaises(box.BoxError):
                box.run_android("b", self.tmp, replace(self.target, ssh=None), args)

    def test_devices_add_takes_ssh(self) -> None:
        a = box.parse_args(
            [
                "devices",
                "add",
                "phone",
                "--os",
                "android",
                "--host",
                "phone",
                "--ssh",
                "phone:8022",
            ]
        )
        box.cmd_devices(a)
        self.assertEqual(box.load_devices()["phone"].ssh, "phone:8022")


FAKE_PR_GH = """#!__PY__
import json, os, sys
d = os.environ["FAKE_GH_DIR"]
a = sys.argv[1:]
if a[:2] == ["auth", "status"]:
    sys.exit(0 if os.path.exists(d + "/authed") else 1)
if a[:2] == ["pr", "list"]:
    state = a[a.index("--state") + 1]
    data = json.load(open(d + "/" + state + ".json"))
    if "--head" in a:
        data = [x for x in data if x["headRefName"] == a[a.index("--head") + 1]]
    print(json.dumps(data))
    sys.exit(0)
sys.exit(1)
"""

FAKE_PR_ADB = """#!/bin/sh
echo "$*" >> "$FAKE_GH_DIR/adb.log"
case "$*" in
  *"pm list packages"*) echo "package:com.atai.arlesh.box.ghost" ;;
  *uninstall*) echo Success ;;
esac
"""


class OpenPrFixture(OriginFixture):
    """Origin with dev/master and branches in every pruning situation, a fake `gh` and `adb`."""

    def setUp(self) -> None:
        super().setUp()
        seed = self.seed
        git(seed, "checkout", "-q", "-b", "dev", "master")
        git(seed, "commit", "-q", "--allow-empty", "-m", "dev work")
        git(seed, "push", "-q", "origin", "dev")
        for b in (
            "pr-with-wt",
            "pr-no-wt",
            "merged-ff",
            "unmerged",
            "dirty",
            "unpushed",
            "squashed",
        ):
            git(seed, "checkout", "-q", "-b", b, "dev")
            if b in ("unmerged", "squashed", "pr-with-wt", "pr-no-wt"):
                git(seed, "commit", "-q", "--allow-empty", "-m", b)
            git(seed, "push", "-q", "origin", b)
        git(self.main, "fetch", "-q", "origin")
        self.wts = {
            b: box.ensure_worktree(b, report=False)
            for b in (
                "pr-with-wt",
                "merged-ff",
                "unmerged",
                "dirty",
                "unpushed",
                "squashed",
                "dev",
            )
        }
        (self.wts["dirty"] / "scratch.txt").write_text("wip")
        git(self.wts["unpushed"], "commit", "-q", "--allow-empty", "-m", "local only")
        self.gh_dir = self.tmp / "gh"
        self.gh_dir.mkdir()
        os.environ["FAKE_GH_DIR"] = str(self.gh_dir)
        write_exe(fake_bin(self.tmp, "gh", "") / "gh", FAKE_PR_GH)
        write_exe(fake_bin(self.tmp, "adb", "") / "adb", FAKE_PR_ADB)
        os.environ["PATH"] = f"{self.tmp / 'bin'}{os.pathsep}{os.environ['PATH']}"
        (self.gh_dir / "authed").write_text("")
        self.set_prs(open=["pr-with-wt", "pr-no-wt"], merged=["squashed"])
        cwd = os.getcwd()
        self.addCleanup(os.chdir, cwd)
        os.chdir(self.tmp)
        patcher = mock.patch.object(
            box, "reachable_android_devices", return_value={"pixel": "S1"}
        )
        patcher.start()
        self.addCleanup(patcher.stop)

    def set_prs(self, open: list[str], merged: list[str]) -> None:
        def entry(b: str, n: int) -> dict[str, Any]:
            return {"number": n, "title": f"Title of {b}", "headRefName": b,
                    "baseRefName": "dev", "isDraft": b == "pr-no-wt", "url": f"u/{n}"}  # fmt: skip

        (self.gh_dir / "open.json").write_text(
            json.dumps([entry(b, 100 + i) for i, b in enumerate(open)])
        )
        (self.gh_dir / "merged.json").write_text(
            json.dumps([entry(b, 50 + i) for i, b in enumerate(merged)])
        )

    def run_box(self, *argv: str) -> tuple[int, str, str]:
        out, err = io.StringIO(), io.StringIO()
        with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
            code = box.main(list(argv))
        return code, out.getvalue(), err.getvalue()

    def adb_log(self) -> str:
        log = self.gh_dir / "adb.log"
        return log.read_text() if log.exists() else ""


class ListOpenPrs(OpenPrFixture):
    def test_rows_for_open_prs_then_long_lived_and_prunable(self) -> None:
        code, out, _ = self.run_box("list")
        self.assertEqual(code, 0)
        lines = out.splitlines()
        rows = {
            ln.split()[1]: ln for ln in lines if ln[:1] in "#-" and len(ln.split()) > 2
        }
        self.assertIn("#100", rows["pr-with-wt"])
        self.assertIn("pr-with-wt", rows["pr-with-wt"])
        self.assertIn("synced", rows["pr-with-wt"])
        self.assertIn("draft", rows["pr-no-wt"])
        self.assertIn("(none)", rows["pr-no-wt"])
        sep = lines.index("-" * 8)
        self.assertLess(lines.index(rows["pr-no-wt"]), sep)
        self.assertIn("long-lived", rows["dev"])
        self.assertIn("long-lived", rows["master"])
        self.assertIn("(main checkout)", rows["master"])
        self.assertIn("ahead 1", rows["unpushed"])
        for b in ("merged-ff", "unmerged", "dirty", "unpushed", "squashed"):
            self.assertIn("no open PR (prunable)", rows[b])
            self.assertGreater(lines.index(rows[b]), sep)

    def test_build_and_install_state(self) -> None:
        wt = self.wts["pr-with-wt"]
        stamp = box.worktree_stamp(wt)
        box.update_state(lambda s: (
            s["built"][box.DESKTOP].__setitem__("pr-with-wt", stamp),
            s["installed"].setdefault("pixel", {}).__setitem__("pr-with-wt", "old"),
        ))  # fmt: skip
        box.desktop_binary("pr-with-wt").parent.mkdir(parents=True, exist_ok=True)
        box.desktop_binary("pr-with-wt").write_text("x")
        _, out, _ = self.run_box("list", "--json")
        row = next(
            r for r in json.loads(out)["pull_requests"] if r["branch"] == "pr-with-wt"
        )
        self.assertEqual(row["desktop"], "fresh")
        self.assertEqual(row["installed"], {"pixel": "stale"})
        self.assertEqual(row["pr"]["number"], 100)

    def test_without_gh_falls_back_to_the_worktrees(self) -> None:
        (self.gh_dir / "authed").unlink()
        code, out, err = self.run_box("list")
        self.assertEqual(code, 0)
        self.assertIn("Open PRs unavailable", err)
        self.assertIn("gh is not authenticated", err)
        self.assertIn("DESKTOP", out)
        self.assertIn("unmerged", out)
        self.assertNotIn("prunable", out)


class PruneWorktrees(OpenPrFixture):
    def test_dry_run_plans_exactly_the_clean_no_pr_worktrees(self) -> None:
        code, out, _ = self.run_box("prune", "--dry-run")
        self.assertEqual(code, 0)
        planned = {
            ln.split()[2] for ln in out.splitlines() if ln.startswith("remove worktree")
        }
        self.assertEqual(planned, {"merged-ff", "unmerged", "squashed"})
        self.assertIn("kept: dirty: dirty", out)
        self.assertIn("kept: unpushed: 1 unpushed commits", out)
        self.assertIn("kept: dev: long-lived branch", out)
        self.assertIn("dry run", out)
        self.assertIn("local branch: delete (merged into origin/dev)", out)
        self.assertIn("local branch: delete (its PR was merged)", out)
        self.assertIn("local branch: keep (not merged)", out)
        self.assertEqual(sorted(box.all_names()), sorted(self.wts))
        self.assertEqual(self.adb_log().count("uninstall"), 0)

    def prompt(self, tty: bool, answer: str = "") -> tuple[int, str, str, list[str]]:
        asked: list[str] = []

        def fake_ask(text: str) -> str:
            asked.append(text)
            return answer

        with (
            mock.patch.object(box, "interactive", return_value=tty),
            mock.patch.object(box, "ask", fake_ask),
        ):
            code, out, err = self.run_box("prune")
        return code, out, err, asked

    def test_prompt_yes_applies(self) -> None:
        code, out, _, asked = self.prompt(True, "YES")
        self.assertEqual((code, asked), (0, ["Proceed? [y/N] "]))
        self.assertIn("removed worktree merged-ff", out)
        self.assertNotIn("merged-ff", box.all_names())

    def test_prompt_no_or_empty_changes_nothing(self) -> None:
        for answer in ("n", "", "maybe"):
            code, out, _, asked = self.prompt(True, answer)
            self.assertEqual((code, len(asked)), (0, 1))
            self.assertIn("aborted; nothing changed", out)
            self.assertEqual(sorted(box.all_names()), sorted(self.wts))
        self.assertEqual(self.adb_log().count("uninstall"), 0)

    def test_without_a_terminal_it_prints_the_plan_and_fails_without_asking(
        self,
    ) -> None:
        code, out, err, asked = self.prompt(False)
        self.assertEqual((code, asked), (1, []))
        self.assertIn("remove worktree merged-ff", out)
        self.assertIn("re-run with -y", err)
        self.assertEqual(sorted(box.all_names()), sorted(self.wts))

    def test_dash_y_never_asks(self) -> None:
        with mock.patch.object(box, "ask", side_effect=AssertionError("asked")):
            code, _, _ = self.run_box("prune", "-y")
        self.assertEqual(code, 0)
        self.assertNotIn("merged-ff", box.all_names())

    def test_current_directory_is_kept(self) -> None:
        os.chdir(self.wts["unmerged"] / ".")
        _, out, _ = self.run_box("prune", "--dry-run")
        self.assertIn("kept: unmerged: current directory", out)
        self.assertNotIn("remove worktree unmerged", out)

    def test_yes_removes_worktrees_and_deletes_only_merged_branches(self) -> None:
        code, out, _ = self.run_box("prune", "--yes")
        self.assertEqual(code, 0)
        self.assertEqual(
            sorted(box.all_names()), ["dev", "dirty", "pr-with-wt", "unpushed"]
        )
        branches = box.git_in(
            self.main, "branch", "--format=%(refname:short)"
        ).stdout.split()
        self.assertNotIn("merged-ff", branches)
        self.assertNotIn("squashed", branches)
        self.assertIn("unmerged", branches)
        self.assertIn("kept local branch unmerged: not merged", out)
        self.assertTrue(box.ref_exists(self.main, "refs/remotes/origin/merged-ff"))
        remote = box.git_in(self.main, "ls-remote", "--heads", "origin").stdout
        for b in ("merged-ff", "unmerged", "squashed"):
            self.assertIn(f"refs/heads/{b}", remote)
        self.assertIn("uninstall com.atai.arlesh.box.merged_ff", self.adb_log())
        self.assertIn("uninstall com.atai.arlesh.box.ghost", self.adb_log())

    def test_yes_stops_the_branch_server_and_app_first(self) -> None:
        order: list[str] = []
        with (
            mock.patch.object(
                box, "stop_instance", lambda n: order.append(f"stop {n}")
            ),
            mock.patch.object(
                box, "stop_server", lambda n: order.append(f"server {n}")
            ),
        ):
            box.server_dir("merged-ff").mkdir(parents=True)
            self.run_box("prune", "--yes")
        self.assertLess(order.index("stop merged-ff"), order.index("server merged-ff"))
        self.assertNotIn("server unmerged", order)

    def test_without_gh_only_apps_are_pruned(self) -> None:
        (self.gh_dir / "authed").unlink()
        code, out, err = self.run_box("prune", "--yes")
        self.assertEqual(code, 0)
        self.assertIn("Not pruning worktrees", err)
        self.assertEqual(sorted(box.all_names()), sorted(self.wts))
        self.assertIn("pruned 1 test app(s)", out)
        self.assertIn("uninstall com.atai.arlesh.box.ghost", self.adb_log())


class NodeModules(IsolatedEnv):
    """Each worktree installs its own `node_modules`; nothing is shared with the main checkout."""

    def setUp(self) -> None:
        super().setUp()
        self.wt = self.tmp / "wt"
        self.wt.mkdir()
        (self.wt / "package-lock.json").write_text("v1")

    def ensure(self) -> list[Any]:
        calls: list[Any] = []

        def fake_ci(cmd, **kw):  # type: ignore[no-untyped-def]
            calls.append((cmd, kw["cwd"]))
            (self.wt / "node_modules").mkdir(exist_ok=True)
            return subprocess.CompletedProcess(cmd, 0, "", "")

        with (
            mock.patch.object(box, "need_cmd"),
            mock.patch.object(box, "capture", fake_ci),
            contextlib.redirect_stdout(io.StringIO()),
        ):
            box.ensure_node_modules(self.wt)
        return calls

    def test_installs_when_missing_and_not_again_when_the_lockfile_is_unchanged(
        self,
    ) -> None:
        first = self.ensure()
        self.assertEqual([c[0][:2] for c in first], [["npm", "ci"]])
        self.assertEqual(first[0][1], self.wt)
        self.assertEqual(self.ensure(), [])

    def test_reinstalls_when_the_lockfile_changed(self) -> None:
        self.ensure()
        (self.wt / "package-lock.json").write_text("v2")
        self.assertEqual(len(self.ensure()), 1)
        self.assertEqual(self.ensure(), [])

    def test_reinstalls_when_node_modules_was_deleted(self) -> None:
        self.ensure()
        shutil.rmtree(self.wt / "node_modules")
        self.assertEqual(len(self.ensure()), 1)

    def test_the_old_shared_symlink_is_replaced_by_a_real_install(self) -> None:
        shared = self.tmp / "main-node_modules"
        shared.mkdir()
        (self.wt / "node_modules").symlink_to(shared)
        self.assertEqual(len(self.ensure()), 1)
        self.assertFalse((self.wt / "node_modules").is_symlink())
        self.assertTrue(shared.is_dir())  # the main checkout's is left alone

    def test_a_failed_install_stops_and_leaves_no_stamp(self) -> None:
        (self.wt / "node_modules").mkdir()
        bad = subprocess.CompletedProcess([], 1, "", "boom")
        with (
            mock.patch.object(box, "need_cmd"),
            mock.patch.object(box, "capture", return_value=bad),
            contextlib.redirect_stdout(io.StringIO()),
            self.assertRaises(box.BoxError),
        ):
            box.ensure_node_modules(self.wt)
        self.assertFalse((self.wt / "node_modules" / ".arlesh-lock-stamp").exists())


SECRET = secrets.token_urlsafe(
    18
)  # made per run: no credential-shaped literal in the repo


def make_db(path: Path, titles: list[str], migration: int | None = None) -> None:
    con = sqlite3.connect(path)
    con.execute("CREATE TABLE nodes (id INTEGER PRIMARY KEY, title TEXT)")
    con.executemany("INSERT INTO nodes (title) VALUES (?)", [(t,) for t in titles])
    if migration is not None:
        con.execute("CREATE TABLE _sqlx_migrations (version BIGINT, success BOOLEAN)")
        con.execute("INSERT INTO _sqlx_migrations VALUES (?, 1)", (migration,))
    con.commit()
    con.close()


def titles(path: Path) -> list[str]:
    con = sqlite3.connect(path)
    try:
        return [t for (t,) in con.execute("SELECT title FROM nodes ORDER BY id")]
    finally:
        con.close()


class FakeServer:
    """A local HTTP server answering GET /backup like arlesh-server does (and recording it)."""

    def __init__(self, snapshot: bytes, token: str = SECRET) -> None:
        outer = self
        self.requests: list[tuple[str, str, str | None]] = []
        self.status_override: int | None = None
        self.body = snapshot

        class Handler(http.server.BaseHTTPRequestHandler):
            def do_GET(self) -> None:
                auth = self.headers.get("Authorization")
                outer.requests.append((self.command, self.path, auth))
                if outer.status_override is not None:
                    self.send_response(outer.status_override)
                    self.send_header("Content-Length", "0")
                    self.end_headers()
                elif self.path == "/redirect":
                    self.send_response(302)
                    self.send_header("Location", "/backup")
                    self.send_header("Content-Length", "0")
                    self.end_headers()
                elif self.path != "/backup":
                    self.send_response(404)
                    self.send_header("Content-Length", "0")
                    self.end_headers()
                elif auth != f"Bearer {token}":
                    self.send_response(401)
                    self.send_header("Content-Length", "0")
                    self.end_headers()
                else:
                    self.send_response(200)
                    self.send_header("Content-Type", "application/vnd.sqlite3")
                    self.send_header("Content-Length", str(len(outer.body)))
                    self.end_headers()
                    self.wfile.write(outer.body)

            def log_message(self, *args: Any) -> None:
                pass

        self.httpd = http.server.ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        self.url = f"http://127.0.0.1:{self.httpd.server_port}"
        self.thread = threading.Thread(target=self.httpd.serve_forever, daemon=True)

    def __enter__(self) -> Self:
        self.thread.start()
        return self

    def __exit__(self, *exc: object) -> None:
        self.httpd.shutdown()
        self.httpd.server_close()


class SeedCase(IsolatedEnv):
    def setUp(self) -> None:
        super().setUp()
        for var in (box.SEED_URL_ENV, box.SEED_TOKEN_ENV, "ARLESH_REAL_DB"):
            os.environ.pop(var, None)
        box.SEED.local = False
        box.SEED.snapshot = None
        self.addCleanup(setattr, box.SEED, "snapshot", None)
        self.addCleanup(setattr, box.SEED, "local", False)
        self.snap = self.tmp / "server.db"
        make_db(self.snap, ["from the server"], migration=105)
        self.local = self.tmp / "local.db"
        make_db(self.local, ["from the desktop"])
        os.environ["ARLESH_REAL_DB"] = str(self.local)
        self.wt = self.tmp / "wt"
        (self.wt / "crates" / "arlesh-core" / "migrations").mkdir(parents=True)

    def configure(self, server: FakeServer) -> None:
        os.environ[box.SEED_URL_ENV] = server.url
        os.environ[box.SEED_TOKEN_ENV] = SECRET

    def seed(self, name: str = "b") -> Path:
        dest = self.tmp / f"{name}.db"
        with contextlib.redirect_stdout(io.StringIO()):
            box.seed_database(dest, self.wt, name)
        return dest


class SeedConfig(SeedCase):
    def run_seed(self, *argv: str, stdin: str = "") -> str:
        out = io.StringIO()
        with (
            mock.patch.object(sys, "stdin", io.StringIO(stdin)),
            contextlib.redirect_stdout(out),
        ):
            box.cmd_seed(box.parse_args(["seed", *argv]))
        return out.getvalue()

    def test_set_puts_both_in_box_env_and_show_never_prints_the_token(self) -> None:
        said = self.run_seed("set", "https://nas.example:4750/", stdin=SECRET + "\n")

        env = box.env_file()
        self.assertEqual(stat.S_IMODE(env.stat().st_mode), 0o600)
        values = box.parse_env_file(env.read_text())
        self.assertEqual(values[box.SEED_TOKEN_ENV], SECRET)
        self.assertEqual(values[box.SEED_URL_ENV], "https://nas.example:4750")
        shown = self.run_seed("show")
        self.assertIn("https://nas.example:4750", shown)
        self.assertNotIn(SECRET, shown + said)

    def test_the_token_is_never_an_argument(self) -> None:
        with self.assertRaises(box.UsageError):
            box.parse_args(["seed", "set", "https://x", SECRET])

    def test_set_replaces_an_earlier_box_files(self) -> None:
        older = secrets.token_urlsafe(12)
        box.seed_url_file().parent.mkdir(parents=True, exist_ok=True)
        box.seed_url_file().write_text("https://old.example\n")
        box.seed_token_file().write_text(older + "\n")
        self.assertEqual(box.seed_token(), (older, "file"))

        self.run_seed("set", "https://new.example", stdin=SECRET)

        self.assertFalse(box.seed_url_file().exists())
        self.assertFalse(box.seed_token_file().exists())
        self.assertEqual(
            box.seed_source(), box.SeedSource("https://new.example", SECRET)
        )

    def test_an_empty_token_keeps_the_stored_one(self) -> None:
        self.run_seed("set", "https://a.example", stdin=SECRET)
        self.run_seed("set", "https://b.example", stdin="")

        self.assertEqual(box.seed_token(), (SECRET, "env"))
        self.assertEqual(box.seed_url(), ("https://b.example", "env"))
        values = box.parse_env_file(box.env_file().read_text())
        self.assertEqual(values[box.SEED_TOKEN_ENV], SECRET)

    def test_the_source_never_shows_the_token(self) -> None:
        os.environ[box.SEED_URL_ENV] = "https://env.example/"
        os.environ[box.SEED_TOKEN_ENV] = SECRET

        source = box.seed_source()

        self.assertEqual(source, box.SeedSource("https://env.example", SECRET))
        self.assertNotIn(SECRET, repr(source))

    def test_a_url_without_a_token_is_refused_when_seeding(self) -> None:
        os.environ[box.SEED_URL_ENV] = "https://a.example"

        with self.assertRaises(box.BoxError):
            box.seed_source()

    def test_a_bad_url_is_a_usage_error(self) -> None:
        with self.assertRaises(box.UsageError):
            self.run_seed("set", "nas.example", stdin="x")


class SeedDownload(SeedCase):
    def test_it_seeds_from_the_server_with_the_bearer_token(self) -> None:
        with FakeServer(self.snap.read_bytes()) as server:
            self.configure(server)

            dest = self.seed()

        self.assertEqual(titles(dest), ["from the server"])
        self.assertEqual(server.requests, [("GET", "/backup", f"Bearer {SECRET}")])

    def test_both_seeds_of_one_invocation_share_one_download(self) -> None:
        with FakeServer(self.snap.read_bytes()) as server:
            self.configure(server)

            first, second = self.seed("one"), self.seed("two")

        self.assertEqual(len(server.requests), 1)
        self.assertEqual(titles(first), titles(second))

    def test_the_snapshot_is_cached_in_the_state_dir_and_removed_at_exit(self) -> None:
        with FakeServer(self.snap.read_bytes()) as server:
            self.configure(server)
            with mock.patch.object(box.atexit, "register") as register:
                self.seed()

        cached = box.SEED.snapshot
        assert cached is not None
        self.assertEqual(cached.parent, box.state_dir() / "seed")
        self.assertEqual(stat.S_IMODE(cached.stat().st_mode), 0o600)
        register.assert_called_once_with(cached.unlink, missing_ok=True)

    def test_a_wrong_token_dies_with_a_clear_message(self) -> None:
        with FakeServer(self.snap.read_bytes(), token="other") as server:
            self.configure(server)

            with self.assertRaises(box.BoxError) as caught:
                self.seed()

        self.assertIn("token was refused", str(caught.exception))
        self.assertNotIn(SECRET, str(caught.exception))
        self.assertFalse((self.tmp / "b.db").exists())

    def test_a_server_without_backup_says_so(self) -> None:
        with FakeServer(b"") as server:
            server.status_override = 404
            self.configure(server)

            with self.assertRaises(box.BoxError) as caught:
                self.seed()

        self.assertIn("no /backup", str(caught.exception))

    def test_an_unreachable_server_dies_naming_the_way_out(self) -> None:
        os.environ[box.SEED_URL_ENV] = "http://127.0.0.1:9"
        os.environ[box.SEED_TOKEN_ENV] = SECRET

        with self.assertRaises(box.BoxError) as caught:
            self.seed()

        self.assertIn("--local-seed", str(caught.exception))

    def test_an_answer_that_is_not_sqlite_is_refused(self) -> None:
        with FakeServer(b"<html>not a database</html>") as server:
            self.configure(server)

            with self.assertRaises(box.BoxError):
                self.seed()

        self.assertEqual(list((box.state_dir() / "seed").glob("*.part")), [])

    def test_a_redirect_is_not_followed_with_the_token(self) -> None:
        with FakeServer(self.snap.read_bytes()) as server:
            request = box.urllib.request.Request(
                f"{server.url}/redirect", headers={"Authorization": f"Bearer {SECRET}"}
            )
            with self.assertRaises(box.urllib.error.HTTPError):
                box.urllib.request.build_opener(box._NoRedirect).open(request)

        self.assertEqual([r[1] for r in server.requests], ["/redirect"])


class SeedFallbacks(SeedCase):
    def test_unconfigured_uses_the_local_copy_with_a_note(self) -> None:
        err = io.StringIO()
        with contextlib.redirect_stderr(err):
            dest = self.seed()

        self.assertEqual(titles(dest), ["from the desktop"])
        self.assertEqual(err.getvalue().count("seed is local"), 1)

    def test_local_seed_forces_the_local_copy_even_when_configured(self) -> None:
        with FakeServer(self.snap.read_bytes()) as server:
            self.configure(server)
            box.SEED.local = True

            dest = self.seed()

        self.assertEqual(titles(dest), ["from the desktop"])
        self.assertEqual(server.requests, [])

    def test_the_flag_is_on_run_and_server_start(self) -> None:
        self.assertTrue(box.parse_args(["run", "b", "--local-seed"]).local_seed)
        self.assertTrue(
            box.parse_args(["server", "start", "b", "--local-seed"]).local_seed
        )

    def test_the_local_database_is_never_written(self) -> None:
        before = self.local.read_bytes()
        with contextlib.redirect_stderr(io.StringIO()):
            self.seed()

        self.assertEqual(self.local.read_bytes(), before)


def add_credentials(path: Path) -> None:
    con = sqlite3.connect(path)
    con.execute(
        "CREATE TABLE server_tokens (client TEXT PRIMARY KEY, sha256 TEXT, created_at TEXT)"
    )
    con.execute("INSERT INTO server_tokens VALUES ('phone', 'abc', 'now')")
    con.execute("CREATE TABLE pairing_pins (id_sha256 TEXT PRIMARY KEY, pin TEXT)")
    con.execute("INSERT INTO pairing_pins VALUES ('id', '123456')")
    con.commit()
    con.close()


def count(path: Path, table: str) -> int:
    con = sqlite3.connect(path)
    try:
        return int(con.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0])
    finally:
        con.close()


class Scrub(SeedCase):
    def setUp(self) -> None:
        super().setUp()
        add_credentials(self.snap)
        add_credentials(self.local)

    def test_a_server_seed_has_no_tokens_or_pins_but_keeps_data(self) -> None:
        with FakeServer(self.snap.read_bytes()) as server:
            self.configure(server)

            dest = self.seed()

        self.assertEqual(count(dest, "server_tokens"), 0)
        self.assertEqual(count(dest, "pairing_pins"), 0)
        self.assertEqual(titles(dest), ["from the server"])
        self.assertNotIn(b"abc", dest.read_bytes())
        self.assertFalse(dest.with_name(dest.name + ".seed").exists())

    def test_a_local_seed_is_scrubbed_and_the_source_is_untouched(self) -> None:
        with contextlib.redirect_stderr(io.StringIO()):
            dest = self.seed()

        self.assertEqual(count(dest, "server_tokens"), 0)
        self.assertEqual(count(dest, "pairing_pins"), 0)
        self.assertEqual(titles(dest), ["from the desktop"])
        self.assertEqual(count(self.local, "server_tokens"), 1)
        self.assertEqual(count(self.local, "pairing_pins"), 1)

    def test_a_schema_without_the_tables_is_fine(self) -> None:
        self.assertEqual(box.scrub_credentials(self.make_plain()), [])

    def make_plain(self) -> Path:
        plain = self.tmp / "plain.db"
        make_db(plain, ["x"])
        return plain

    def test_it_reports_the_tables_it_cleared(self) -> None:
        self.assertEqual(
            box.scrub_credentials(self.snap), ["server_tokens", "pairing_pins"]
        )

    def test_the_cached_snapshot_itself_is_not_the_seed_that_gets_used(self) -> None:
        with FakeServer(self.snap.read_bytes()) as server:
            self.configure(server)
            self.seed()

        self.assertEqual(titles(self.snap), ["from the server"])
        self.assertEqual(count(self.snap, "server_tokens"), 1)


class SchemaCheck(SeedCase):
    def migrations(self, *numbers: int) -> None:
        for n in numbers:
            (
                self.wt / "crates" / "arlesh-core" / "migrations" / f"{n:04d}_x.sql"
            ).write_text("")

    def test_a_snapshot_ahead_of_the_branch_warns_plainly(self) -> None:
        self.migrations(98, 99)
        err = io.StringIO()
        with (
            FakeServer(self.snap.read_bytes()) as server,
            contextlib.redirect_stderr(err),
        ):
            self.configure(server)
            self.seed()

        self.assertIn("older than the server", err.getvalue())
        self.assertIn("0105", err.getvalue())
        self.assertIn("0099", err.getvalue())
        self.assertIn("refuse", err.getvalue())

    def test_a_branch_at_or_ahead_of_the_snapshot_is_quiet(self) -> None:
        self.migrations(105, 106)
        err = io.StringIO()
        with (
            FakeServer(self.snap.read_bytes()) as server,
            contextlib.redirect_stderr(err),
        ):
            self.configure(server)
            self.seed()

        self.assertEqual(err.getvalue(), "")

    def test_versions_are_read_from_the_snapshot_and_the_branch(self) -> None:
        self.migrations(3, 12)

        self.assertEqual(box.newest_applied_migration(self.snap), 105)
        self.assertEqual(box.newest_branch_migration(self.wt), 12)
        self.assertIsNone(box.newest_applied_migration(self.local))


class Reseed(SeedCase):
    def setUp(self) -> None:
        super().setUp()
        self.db = self.tmp / "servers" / "b" / "data" / "arlesh.db"
        self.db.parent.mkdir(parents=True)
        make_db(self.db, ["old branch data"])

    def reseed(
        self, *extra: str, running: bool = False, answer: str | None = None
    ) -> None:
        args = box.parse_args(["reseed", "b", *extra])
        patches = [
            mock.patch.object(box, "worktree_path", return_value=self.wt),
            mock.patch.object(box, "server_db", return_value=self.db),
            mock.patch.object(box, "instance_db", return_value=self.tmp / "none.db"),
            mock.patch.object(box, "server_running", return_value=running),
            mock.patch.object(box, "stop_server"),
            mock.patch.object(box, "server_start"),
            mock.patch.object(box, "stop_instance"),
            mock.patch.object(box, "interactive", return_value=answer is not None),
            mock.patch.object(box, "ask", return_value=answer or ""),
        ]
        with contextlib.ExitStack() as stack:
            self.mocks = [stack.enter_context(p) for p in patches]
            stack.enter_context(contextlib.redirect_stdout(io.StringIO()))
            stack.enter_context(contextlib.redirect_stderr(io.StringIO()))
            box.cmd_reseed(args)

    def test_it_replaces_the_database_and_keeps_the_old_one_as_prev(self) -> None:
        with FakeServer(self.snap.read_bytes()) as server:
            self.configure(server)

            self.reseed("-y")

        self.assertEqual(titles(self.db), ["from the server"])
        self.assertEqual(
            titles(self.db.with_name("arlesh.db.prev")), ["old branch data"]
        )

    def test_the_reseeded_database_has_no_credentials(self) -> None:
        add_credentials(self.snap)
        with FakeServer(self.snap.read_bytes()) as server:
            self.configure(server)

            self.reseed("-y")

        self.assertEqual(count(self.db, "server_tokens"), 0)
        self.assertEqual(count(self.db, "pairing_pins"), 0)
        self.assertEqual(titles(self.db), ["from the server"])

    def test_it_restarts_a_server_that_was_running(self) -> None:
        with FakeServer(self.snap.read_bytes()) as server:
            self.configure(server)

            self.reseed("-y", running=True)

        stop_server, server_start = self.mocks[4], self.mocks[5]
        stop_server.assert_called_once_with("b")
        server_start.assert_called_once()

    def test_it_leaves_a_stopped_server_stopped(self) -> None:
        with FakeServer(self.snap.read_bytes()) as server:
            self.configure(server)

            self.reseed("-y")

        self.mocks[5].assert_not_called()

    def test_without_y_it_asks_and_no_changes_nothing(self) -> None:
        with FakeServer(self.snap.read_bytes()) as server:
            self.configure(server)

            self.reseed(answer="n")

        self.assertEqual(titles(self.db), ["old branch data"])
        self.mocks[4].assert_not_called()

    def test_yes_at_the_prompt_proceeds(self) -> None:
        with FakeServer(self.snap.read_bytes()) as server:
            self.configure(server)

            self.reseed(answer="y")

        self.assertEqual(titles(self.db), ["from the server"])

    def test_without_a_terminal_and_without_y_it_refuses(self) -> None:
        with FakeServer(self.snap.read_bytes()) as server:
            self.configure(server)

            with self.assertRaises(box.BoxError):
                self.reseed()

        self.assertEqual(titles(self.db), ["old branch data"])

    def test_a_failed_download_stops_nothing_and_replaces_nothing(self) -> None:
        with FakeServer(b"") as server:
            server.status_override = 401
            self.configure(server)

            with self.assertRaises(box.BoxError):
                self.reseed("-y", running=True)

        self.assertEqual(titles(self.db), ["old branch data"])
        self.mocks[4].assert_not_called()

    def test_unconfigured_it_says_what_to_run(self) -> None:
        with self.assertRaises(box.BoxError) as caught:
            self.reseed("-y")

        self.assertIn("seed set", str(caught.exception))


class EnvFileTests(IsolatedEnv):
    KEYS = ("BOXENV_A", "BOXENV_B", "BOXENV_C")

    def setUp(self) -> None:
        super().setUp()
        for key in self.KEYS:
            os.environ.pop(key, None)
        self.path = box.env_file()
        self.path.parent.mkdir(parents=True)

    def test_path_is_beside_the_devices_file(self) -> None:
        self.assertEqual(self.path.parent, box.config_file().parent)
        self.assertEqual(self.path.name, "box.env")

    def test_missing_file_does_nothing(self) -> None:
        box.load_env_file()
        self.assertNotIn("BOXENV_A", os.environ)

    def test_comments_and_blank_lines(self) -> None:
        self.path.write_text("# note\n\n  \nBOXENV_A=1\n  # more\n", encoding="utf-8")
        box.load_env_file()
        self.assertEqual(os.environ["BOXENV_A"], "1")

    def test_export_and_quotes(self) -> None:
        self.path.write_text(
            "export BOXENV_A='one two'\nBOXENV_B=\"x=y\"\nBOXENV_C = plain\n",
            encoding="utf-8",
        )
        box.load_env_file()
        self.assertEqual(os.environ["BOXENV_A"], "one two")
        self.assertEqual(os.environ["BOXENV_B"], "x=y")
        self.assertEqual(os.environ["BOXENV_C"], "plain")

    def test_home_and_tilde_expand(self) -> None:
        self.path.write_text(
            "BOXENV_A=$HOME/a\nBOXENV_B=${HOME}/b\nBOXENV_C=~/c\n", encoding="utf-8"
        )
        box.load_env_file()
        home = os.environ["HOME"]
        self.assertEqual(os.environ["BOXENV_A"], f"{home}/a")
        self.assertEqual(os.environ["BOXENV_B"], f"{home}/b")
        self.assertEqual(os.environ["BOXENV_C"], f"{home}/c")

    def test_real_environment_wins(self) -> None:
        os.environ["BOXENV_A"] = "real"
        self.path.write_text("BOXENV_A=file\nBOXENV_B=file\n", encoding="utf-8")
        box.load_env_file()
        self.assertEqual(os.environ["BOXENV_A"], "real")
        self.assertEqual(os.environ["BOXENV_B"], "file")

    def test_malformed_line_names_the_line_not_the_value(self) -> None:
        self.path.write_text("BOXENV_A=1\nsecret-token-value\n", encoding="utf-8")
        with self.assertRaises(box.BoxError) as ctx:
            box.load_env_file()
        self.assertIn("line 2", str(ctx.exception))
        self.assertNotIn("secret-token-value", str(ctx.exception))

    def test_unterminated_quote_hides_the_value(self) -> None:
        self.path.write_text('BOXENV_A="hunter2\n', encoding="utf-8")
        with self.assertRaises(box.BoxError) as ctx:
            box.load_env_file()
        self.assertIn("line 1", str(ctx.exception))
        self.assertNotIn("hunter2", str(ctx.exception))

    def test_main_loads_it_before_dispatch(self) -> None:
        self.path.write_text("BOXENV_A=from-file\n", encoding="utf-8")
        seen: list[str | None] = []
        fake = mock.Mock(fn=lambda _a: seen.append(os.environ.get("BOXENV_A")))
        with mock.patch.object(box, "parse_args", return_value=fake):
            self.assertEqual(box.main(["list"]), 0)
        self.assertEqual(seen, ["from-file"])


if __name__ == "__main__":
    unittest.main()


@unittest.skipUnless(shutil.which("keytool"), "needs a JDK's keytool")
class KeystoreRotateRealKeytool(unittest.TestCase):
    """The rotation against the real keytool, on a throwaway PKCS12 store (the JDK default)."""

    def run_keytool(self, *args: str, **env: str) -> subprocess.CompletedProcess[str]:
        return subprocess.run(
            ["keytool", *args],
            env={**os.environ, **env},
            capture_output=True,
            text=True,
            check=False,
        )

    def test_a_pkcs12_store_opens_with_the_new_value_only(self) -> None:
        old, new = secrets.token_urlsafe(18), secrets.token_urlsafe(18)
        with tempfile.TemporaryDirectory() as tmp:
            ks = Path(tmp) / "box.keystore"
            made = self.run_keytool(
                "-genkeypair", "-keystore", str(ks), "-alias", box.BOX_KEY_ALIAS,
                "-keyalg", "RSA", "-keysize", "2048", "-validity", "2", "-dname", "CN=box-test",
                "-storepass:env", "A", "-keypass:env", "A",
                A=old,
            )  # fmt: skip
            self.assertEqual(made.returncode, 0, made.stderr)
            box.rotate_keystore_password(ks, old, new)
            opened = self.run_keytool(
                "-certreq", "-keystore", str(ks), "-alias", box.BOX_KEY_ALIAS,
                "-storepass:env", "A", "-keypass:env", "A",
                A=new,
            )  # fmt: skip
            self.assertEqual(opened.returncode, 0, opened.stderr)
            refused = self.run_keytool(
                "-list", "-keystore", str(ks), "-storepass:env", "A", A=old
            )
            self.assertNotEqual(refused.returncode, 0)
