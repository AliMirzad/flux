"""Bounded native messaging diagnostics host. No download commands are enabled."""

import argparse
import json
import platform
import re
import shutil
import struct
import subprocess
import sys
from pathlib import Path

HOST_NAME = "com.flux.media_companion"
VERSION = "0.1.0"
MAX_FRAME = 256 * 1024
ORIGIN = re.compile(r"chrome-extension://[a-p]{32}/\Z")


class ProtocolError(Exception):
    pass


def read_exact(stream, size):
    chunks = bytearray()
    while len(chunks) < size:
        chunk = stream.read(size - len(chunks))
        if not chunk:
            if not chunks:
                return None
            raise ProtocolError("Truncated frame")
        chunks.extend(chunk)
    return bytes(chunks)


def read_message(stream):
    header = read_exact(stream, 4)
    if header is None:
        return None
    size = struct.unpack("=I", header)[0]
    if not 0 < size <= MAX_FRAME:
        raise ProtocolError("Invalid frame length")
    payload = read_exact(stream, size)
    if payload is None:
        raise ProtocolError("Missing frame payload")
    try:
        return json.loads(payload.decode("utf-8"), parse_constant=reject_constant)
    except (ValueError, UnicodeError, RecursionError) as exc:
        raise ProtocolError("Invalid JSON frame") from exc


def reject_constant(value):
    raise ValueError("Non-finite JSON value")


def write_message(stream, message):
    payload = json.dumps(message, ensure_ascii=False, allow_nan=False).encode("utf-8")
    if len(payload) > MAX_FRAME:
        raise ProtocolError("Response too large")
    stream.write(struct.pack("=I", len(payload)))
    stream.write(payload)
    stream.flush()


def error(request_id, code, message):
    return {"protocol": 1, "kind": "response", "id": request_id,
            "error": {"code": code, "message": message, "retryable": False}}


def dependency(name):
    # Chrome does not inherit an interactive shell's PATH. Search known install
    # locations without invoking a shell or accepting executable paths over IPC.
    executable = shutil.which(name, path="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin")
    if not executable:
        return {"available": False, "status": "missing"}
    try:
        flag = "--version" if name == "yt-dlp" else "-version"
        with subprocess.Popen([executable, flag], stdin=subprocess.DEVNULL,
                              stdout=subprocess.PIPE, stderr=subprocess.DEVNULL) as child:
            try:
                # Version output is bounded even if a broken tool emits forever.
                import selectors
                selector = selectors.DefaultSelector()
                try:
                    selector.register(child.stdout, selectors.EVENT_READ)
                    if not selector.select(timeout=2):
                        return {"available": False, "status": "probe-failed"}
                    output = child.stdout.read1(512)
                finally:
                    selector.close()
            finally:
                if child.poll() is None:
                    child.kill()
                child.wait(timeout=2)
        first_line = output.decode("utf-8", errors="replace").splitlines()[0]
        # Return only a version token, never arbitrary executable output/paths.
        match = re.search(r"(?<!\w)(?:n)?\d[\w.+-]{0,63}", first_line)
        if not match:
            return {"available": False, "status": "probe-failed"}
        return {"available": True, "version": match.group(0), "status": "available"}
    except (OSError, subprocess.SubprocessError, IndexError):
        return {"available": False, "status": "probe-failed"}


def diagnostics():
    return {"companionVersion": VERSION, "protocol": 1, "platform": platform.system().lower(),
            "capabilities": ["diagnostics"],
            "dependencies": {"ytDlp": dependency("yt-dlp"),
                             "ffmpeg": dependency("ffmpeg"), "ffprobe": dependency("ffprobe")}}


class Session:
    def __init__(self):
        self.negotiated = False

    def dispatch(self, request):
        if not isinstance(request, dict):
            raise ProtocolError("Expected envelope")
        request_id = request.get("id")
        if (not isinstance(request_id, str) or not 1 <= len(request_id) <= 128
                or request.get("kind") != "request"):
            raise ProtocolError("Invalid request envelope")
        if type(request.get("protocol")) is not int or request["protocol"] != 1:
            return error(request_id, "INCOMPATIBLE_PROTOCOL", "Install compatible Flux and companion versions.")
        method, params = request.get("method"), request.get("params")
        if not isinstance(method, str) or len(method) > 128 or not isinstance(params, dict):
            return error(request_id, "INVALID_REQUEST", "Expected method and parameter object.")
        if method == "hello":
            version = params.get("extensionVersion")
            if not isinstance(version, str) or not 1 <= len(version) <= 64:
                return error(request_id, "INVALID_REQUEST", "Expected extension version.")
            self.negotiated = True
        elif not self.negotiated:
            return error(request_id, "INVALID_REQUEST", "Send hello before other commands.")
        elif method != "diagnostics":
            return error(request_id, "UNSUPPORTED_CAPABILITY", "This companion supports connection diagnostics only.")
        return {"protocol": 1, "kind": "response", "id": request_id, "result": diagnostics()}


def authorized(config_path, origin):
    if not ORIGIN.fullmatch(origin):
        return False
    config = json.loads(Path(config_path).read_text())
    return config.get("name") == HOST_NAME and origin in config.get("allowed_origins", [])


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--config", required=True)
    parser.add_argument("origin")
    args = parser.parse_args()
    try:
        if not authorized(args.config, args.origin):
            print("Flux companion: extension origin is not authorized.", file=sys.stderr)
            return 1
        session = Session()
        while True:
            request = read_message(sys.stdin.buffer)
            if request is None:
                return 0
            write_message(sys.stdout.buffer, session.dispatch(request))
    except (ProtocolError, OSError, ValueError, TypeError, BrokenPipeError):
        print("Flux companion: connection rejected or closed.", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
