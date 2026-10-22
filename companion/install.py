"""Install/remove the macOS development host for an explicitly selected extension."""

import argparse
import json
import os
import platform
import re
import shlex
import shutil
import sys
from pathlib import Path

HOST_NAME = "com.flux.media_companion"


def install(extension_id, host_dir, manifest_dir):
    if not re.fullmatch(r"[a-p]{32}", extension_id):
        raise ValueError("Copy the 32-letter extension ID from chrome://extensions.")
    manifest = manifest_dir / (HOST_NAME + ".json")
    # Never overwrite another installation or user-managed native manifest.
    if manifest.exists() or host_dir.exists():
        raise ValueError("Installation already exists. Uninstall it before installing again.")
    host_dir.mkdir(parents=True, mode=0o700)
    manifest_created = False
    try:
        shutil.copyfile(Path(__file__).with_name("host.py"), host_dir / "host.py")
        config = {"name": HOST_NAME, "description": "Flux media companion development host",
                  "path": str(host_dir / "launch"), "type": "stdio",
                  "allowed_origins": [f"chrome-extension://{extension_id}/"]}
        (host_dir / "manifest.json").write_text(json.dumps(config, indent=2) + "\n")
        launcher = "#!/bin/sh\nexec " + " ".join(shlex.quote(str(p)) for p in [
            Path(sys.executable).resolve(), "-I", "-u", host_dir / "host.py", "--config",
            host_dir / "manifest.json"]) + ' "$@"\n'
        (host_dir / "launch").write_text(launcher)
        for child in host_dir.iterdir():
            child.chmod(0o700 if child.name == "launch" else 0o600)
        manifest_dir.mkdir(parents=True, exist_ok=True)
        with manifest.open("x") as stream:
            manifest_created = True
            json.dump(config, stream, indent=2)
            stream.write("\n")
        manifest.chmod(0o600)
    except Exception:
        if manifest_created:
            manifest.unlink(missing_ok=True)
        shutil.rmtree(host_dir)
        raise


def uninstall(host_dir, manifest_dir):
    manifest = manifest_dir / (HOST_NAME + ".json")
    if not manifest.exists():
        raise ValueError("No registration found; nothing was removed.")
    registered = json.loads(manifest.read_text())
    local = host_dir / "manifest.json"
    if (not local.is_file() or json.loads(local.read_text()) != registered
            or registered.get("path") != str(host_dir / "launch")
            or registered.get("name") != HOST_NAME):
        raise ValueError("Registration does not match this installation; nothing was removed.")
    manifest.unlink()
    # Remove only installer-owned files, preserving unrelated data.
    for name in ["launch", "host.py", "manifest.json"]:
        (host_dir / name).unlink(missing_ok=True)
    if not any(host_dir.iterdir()):
        host_dir.rmdir()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=["install", "uninstall"])
    parser.add_argument("--extension-id")
    parser.add_argument("--host-dir", type=Path, default=Path.home() / "Library/Application Support/Flux/Media Companion")
    parser.add_argument("--manifest-dir", type=Path, default=Path.home() / "Library/Application Support/Google/Chrome/NativeMessagingHosts")
    args = parser.parse_args()
    if platform.system() != "Darwin":
        parser.error("This development installer supports macOS only.")
    os.umask(0o077)
    try:
        host_dir, manifest_dir = args.host_dir.resolve(), args.manifest_dir.resolve()
        if args.action == "install":
            install(args.extension_id or "", host_dir, manifest_dir)
        else:
            uninstall(host_dir, manifest_dir)
    except (OSError, ValueError) as exc:
        parser.exit(1, str(exc) + "\n")
    print("Flux companion " + args.action + " complete.")


if __name__ == "__main__":
    main()
