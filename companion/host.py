"""Bounded native messaging diagnostics host. No download commands are enabled."""

import argparse
import json
import re
import struct
import sys
from pathlib import Path

# Isolated Python excludes the script directory. Trust only this installed,
# owner-writable distribution for companion imports, never ambient PYTHONPATH.
sys.path.insert(0, str(Path(__file__).resolve().parent))
from flux_companion.platforms import current_platform

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


def diagnostics(adapter):
    return {"companionVersion": VERSION, "protocol": 1, "platform": adapter.name,
            "capabilities": ["diagnostics"],
            "dependencies": {"ytDlp": adapter.probe_tool("yt-dlp"),
                             "ffmpeg": adapter.probe_tool("ffmpeg"),
                             "ffprobe": adapter.probe_tool("ffprobe")}}


class Session:
    def __init__(self, adapter=None):
        self.adapter = adapter if adapter is not None else current_platform()
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
        return {"protocol": 1, "kind": "response", "id": request_id, "result": diagnostics(self.adapter)}


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
