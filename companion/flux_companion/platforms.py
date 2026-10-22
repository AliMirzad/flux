"""OS services used by the shared host; native installation remains separate."""

import platform
import os
import queue
import re
import shutil
import subprocess
import signal
import sys
import threading
from dataclasses import dataclass
from pathlib import Path
from typing import Protocol, Sequence

TOOLS = {"yt-dlp": "--version", "ffmpeg": "-version", "ffprobe": "-version"}


class UnsupportedPlatform(ValueError):
    pass


class ProbeRunner(Protocol):
    def version_output(self, executable: Path, arguments: Sequence[str]) -> bytes:
        """Return at most 512 bytes, or raise on failure/timeout."""
        ...


class BoundedProbeRunner:
    def version_output(self, executable: Path, arguments: Sequence[str]) -> bytes:
        # A reader thread works with subprocess pipes on Windows as well as Unix.
        # Version probes are bounded; media process-tree supervision is separate.
        output = queue.Queue(maxsize=1)
        with subprocess.Popen([str(executable), *arguments], stdin=subprocess.DEVNULL,
                              stdout=subprocess.PIPE, stderr=subprocess.DEVNULL) as child:
            def read():
                try:
                    output.put(child.stdout.read(512))
                except OSError:
                    output.put(b"")

            reader = threading.Thread(target=read, daemon=True)
            reader.start()
            try:
                data = output.get(timeout=2)
            except queue.Empty as exc:
                raise TimeoutError("Version probe timed out") from exc
            finally:
                if child.poll() is None:
                    child.kill()
                child.wait(timeout=2)
                reader.join(timeout=1)
        return data


@dataclass(frozen=True)
class InstallLocations:
    host: Path
    manifests: Path


class PlatformAdapter(Protocol):
    @property
    def name(self) -> str: ...

    def find_tool(self, name: str) -> Path | None: ...

    def probe_tool(self, name: str) -> dict: ...

    def install_locations(self, home: Path) -> InstallLocations: ...

    def start_inspection_worker(self) -> subprocess.Popen: ...

    def stop_inspection_worker(self, child: subprocess.Popen) -> None: ...


class MacOSPlatform:
    name = "darwin"

    def __init__(self, runner: ProbeRunner | None = None):
        self.runner = runner or BoundedProbeRunner()

    def find_tool(self, name: str) -> Path | None:
        if name not in TOOLS:
            raise ValueError("Unknown companion tool")
        # Chrome does not inherit an interactive shell's PATH.
        executable = shutil.which(name, path="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin")
        return Path(executable) if executable else None

    def probe_tool(self, name: str) -> dict:
        executable = self.find_tool(name)
        if executable is None:
            return {"available": False, "status": "missing"}
        try:
            output = self.runner.version_output(executable, [TOOLS[name]])
            first_line = output.decode("utf-8", errors="replace").splitlines()[0]
            match = re.search(r"(?<!\w)(?:n)?\d[\w.+-]{0,63}", first_line)
            if match:
                return {"available": True, "version": match.group(0), "status": "available"}
        except (OSError, subprocess.SubprocessError, TimeoutError, IndexError):
            pass
        return {"available": False, "status": "probe-failed"}

    def install_locations(self, home: Path) -> InstallLocations:
        return InstallLocations(home / "Library/Application Support/Flux/Media Companion",
                                home / "Library/Application Support/Google/Chrome/NativeMessagingHosts")

    def start_inspection_worker(self):
        return subprocess.Popen(
            [sys.executable, "-I", "-u", "-B", str(Path(__file__).with_name("worker.py"))],
            stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
            start_new_session=True, env={"PATH": "/usr/bin:/bin", "LANG": "en_US.UTF-8"})

    def stop_inspection_worker(self, child):
        if child.poll() is not None:
            return
        try:
            os.killpg(child.pid, signal.SIGKILL)
        except ProcessLookupError:
            pass
        except PermissionError:
            # Some development sandboxes permit signaling only the direct
            # child. Inspection policy forbids that worker from spawning children.
            child.kill()
        child.wait(timeout=2)


def current_platform(system: str | None = None) -> PlatformAdapter:
    system = system or platform.system()
    if system == "Darwin":
        return MacOSPlatform()
    raise UnsupportedPlatform("This companion currently supports macOS only.")
