import concurrent.futures
import io
import json
import os
import sqlite3
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import host
import install
from flux_companion.destinations import (DestinationError, DestinationRegistry,
                                          DestinationStoreError, DestinationUnavailable)
from flux_companion.platforms import MacOSPlatform
from test_host import ORIGIN, frame, request


class DestinationTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="flux folders ")
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.folder = self.root / "Media's folder آزمایش"
        self.folder.mkdir()
        self.data = self.root / "private data"
        self.registry = DestinationRegistry(self.data, MacOSPlatform())

    def test_empty_listing_has_no_filesystem_side_effect(self):
        self.assertEqual(self.registry.list(), [])
        self.assertFalse(self.data.exists())
        with self.assertRaises(DestinationError):
            self.registry.resolve(str(self.folder))
        self.assertFalse(self.data.exists())

    def test_approval_survives_restart_and_projects_only_opaque_handles(self):
        approved = self.registry.approve(self.folder, "Videos آزمایش")
        reloaded = DestinationRegistry(self.data, MacOSPlatform())
        self.assertEqual(reloaded.list(), [approved])
        self.assertEqual(reloaded.resolve(approved["id"]), self.folder.resolve())
        self.assertEqual(set(approved), {"id", "label"})
        self.assertNotIn(str(self.root), json.dumps(reloaded.list()))
        self.assertEqual(self.data.stat().st_mode & 0o777, 0o700)
        self.assertEqual(self.registry.database.stat().st_mode & 0o777, 0o600)

    def test_canonical_approval_reuses_handle_and_can_rename_label(self):
        alias = self.root / "alias"
        alias.symlink_to(self.folder, target_is_directory=True)
        approved = self.registry.approve(alias, "Original")
        renamed = self.registry.approve(self.folder, "Renamed")
        self.assertEqual(approved["id"], renamed["id"])
        self.assertEqual(self.registry.list(), [renamed])
        alias.unlink()
        alias.symlink_to(self.root)
        self.assertEqual(self.registry.resolve(approved["id"]), self.folder.resolve())

    def test_folder_replacement_requires_new_approval(self):
        approved = self.registry.approve(self.folder, "Videos")
        moved = self.root / "old folder"
        self.folder.rename(moved)
        self.folder.mkdir()
        self.assertEqual(self.registry.list(), [])
        with self.assertRaises(DestinationUnavailable):
            self.registry.resolve(approved["id"])
        replacement = self.registry.approve(self.folder, "Replacement")
        self.assertNotEqual(replacement["id"], approved["id"])
        self.assertEqual(self.registry.list(), [replacement])

    def test_folder_replaced_by_symlink_is_unavailable(self):
        approved = self.registry.approve(self.folder, "Videos")
        moved = self.root / "moved"
        self.folder.rename(moved)
        self.folder.symlink_to(moved, target_is_directory=True)
        with self.assertRaises(DestinationUnavailable):
            self.registry.resolve(approved["id"])

    def test_creation_time_change_rejects_reused_filesystem_identity(self):
        approved = self.registry.approve(self.folder, "Videos")
        path, device, inode, _ = self.registry.platform.folder_identity(self.folder)
        with patch.object(self.registry.platform, "folder_identity", return_value=(path, device, inode, "different")):
            self.assertEqual(self.registry.list(), [])
            with self.assertRaises(DestinationUnavailable):
                self.registry.resolve(approved["id"])

    def test_revoke_is_idempotent_and_preserves_user_media(self):
        approved = self.registry.approve(self.folder, "Videos")
        media = self.folder / "existing.mp4"
        media.write_bytes(b"user content")
        self.registry.revoke(approved["id"])
        self.registry.revoke(approved["id"])
        self.assertEqual(self.registry.list(), [])
        self.assertEqual(media.read_bytes(), b"user content")
        with self.assertRaises(DestinationUnavailable):
            self.registry.resolve(approved["id"])

    def test_invalid_approval_never_creates_data_or_target(self):
        for label in ["", "x" * 129, " bad", "bad ", "bad\nlabel", "bad\x00label"]:
            with self.subTest(label=label), self.assertRaises(DestinationError):
                self.registry.approve(self.folder, label)
        file = self.root / "file"
        file.write_text("retain")
        for path in [file, self.root / "missing"]:
            with self.subTest(path=path), self.assertRaises(DestinationUnavailable):
                self.registry.approve(path, "Videos")
        self.assertFalse(self.data.exists())

    def test_concurrent_local_approvals_share_one_handle(self):
        def approve(_):
            return DestinationRegistry(self.data, MacOSPlatform()).approve(self.folder, "Videos")
        with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
            results = list(pool.map(approve, range(8)))
        self.assertEqual(len({result["id"] for result in results}), 1)
        self.assertEqual(self.registry.list(), [results[0]])

    def test_limit_is_transactional_and_renaming_does_not_use_another_slot(self):
        for index in range(50):
            folder = self.root / str(index)
            folder.mkdir()
            self.registry.approve(folder, str(index))
        with self.assertRaises(DestinationError):
            self.registry.approve(self.folder, "Overflow")
        self.registry.approve(self.root / "0", "Renamed")
        self.assertEqual(len(self.registry.list()), 50)

    def test_unsafe_data_directory_and_database_links_fail_closed(self):
        self.data.symlink_to(self.folder, target_is_directory=True)
        with self.assertRaises(DestinationStoreError):
            self.registry.list()
        self.data.unlink()
        self.data.mkdir(mode=0o755)
        with self.assertRaises(DestinationStoreError):
            self.registry.approve(self.folder, "Videos")
        self.data.chmod(0o700)
        target = self.root / "keep"
        target.write_bytes(b"keep")
        self.registry.database.symlink_to(target)
        with self.assertRaises(DestinationStoreError):
            self.registry.approve(self.folder, "Videos")
        self.assertEqual(target.read_bytes(), b"keep")
        self.registry.database.unlink()
        os.link(target, self.registry.database)
        with self.assertRaises(DestinationStoreError):
            self.registry.list()

    def test_corrupt_or_future_data_has_no_path_leak_in_native_error(self):
        self.registry.approve(self.folder, "Videos")
        connection = sqlite3.connect(self.registry.database)
        try:
            connection.execute("PRAGMA user_version=99")
            connection.commit()
        finally:
            connection.close()
        session = host.Session(destinations=self.registry)
        with patch.object(host, "diagnostics", return_value={"capabilities": ["diagnostics"]}):
            session.dispatch(request())
        result = session.dispatch(request("destinations.list", params={}))
        self.assertEqual(result["error"]["code"], "DESTINATION_UNAVAILABLE")
        self.assertNotIn(str(self.root), json.dumps(result))

    def test_database_sidecar_links_and_public_permissions_are_rejected(self):
        self.registry.approve(self.folder, "Videos")
        self.registry.database.chmod(0o644)
        with self.assertRaises(DestinationStoreError):
            self.registry.list()
        self.registry.database.chmod(0o600)
        target = self.root / "keep"
        target.write_text("retain")
        for suffix in ("-journal", "-wal", "-shm"):
            sibling = Path(str(self.registry.database) + suffix)
            sibling.symlink_to(target)
            with self.subTest(suffix=suffix), self.assertRaises(DestinationStoreError):
                self.registry.list()
            sibling.unlink()
        self.assertEqual(target.read_text(), "retain")

    def test_corrupt_database_and_saved_metadata_are_rejected(self):
        self.registry.approve(self.folder, "Videos")
        connection = sqlite3.connect(self.registry.database)
        try:
            connection.execute("UPDATE destinations SET path='relative/escape'")
            connection.commit()
        finally:
            connection.close()
        with self.assertRaises(DestinationStoreError):
            self.registry.list()
        self.registry.database.write_bytes(b"not a database")
        with self.assertRaises(DestinationStoreError):
            self.registry.list()

    def test_native_messages_cannot_approve_revoke_or_pass_paths(self):
        self.registry.approve(self.folder, "Videos")
        session = host.Session(destinations=self.registry)
        self.assertEqual(session.dispatch(request("destinations.list", params={}))
                         ["error"]["code"], "INVALID_REQUEST")
        with patch.object(host, "diagnostics", return_value={"capabilities": ["diagnostics"]}):
            self.assertIn("destinations.list", session.dispatch(request())["result"]["capabilities"])
        for method in ["destinations.approve", "destinations.revoke"]:
            self.assertEqual(session.dispatch(request(method, params={"path": str(self.folder)}))
                             ["error"]["code"], "UNSUPPORTED_CAPABILITY")
        self.assertEqual(session.dispatch(request("destinations.list", params={"path": str(self.folder)}))
                         ["error"]["code"], "INVALID_REQUEST")
        result = session.dispatch(request("destinations.list", params={}))
        self.assertEqual(result["result"], self.registry.list())

    def test_installed_local_command_and_framed_host_share_approvals(self):
        installed, manifests = self.root / "host", self.root / "manifests"
        install.install("a" * 32, installed, manifests, self.data)
        command = [sys.executable, "-I", "-B", str(installed / "configure.py"),
                   "--data-dir", str(self.data)]
        approved = subprocess.run([*command, "approve", str(self.folder), "--label", "Videos"],
                                  capture_output=True, timeout=5, check=True)
        handle = json.loads(approved.stdout)
        process = subprocess.run([str(installed / "launch"), ORIGIN],
                                 input=frame(request()) + frame(request("destinations.list", params={})),
                                 capture_output=True, timeout=15, check=True)
        stream = io.BytesIO(process.stdout)
        self.assertIn("destinations.list", host.read_message(stream)["result"]["capabilities"])
        self.assertEqual(host.read_message(stream)["result"], [handle])
        self.assertEqual(MacOSPlatform().data_location(self.root),
                         self.root / "Library/Application Support/Flux/Media Companion Data")
        install.uninstall(installed, manifests)
        self.assertTrue(self.registry.database.exists())
        self.assertTrue(self.folder.is_dir())
        self.assertFalse((installed / "configure.py").exists())


if __name__ == "__main__":
    unittest.main()
