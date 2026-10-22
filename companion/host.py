"""Bounded native messaging host for diagnostics and single-item inspection."""

import argparse
import io
import json
import queue
import re
import struct
import sys
import threading
from pathlib import Path

# Isolated Python excludes the script directory. Trust only this installed,
# owner-writable distribution for companion imports, never ambient PYTHONPATH.
sys.path.insert(0, str(Path(__file__).resolve().parent))
from flux_companion.platforms import current_platform
from flux_companion.inspection import InspectionController, InspectionFailure, WorkerInspector
from flux_companion.media import validate_source
from flux_companion.destinations import DestinationError, DestinationRegistry

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
    def __init__(self, adapter=None, inspector=None, destinations=None):
        self.adapter = adapter if adapter is not None else current_platform()
        self.inspections = InspectionController(inspector or WorkerInspector(self.adapter)) if (
            inspector is not None or self.adapter.name == "darwin") else None
        self.negotiated = False
        self.info = None
        self.destinations = destinations
        if self.destinations is None and self.adapter.name == "darwin":
            self.destinations = DestinationRegistry(self.adapter.data_location(Path.home()), self.adapter)

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
        elif method == "destinations.list" and self.destinations is not None:
            if params:
                return error(request_id, "INVALID_REQUEST", "Destination listing takes no parameters.")
            try:
                result = self.destinations.list()
            except DestinationError:
                return error(request_id, "DESTINATION_UNAVAILABLE", "Check locally approved companion folders.")
            return {"protocol": 1, "kind": "response", "id": request_id, "result": result}
        elif method == "inspect" and self.inspections:
            if "proxyProfileId" in params:
                return error(request_id, "UNSUPPORTED_CAPABILITY", "Proxy profiles are not available yet.")
            try:
                source = validate_source(params.get("url"))
            except ValueError:
                return error(request_id, "INVALID_URL", "Enter a public HTTP(S) media URL without credentials.")
            try:
                self.inspections.start(request_id, source)
            except InspectionFailure as exc:
                return error(request_id, exc.code, "Another inspection is still running.")
            return None
        elif method == "inspect.cancel" and self.inspections:
            target = params.get("requestId")
            if not isinstance(target, str) or not 1 <= len(target) <= 128:
                return error(request_id, "INVALID_REQUEST", "Expected an inspection request ID.")
            self.inspections.cancel(target)
            return {"protocol": 1, "kind": "response", "id": request_id, "result": {"cancelRequested": True}}
        elif method != "diagnostics":
            return error(request_id, "UNSUPPORTED_CAPABILITY", "This companion does not support that operation.")
        if self.info is None:
            self.info = diagnostics(self.adapter)
            if self.inspections:
                self.info["capabilities"] += ["inspect", "inspect.cancel"]
            if self.destinations is not None:
                self.info["capabilities"].append("destinations.list")
        return {"protocol": 1, "kind": "response", "id": request_id, "result": self.info}

    def poll(self):
        if not self.inspections:
            return None
        self.inspections.expire()
        value = self.inspections.poll()
        if value is None:
            return None
        request_id, result, code = value
        if code:
            messages = {"DEPENDENCY_MISSING": "Install the supported yt-dlp Python package in the companion runtime.",
                        "CANCELED": "Media inspection canceled.",
                        "EXTRACTION_FAILED": "Could not inspect this media within the supported inspection policy."}
            return error(request_id, code, messages.get(code, "Media inspection failed."))
        return {"protocol": 1, "kind": "response", "id": request_id, "result": result}

    def close(self):
        if self.inspections:
            self.inspections.close()


def authorized(config_path, origin):
    if not ORIGIN.fullmatch(origin):
        return False
    config = json.loads(Path(config_path).read_text())
    return config.get("name") == HOST_NAME and origin in config.get("allowed_origins", [])


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--config", required=True)
    parser.add_argument("--data-dir", type=Path)
    parser.add_argument("origin")
    args = parser.parse_args()
    try:
        if not authorized(args.config, args.origin):
            print("Flux companion: extension origin is not authorized.", file=sys.stderr)
            return 1
        adapter = current_platform()
        directory = args.data_dir or adapter.data_location(Path.home())
        session = Session(adapter, destinations=DestinationRegistry(directory, adapter))
        incoming = queue.Queue(maxsize=8)
        stdin = io.FileIO(sys.stdin.fileno(), mode="rb", closefd=False)
        def read():
            try:
                while True:
                    value = read_message(stdin)
                    incoming.put(value)
                    if value is None:
                        break
            except Exception:
                incoming.put(ProtocolError("Input closed"))
        threading.Thread(target=read, daemon=True).start()
        idle = object()
        try:
            while True:
                try:
                    request = incoming.get(timeout=0.05)
                except queue.Empty:
                    request = idle
                if request is None:
                    return 0
                if isinstance(request, Exception):
                    raise request
                if request is not idle:
                    response = session.dispatch(request)
                    if response:
                        write_message(sys.stdout.buffer, response)
                response = session.poll()
                if response:
                    write_message(sys.stdout.buffer, response)
        finally:
            session.close()
    except (ProtocolError, OSError, ValueError, TypeError, BrokenPipeError):
        print("Flux companion: connection rejected or closed.", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
