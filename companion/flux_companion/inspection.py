"""Inspection admission, private review ownership and worker deadlines."""

import json
import contextlib
import queue
import threading
import time
import uuid
from dataclasses import dataclass

from .media import MediaInfo, MediaSelection, ProviderInspection, validate_inspection


@dataclass(frozen=True)
class RetainedReview:
    id: str
    expires_at: int
    provider_id: str
    source: str
    inspection: ProviderInspection
    route: str = "direct"


class InspectionFailure(Exception):
    def __init__(self, code):
        self.code = code


class WorkerInspector:
    def __init__(self, platform, timeout=85):
        self.platform = platform
        self.timeout = timeout

    def inspect(self, url, canceled):
        child = self.platform.start_inspection_worker()
        output = queue.Queue(maxsize=1)

        def read():
            try:
                output.put(child.stdout.read(256 * 1024 + 1))
            except OSError:
                output.put(b"")

        try:
            child.stdin.write(json.dumps(url).encode() + b"\n")
            child.stdin.flush()
            threading.Thread(target=read, daemon=True).start()
            deadline = time.monotonic() + self.timeout
            while True:
                if canceled.is_set():
                    raise InspectionFailure("CANCELED")
                if time.monotonic() >= deadline:
                    raise InspectionFailure("EXTRACTION_FAILED")
                try:
                    payload = output.get(timeout=0.05)
                    break
                except queue.Empty:
                    continue
            if not payload or len(payload) > 256 * 1024:
                raise InspectionFailure("EXTRACTION_FAILED")
            packet = json.loads(payload)
            if "error" in packet:
                raise InspectionFailure(packet["error"] if packet["error"] in {"DEPENDENCY_MISSING", "NETWORK_BLOCKED"}
                                        else "EXTRACTION_FAILED")
            value = packet["result"]
            if not isinstance(value["providerId"], str) or not 1 <= len(value["providerId"]) <= 128:
                raise InspectionFailure("EXTRACTION_FAILED")
            media = value["media"]
            inspection = ProviderInspection(
                MediaInfo(media["title"], media["duration"],
                          tuple(MediaSelection(**item) for item in media["selections"]),
                          media["truncated"]), value["plans"])
            validate_inspection(inspection)
            return value["providerId"], inspection
        except InspectionFailure:
            raise
        except Exception as exc:
            raise InspectionFailure("EXTRACTION_FAILED") from exc
        finally:
            try:
                self.platform.stop_inspection_worker(child)
            finally:
                # EOF is a second cleanup path if signaling failed. The worker
                # watches this pipe and exits without relying on extraction.
                with contextlib.suppress(OSError):
                    child.stdin.close()
                child.stdout.close()


class InspectionController:
    def __init__(self, inspector):
        self.inspector = inspector
        self.active = None
        self.completed = queue.Queue()
        self.review = None

    def start(self, request_id, url):
        if self.active is not None:
            raise InspectionFailure("BUSY")
        self.review = None
        canceled = threading.Event()

        def inspect():
            try:
                provider, value = self.inspector.inspect(url, canceled)
                if canceled.is_set():
                    raise InspectionFailure("CANCELED")
                review_id = str(uuid.uuid4())
                expiry = int(time.time() * 1000) + 600000
                self.completed.put((request_id, RetainedReview(review_id, expiry, provider, url, value), None))
            except InspectionFailure as exc:
                self.completed.put((request_id, None, exc.code))
            except Exception:
                self.completed.put((request_id, None, "EXTRACTION_FAILED"))

        thread = threading.Thread(target=inspect, daemon=True)
        self.active = (request_id, canceled, thread)
        thread.start()

    def cancel(self, request_id):
        if self.active and self.active[0] == request_id:
            self.active[1].set()

    def poll(self):
        try:
            request_id, result, code = self.completed.get_nowait()
        except queue.Empty:
            return None
        if self.active[1].is_set():
            code, result = "CANCELED", None
        self.active = None
        if result:
            self.review = result
            media = result.inspection.media
            result = {"reviewId": result.id, "expiresAt": result.expires_at, "title": media.title,
                      "duration": media.duration, "truncated": media.truncated,
                      "formats": [{"selectionId": item.id, "label": item.label,
                                   "container": item.container, "height": item.height,
                                   "hasVideo": item.has_video, "hasAudio": item.has_audio}
                                  for item in media.selections]}
        return request_id, result, code

    def close(self):
        if self.active:
            self.active[1].set()
            self.active[2].join(timeout=3)
        self.review = None

    def expire(self):
        if self.review and self.review.expires_at <= int(time.time() * 1000):
            self.review = None
