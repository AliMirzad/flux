"""Explicit macOS installer acceptance; downloads dependencies into a disposable HOME."""

import io
import json
import os
import struct
import subprocess
import sys
import tempfile
import zipfile
from pathlib import Path


def main():
    if sys.platform != "darwin":
        raise SystemExit("This acceptance check requires macOS.")
    archive = Path("dist/companion/flux-media-companion-macos.zip").resolve()
    with tempfile.TemporaryDirectory(prefix="flux installer's test ") as temporary:
        root = Path(temporary)
        home = root / "home"
        home.mkdir()
        with zipfile.ZipFile(archive) as package:
            assert package.testzip() is None
            assert all(not Path(name).is_absolute() and ".." not in Path(name).parts for name in package.namelist())
            package.extractall(root / "unpacked")
            for entry in package.infolist():
                if entry.filename.endswith(".command"):
                    assert entry.external_attr >> 16 & 0o111
                    (root / "unpacked" / entry.filename).chmod(0o700)
        bundle = root / "unpacked/Flux Media Companion"
        environment = {"HOME": str(home), "PATH": "/usr/bin:/bin:/usr/sbin:/sbin",
                       "LANG": "en_US.UTF-8", "TMPDIR": str(root)}
        command = bundle / "Install.command"
        bad = subprocess.run([str(command)], input="invalid\n\n", text=True, capture_output=True,
                             env=environment, timeout=5)
        assert bad.returncode != 0
        assert not (home / "Library").exists()
        print("PASS: packaged executable installer rejects an invalid extension ID before installing.", flush=True)
        answers = "a" * 32 + "\n" + sys.executable + "\ny\n\n"
        installed = subprocess.run([str(command)], input=answers, text=True, capture_output=True,
                                   env=environment, timeout=120)
        if installed.returncode:
            raise RuntimeError(installed.stdout + installed.stderr)
        host = home / "Library/Application Support/Flux/Media Companion"
        runtime = home / "Library/Application Support/Flux/Media Runtime/bin/python"
        assert runtime.is_file()
        manifest = home / "Library/Application Support/Google/Chrome/NativeMessagingHosts/com.flux.media_companion.json"
        assert json.loads(manifest.read_text())["allowed_origins"] == ["chrome-extension://" + "a" * 32 + "/"]
        request = json.dumps({"protocol": 1, "kind": "request", "id": "hello", "method": "hello",
                              "params": {"extensionVersion": "0.7.0"}}).encode()
        connected = subprocess.run([str(host / "launch"), "chrome-extension://" + "a" * 32 + "/"],
                                   input=struct.pack("=I", len(request)) + request, capture_output=True,
                                   env=environment, timeout=15, check=True)
        stream = io.BytesIO(connected.stdout)
        size, = struct.unpack("=I", stream.read(4))
        assert "inspect" in json.loads(stream.read(size))["result"]["capabilities"]
        # Check the package in the newly created runtime, rather than the CLI found on PATH.
        subprocess.run([str(runtime), "-I", "-c",
                        "import yt_dlp.version; assert yt_dlp.version.__version__ == '2026.03.17'"],
                       env=environment, timeout=5, check=True)
        folder = home / "Test media"
        folder.mkdir()
        approved = subprocess.run([str(host / "configure"), "approve", str(folder), "--label", "Test videos"],
                                  env=environment, capture_output=True, timeout=5, check=True)
        assert json.loads(approved.stdout)["label"] == "Test videos"
        subprocess.run([str(bundle / "Uninstall.command")], input="y\n\n", text=True,
                       env=environment, capture_output=True, timeout=5, check=True)
        assert not manifest.exists()
        assert not host.exists()
        assert folder.exists()
        assert (home / "Library/Application Support/Flux/Media Companion Data/destinations.sqlite3").exists()
        print("PASS: downloaded bundle creates its runtime, installs pinned yt-dlp, connects, approves folders and uninstalls.")
        print("Temporary HOME removed; the normal Chrome registration was not changed.")


if __name__ == "__main__":
    main()
