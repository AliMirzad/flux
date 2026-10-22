"""yt-dlp metadata adapter. Execution and network policy are supplied separately."""

import math
import uuid
from typing import Mapping, Protocol

from .media import MediaInfo, MediaSelection, ProviderError, ProviderInspection


class ExtractionBackend(Protocol):
    def extract(self, url: str) -> Mapping[str, object]:
        """Inspect one URL without downloading; enforce request policy and cancellation."""
        ...


class YtDlpProvider:
    id = "yt-dlp"

    def __init__(self, backend: ExtractionBackend):
        self.backend = backend

    def supports(self, url: str) -> bool:
        # Generic fallback after explicit custom providers. Actual site support
        # is determined by extraction, not guessed from the URL's hostname.
        return True

    def inspect(self, url: str) -> ProviderInspection:
        return normalize(self.backend.extract(url))


def normalize(raw: Mapping[str, object]) -> ProviderInspection:
    if not isinstance(raw, Mapping) or raw.get("_type", "video") != "video":
        raise ProviderError("Expected a single media item")
    title = raw.get("title") or raw.get("id") or "Untitled media"
    title = str(title).strip()[:512] or "Untitled media"
    duration = raw.get("duration")
    if (type(duration) not in {int, float} or not math.isfinite(duration) or duration < 0):
        duration = None
    formats = raw.get("formats")
    if not isinstance(formats, list):
        raise ProviderError("The extractor returned no selectable formats")
    selections, plans = [], {}
    seen = set()
    truncated = False
    for item in formats:
        if not isinstance(item, Mapping):
            continue
        format_id = item.get("format_id")
        if not isinstance(format_id, str) or not format_id or len(format_id) > 128 or format_id in seen:
            continue
        video = (item["vcodec"] != "none") if item.get("vcodec") else None
        audio = (item["acodec"] != "none") if item.get("acodec") else None
        if (video is False and audio is False) or item.get("has_drm"):
            continue
        if len(selections) >= 200:
            truncated = True
            break
        seen.add(format_id)
        selection_id = str(uuid.uuid4())
        height = item.get("height")
        if type(height) is not int or height <= 0:
            height = None
        ext = item.get("ext")
        container = ext if isinstance(ext, str) and 1 <= len(ext) <= 32 else None
        label = (f"{height}p" if height else "Video") if video else "Audio" if audio else "Media"
        if video is None or audio is None:
            label += " (tracks unverified)"
        elif video and audio:
            label += " with audio"
        elif video:
            label += " without audio"
        if container:
            label += f" ({container})"
        selections.append(MediaSelection(selection_id, label, container, height, video, audio))
        # Keep native format IDs and extractor URLs out of the shared DTO.
        plans[selection_id] = {"format_id": format_id}
    if not selections:
        raise ProviderError("The extractor returned no supported media formats")
    return ProviderInspection(MediaInfo(title, duration, tuple(selections), truncated), plans)
