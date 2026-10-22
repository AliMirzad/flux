"""One inspection per process. Stdin EOF also stops an orphaned worker."""

import dataclasses
import itertools
import json
import os
import sys
import threading
import urllib.request
import urllib.response
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from flux_companion.composition import media_service
from flux_companion.media import ProviderError, validate_source
from flux_companion.network import DestinationDenied, DirectNetworkPolicy, LimitedReader, NetworkDenied, ResponseBudget

SUPPORTED_YTDLP = "2026.03.17"


class QuietLogger:
    def debug(self, message):
        pass

    warning = error = debug


def extractor():
    from yt_dlp import YoutubeDL
    from yt_dlp.globals import all_plugins_loaded, plugin_dirs
    from yt_dlp.networking._urllib import UrllibRH
    from yt_dlp.version import __version__

    if __version__ != SUPPORTED_YTDLP:
        raise ImportError("Unsupported extractor version")
    plugin_dirs.value = []
    all_plugins_loaded.value = True
    budget = ResponseBudget()

    class BoundedResponses(urllib.request.BaseHandler):
        # Run before yt-dlp's decompressor and urllib's redirect/error handlers.
        handler_order = 100

        def http_response(self, request, response):
            if response.headers.get("Content-Encoding", "identity").lower() != "identity":
                response.close()
                raise NetworkDenied("Compressed inspection responses are disabled")
            wrapped = urllib.response.addinfourl(LimitedReader(response, budget), response.headers,
                                                response.url, response.code)
            wrapped.msg = response.msg
            return wrapped

        https_response = http_response

    class BoundedUrllibRH(UrllibRH):
        RH_NAME = "Flux stdlib"

        def _prepare_headers(self, request, headers):
            headers["Accept-Encoding"] = "identity"

        def _create_instance(self, **kwargs):
            opener = super()._create_instance(**kwargs)
            opener.add_handler(BoundedResponses())
            return opener

    class GuardedYoutubeDL(YoutubeDL):
        def build_request_director(self, handlers, preferences=None):
            # C-backed transports and external runtimes could bypass CPython's
            # socket audit. Use only the inspected stdlib transport.
            return super().build_request_director([BoundedUrllibRH])

        def urlopen(self, request):
            validate_source(request if isinstance(request, str) else request.url)
            if getattr(request, "proxies", None):
                raise ValueError("Proxy overrides are disabled")
            return super().urlopen(request)

    return GuardedYoutubeDL({
        "quiet": True, "no_warnings": True, "logger": QuietLogger(),
        "skip_download": True, "simulate": True, "noplaylist": True,
        "extract_flat": "in_playlist", "lazy_playlist": True,
        "cachedir": False, "proxy": "", "socket_timeout": 10,
        "retries": 0, "extractor_retries": 0, "check_formats": False,
        "js_runtimes": {}, "remote_components": [],
        "enable_file_urls": False, "ffmpeg_location": "/nonexistent/flux-inspection",
    })


class LibraryBackend:
    def __init__(self, downloader):
        self.downloader = downloader

    def extract(self, url):
        raw = self.downloader.extract_info(url, download=False, process=False)
        if raw.get("_type") in {"playlist", "multi_video"}:
            # Generic HTML extraction can wrap one video in a playlist. Read at
            # most two entries so a real playlist never triggers full traversal.
            entries = list(itertools.islice(raw.get("entries", ()), 2))
            if len(entries) != 1:
                raise ProviderError("Inspect a single media item")
            raw = entries[0]
        return self.downloader.process_ie_result(raw, download=False)


def run(url):
    # Import the pinned dependency and construct its transport before installing
    # the audit hook. Extractors and user sources run only after policy activation.
    with extractor() as downloader:
        sys.addaudithook(DirectNetworkPolicy().audit)
        result = media_service(LibraryBackend(downloader)).inspect(url)
        return {"providerId": result.provider_id,
                "media": dataclasses.asdict(result.inspection.media),
                "plans": result.inspection.plans}


def failure_code(error):
    # yt-dlp wraps transport exceptions several times. Classify by type without
    # forwarding exception text, which may contain signed URLs or credentials.
    pending, seen = [error], set()
    for _ in range(32):
        if not pending:
            break
        current = pending.pop()
        if id(current) in seen:
            continue
        seen.add(id(current))
        if isinstance(current, DestinationDenied):
            return "NETWORK_BLOCKED"
        pending.extend(cause for cause in (current.__cause__, current.__context__)
                       if cause is not None)
    return "EXTRACTION_FAILED"


def main():
    command = sys.stdin.buffer.readline(65537)
    if len(command) > 65536 or not command.endswith(b"\n"):
        return 1

    def parent_closed():
        sys.stdin.buffer.read(1)
        os._exit(1)

    threading.Thread(target=parent_closed, daemon=True).start()
    try:
        url = validate_source(json.loads(command))
        result = {"result": run(url)}
    except ImportError:
        result = {"error": "DEPENDENCY_MISSING"}
    except Exception as exc:
        result = {"error": failure_code(exc)}
    payload = json.dumps(result, ensure_ascii=False, allow_nan=False).encode()
    if len(payload) > 256 * 1024:
        payload = b'{"error":"EXTRACTION_FAILED"}'
    sys.stdout.buffer.write(payload)
    sys.stdout.buffer.flush()
    return 0


if __name__ == "__main__":
    # The parent-watch thread deliberately blocks on stdin. Avoid interpreter
    # shutdown trying to acquire that thread's buffered-reader lock.
    os._exit(main())
