"""Provider-neutral media descriptions; extractor internals stay in private plans."""

import ipaddress
import math
from dataclasses import dataclass
from typing import Mapping, Protocol
from urllib.parse import urlsplit


class ProviderError(Exception):
    """Extraction failed. The service must not hide it by switching providers."""


class ProviderNotApplicable(ProviderError):
    """The provider explicitly declined this source without creating a review."""


@dataclass(frozen=True)
class MediaSelection:
    id: str
    label: str
    container: str | None
    height: int | None
    has_video: bool
    has_audio: bool


@dataclass(frozen=True)
class MediaInfo:
    title: str
    duration: float | None
    selections: tuple[MediaSelection, ...]
    truncated: bool = False


@dataclass(frozen=True)
class ProviderInspection:
    media: MediaInfo
    # The application retains these handles privately and binds them to the
    # provider that produced the review. They are never extension wire payloads.
    plans: Mapping[str, object]


class MediaProvider(Protocol):
    @property
    def id(self) -> str: ...

    def supports(self, url: str) -> bool:
        """Cheap local match only; no network access."""
        ...

    def inspect(self, url: str) -> ProviderInspection: ...


@dataclass(frozen=True)
class ResolvedInspection:
    provider_id: str
    inspection: ProviderInspection


def validate_source(url: str) -> str:
    if not isinstance(url, str) or not 1 <= len(url) <= 8192:
        raise ValueError("Invalid media URL")
    if any(ord(char) < 33 or ord(char) == 127 for char in url):
        raise ValueError("Invalid media URL")
    parsed = urlsplit(url)
    host = parsed.hostname
    if (parsed.scheme not in {"http", "https"} or not host
            or parsed.username is not None or parsed.password is not None):
        raise ValueError("Expected a public HTTP(S) URL without credentials")
    parsed.port  # Validate malformed port syntax before selecting a provider.
    normalized = host.rstrip(".").lower()
    if ("." not in normalized or normalized.endswith((".localhost", ".local", ".internal"))
            or normalized == "localhost"):
        raise ValueError("Local media destinations are not supported")
    try:
        address = ipaddress.ip_address(normalized)
    except ValueError:
        address = None
    if address is not None and not address.is_global:
        raise ValueError("Private media destinations are not supported")
    return url


def validate_inspection(value: ProviderInspection) -> None:
    if not isinstance(value, ProviderInspection) or not isinstance(value.media, MediaInfo):
        raise ProviderError("Provider returned invalid media metadata")
    media = value.media
    if (not isinstance(media.title, str) or not 1 <= len(media.title) <= 512
            or type(media.truncated) is not bool or not isinstance(media.selections, tuple)
            or not 1 <= len(media.selections) <= 200):
        raise ProviderError("Provider returned invalid media metadata")
    if media.duration is not None and (type(media.duration) not in {int, float}
                                      or not math.isfinite(media.duration) or media.duration < 0):
        raise ProviderError("Provider returned invalid media duration")
    ids = set()
    for selection in media.selections:
        if (not isinstance(selection, MediaSelection) or not isinstance(selection.id, str)
                or not 1 <= len(selection.id) <= 128 or selection.id in ids
                or not isinstance(selection.label, str) or not 1 <= len(selection.label) <= 512
                or (selection.container is not None and
                    (not isinstance(selection.container, str) or not 1 <= len(selection.container) <= 32))
                or (selection.height is not None and
                    (type(selection.height) is not int or selection.height <= 0))
                or type(selection.has_video) is not bool or type(selection.has_audio) is not bool
                or not (selection.has_video or selection.has_audio)):
            raise ProviderError("Provider returned invalid media selections")
        ids.add(selection.id)
    if not isinstance(value.plans, Mapping) or set(value.plans) != ids:
        raise ProviderError("Provider plans do not match the displayed selections")


class MediaService:
    def __init__(self, providers: tuple[MediaProvider, ...]):
        ids = [provider.id for provider in providers]
        if (any(not isinstance(key, str) or not 1 <= len(key) <= 128 for key in ids)
                or len(set(ids)) != len(ids)):
            raise ValueError("Provider IDs must be unique bounded strings")
        self.providers = providers

    def inspect(self, url: str) -> ResolvedInspection:
        source = validate_source(url)
        for provider in self.providers:
            if not provider.supports(source):
                continue
            try:
                result = provider.inspect(source)
            except ProviderNotApplicable:
                continue
            validate_inspection(result)
            return ResolvedInspection(provider.id, result)
        raise ProviderNotApplicable("No provider supports this media source")
