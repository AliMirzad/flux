"""Approve, list or revoke save folders locally; never accepts native messages."""

import argparse
import json
import os
import sys
from pathlib import Path

# The installed command also supports the host's isolated Python invocation.
sys.path.insert(0, str(Path(__file__).resolve().parent))
from flux_companion.destinations import DestinationError, DestinationRegistry
from flux_companion.platforms import current_platform


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--data-dir", type=Path, help="Isolated development/test data directory")
    commands = parser.add_subparsers(dest="action", required=True)
    approve = commands.add_parser("approve")
    approve.add_argument("folder", type=Path)
    approve.add_argument("--label", required=True)
    commands.add_parser("list")
    revoke = commands.add_parser("revoke")
    revoke.add_argument("id")
    args = parser.parse_args()
    os.umask(0o077)
    try:
        adapter = current_platform()
        directory = args.data_dir or adapter.data_location(Path.home())
        # Preserve the last path component so the registry can refuse a symlink.
        registry = DestinationRegistry(directory.absolute(), adapter)
        if args.action == "approve":
            result = registry.approve(args.folder, args.label)
        elif args.action == "list":
            result = registry.list()
        else:
            registry.revoke(args.id)
            result = {"revoked": True}
    except (DestinationError, OSError, ValueError) as exc:
        parser.exit(1, str(exc) + "\n")
    print(json.dumps(result, ensure_ascii=False))


if __name__ == "__main__":
    main()
