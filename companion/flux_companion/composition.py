"""Explicit provider registration; no ambient plugins or downloaded adapter code."""

from .media import MediaProvider, MediaService
from .ytdlp import ExtractionBackend, YtDlpProvider


def media_service(backend: ExtractionBackend,
                  custom: tuple[MediaProvider, ...] = ()) -> MediaService:
    # Registration order is deliberate: custom adapters override the generic
    # extractor. Only an explicit non-applicability result permits fallback.
    return MediaService((*custom, YtDlpProvider(backend)))
