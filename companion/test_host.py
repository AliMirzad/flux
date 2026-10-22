import io
import json
import os
import struct
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import host
import install
from flux_companion.platforms import MacOSPlatform

EXTENSION = "a" * 32
ORIGIN = f"chrome-extension://{EXTENSION}/"


def frame(value):
    stream = io.BytesIO()
    host.write_message(stream, value)
    return stream.getvalue()


def request(method="hello", **kwargs):
    return {"protocol": 1, "kind": "request", "id": "test-id", "method": method,
            "params": {"extensionVersion": "0.7.0"}, **kwargs}


class ShortReads(io.BytesIO):
    def read(self, size=-1):
        return super().read(min(size, 2))


class HostTests(unittest.TestCase):
    def test_partial_reads_utf8_and_eof(self):
        value = {"title": "آزمایش"}
        stream = ShortReads(frame(value))
        self.assertEqual(host.read_message(stream), value)
        self.assertIsNone(host.read_message(stream))

    def test_invalid_frames(self):
        invalid = [b"\x01", struct.pack("=I", 0), struct.pack("=I", host.MAX_FRAME + 1),
                   struct.pack("=I", 10), struct.pack("=I", 2) + b"{", struct.pack("=I", 1) + b"\xff",
                   struct.pack("=I", 3) + b"bad", struct.pack("=I", 3) + b"NaN"]
        for raw in invalid:
            with self.subTest(raw=raw), self.assertRaises(host.ProtocolError):
                host.read_message(io.BytesIO(raw))

    def test_negotiation_and_capability_gating(self):
        session = host.Session()
        self.assertEqual(session.dispatch(request("diagnostics"))["error"]["code"], "INVALID_REQUEST")
        self.assertEqual(session.dispatch(request(protocol=2))["error"]["code"], "INCOMPATIBLE_PROTOCOL")
        self.assertFalse(session.negotiated)
        with patch.object(host, "diagnostics", return_value={"capabilities": ["diagnostics"]}):
            self.assertIn("result", session.dispatch(request()))
            self.assertIn("result", session.dispatch(request("diagnostics")))
        for method in ["jobs.create", "exec"]:
            self.assertEqual(session.dispatch(request(method))["error"]["code"], "UNSUPPORTED_CAPABILITY")

    def test_invalid_envelopes(self):
        for value in [None, [], {}, request(id=""), request(id="x" * 129), request(kind="event")]:
            with self.subTest(value=value), self.assertRaises(host.ProtocolError):
                host.Session().dispatch(value)
        self.assertEqual(host.Session().dispatch(request(protocol=True))["error"]["code"], "INCOMPATIBLE_PROTOCOL")
        self.assertEqual(host.Session().dispatch(request(params=[]))["error"]["code"], "INVALID_REQUEST")

    def test_missing_and_broken_dependencies(self):
        with patch("flux_companion.platforms.shutil.which", return_value=None):
            self.assertEqual(MacOSPlatform().probe_tool("ffmpeg"), {"available": False, "status": "missing"})
        with patch("flux_companion.platforms.shutil.which", return_value="/missing/ffmpeg"):
            self.assertEqual(MacOSPlatform().probe_tool("ffmpeg")["status"], "probe-failed")

    def test_installed_process_authorization_handshake_and_cleanup(self):
        with tempfile.TemporaryDirectory(prefix="flux companion ") as root:
            home = Path(root)
            host_dir, manifests = home / "host's folder", home / "manifests"
            install.install(EXTENSION, host_dir, manifests)
            manifest = manifests / (host.HOST_NAME + ".json")
            self.assertEqual(json.loads(manifest.read_text())["allowed_origins"], [ORIGIN])
            self.assertEqual(os.stat(host_dir / "launch").st_mode & 0o777, 0o700)
            denied = subprocess.run([str(host_dir / "launch"), "chrome-extension://" + "b" * 32 + "/"],
                                    input=frame(request()), capture_output=True, timeout=10)
            self.assertNotEqual(denied.returncode, 0)
            self.assertEqual(denied.stdout, b"")
            good = subprocess.run([str(host_dir / "launch"), ORIGIN],
                                  input=frame(request()) + frame(request("jobs.create")),
                                  capture_output=True, timeout=15)
            self.assertEqual(good.returncode, 0, good.stderr)
            stream = io.BytesIO(good.stdout)
            result = host.read_message(stream)["result"]
            self.assertEqual(result["capabilities"], ["diagnostics", "inspect", "inspect.cancel"])
            self.assertEqual(set(result["dependencies"]), {"ytDlp", "ffmpeg", "ffprobe"})
            self.assertEqual(host.read_message(stream)["error"]["code"], "UNSUPPORTED_CAPABILITY")
            self.assertIsNone(host.read_message(stream))
            with self.assertRaises(ValueError):
                install.install(EXTENSION, host_dir, manifests)
            (host_dir / "keep.txt").write_text("user data")
            install.uninstall(host_dir, manifests)
            self.assertFalse(manifest.exists())
            self.assertEqual((host_dir / "keep.txt").read_text(), "user data")

    def test_origin_and_installer_validation(self):
        with tempfile.TemporaryDirectory() as root:
            home = Path(root)
            with self.assertRaises(ValueError):
                install.install("invalid", home / "host", home / "manifests")
            install.install(EXTENSION, home / "host", home / "manifests")
            config = home / "host/manifest.json"
            self.assertTrue(host.authorized(config, ORIGIN))
            self.assertFalse(host.authorized(config, ORIGIN + "../"))
            self.assertFalse(host.authorized(config, "https://example.com/"))
            manifest = home / "manifests" / (host.HOST_NAME + ".json")
            manifest.write_text('{}')
            with self.assertRaises(ValueError):
                install.uninstall(home / "host", home / "manifests")
            self.assertTrue(config.exists())

    def test_failed_registration_rolls_back_owned_files(self):
        with tempfile.TemporaryDirectory() as root:
            home = Path(root)
            with patch.object(install.json, "dump", side_effect=OSError("disk full")):
                with self.assertRaises(OSError):
                    install.install(EXTENSION, home / "host", home / "manifests")
            self.assertFalse((home / "host").exists())
            self.assertFalse((home / "manifests" / (host.HOST_NAME + ".json")).exists())


if __name__ == "__main__":
    unittest.main()
