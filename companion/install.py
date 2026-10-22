"""Install/remove the macOS development host for an explicitly selected extension."""

import argparse
import json
import os
import re
import shlex
import shutil
import sys
from pathlib import Path

from flux_companion.platforms import current_platform

HOST_NAME = "com.flux.media_companion"


def install(extension_id, host_dir, manifest_dir, data_dir=None):
    if not re.fullmatch(r"[a-p]{32}", extension_id):
        raise ValueError("Copy the 32-letter extension ID from chrome://extensions.")
    manifest = manifest_dir / (HOST_NAME + ".json")
    # Never overwrite another installation or user-managed native manifest.
    if manifest.exists() or host_dir.exists():
        raise ValueError("Installation already exists. Uninstall it before installing again.")
    data_dir = data_dir or current_platform().data_location(Path.home())
    data_dir = data_dir.absolute()
    host_dir.mkdir(parents=True, mode=0o700)
    manifest_created = False
    try:
        source = Path(__file__).parent
        package = source / "flux_companion"
        runtime_files = [Path("host.py"), Path("configure.py"),
                         *(file.relative_to(source) for file in sorted(package.rglob("*.py")))]
        for relative in runtime_files:
            target = host_dir / relative
            target.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
            shutil.copyfile(source / relative, target)
            target.chmod(0o600)
        (host_dir / "files.json").write_text(json.dumps([str(path) for path in runtime_files]))
        config = {"name": HOST_NAME, "description": "Flux media companion development host",
                  "path": str(host_dir / "launch"), "type": "stdio",
                  "allowed_origins": [f"chrome-extension://{extension_id}/"]}
        (host_dir / "manifest.json").write_text(json.dumps(config, indent=2) + "\n")
        launcher = "#!/bin/sh\nexec " + " ".join(shlex.quote(str(p)) for p in [
            Path(sys.executable).absolute(), "-I", "-u", "-B", host_dir / "host.py", "--config",
            host_dir / "manifest.json", "--data-dir", data_dir]) + ' "$@"\n'
        (host_dir / "launch").write_text(launcher)
        for child in host_dir.iterdir():
            child.chmod(0o700 if child.name == "launch" or child.is_dir() else 0o600)
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
    receipt_file = host_dir / "files.json"
    receipt = json.loads(receipt_file.read_text()) if receipt_file.exists() else ["host.py"]
    if not isinstance(receipt, list) or not receipt or any(
        not isinstance(name, str) or Path(name).is_absolute() or ".." in Path(name).parts
        or (name not in {"host.py", "configure.py"}
            and not (name.startswith("flux_companion/") and name.endswith(".py")))
        for name in receipt
    ):
        raise ValueError("Invalid installation receipt; nothing was removed.")
    # Refuse symlink escapes before deleting any registration or installed file.
    for name in receipt:
        if not (host_dir / name).resolve().is_relative_to(host_dir.resolve()):
            raise ValueError("Installation path escaped its root; nothing was removed.")
    manifest.unlink()
    for name in [*receipt, "launch", "manifest.json", "files.json"]:
        (host_dir / name).unlink(missing_ok=True)
    directories = {parent for name in receipt for parent in (host_dir / name).parents
                   if parent.is_relative_to(host_dir) and parent != host_dir}
    for directory in sorted(directories, key=lambda path: len(path.parts), reverse=True):
        if directory.is_dir() and not any(directory.iterdir()):
            directory.rmdir()
    if not any(host_dir.iterdir()):
        host_dir.rmdir()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=["install", "uninstall"])
    parser.add_argument("--extension-id")
    parser.add_argument("--host-dir", type=Path)
    parser.add_argument("--manifest-dir", type=Path)
    parser.add_argument("--data-dir", type=Path, help="Local destination data directory; install only")
    args = parser.parse_args()
    try:
        locations = current_platform().install_locations(Path.home())
    except ValueError as exc:
        parser.error(str(exc))
    os.umask(0o077)
    try:
        host_dir = (args.host_dir or locations.host).resolve()
        manifest_dir = (args.manifest_dir or locations.manifests).resolve()
        if args.action == "install":
            install(args.extension_id or "", host_dir, manifest_dir, args.data_dir)
        else:
            uninstall(host_dir, manifest_dir)
    except (OSError, ValueError) as exc:
        parser.exit(1, str(exc) + "\n")
    print("Flux companion " + args.action + " complete.")


if __name__ == "__main__":
    main()
