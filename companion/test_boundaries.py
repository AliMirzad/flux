import dataclasses
import sys
import tempfile
import unittest
from pathlib import Path

import host
import install
from flux_companion.composition import media_service
from flux_companion.media import (MediaInfo, MediaSelection, MediaService, ProviderError,
                                  ProviderInspection, ProviderNotApplicable)
from flux_companion.platforms import (BoundedProbeRunner, MacOSPlatform, UnsupportedPlatform,
                                      current_platform)
from flux_companion.ytdlp import normalize


def extracted():
    return {"title": "Example", "duration": 12.5, "formats": [
        {"format_id": "v1", "vcodec": "avc1", "acodec": "none", "height": 720, "ext": "mp4",
         "url": "https://cdn.example.com/media?secret=private"},
        {"format_id": "a1", "vcodec": "none", "acodec": "aac", "ext": "m4a"},
    ]}


class Backend:
    def __init__(self):
        self.calls = []

    def extract(self, url):
        self.calls.append(url)
        return extracted()


class CustomProvider:
    id = "custom-example"

    def supports(self, url):
        return url.startswith("https://example.com/")

    def inspect(self, url):
        selection = MediaSelection("custom-selection", "Original", "mp4", 1080, True, True)
        return ProviderInspection(MediaInfo("Custom example", None, (selection,)),
                                  {selection.id: {"custom-handle": "private"}})


class FakeWindowsPlatform:
    name = "windows"

    def probe_tool(self, name):
        return {"available": False, "status": "missing"}


class BoundaryTests(unittest.TestCase):
    def test_shared_host_uses_injected_platform(self):
        session = host.Session(FakeWindowsPlatform())
        response = session.dispatch({"protocol": 1, "kind": "request", "id": "hello", "method": "hello",
                                     "params": {"extensionVersion": "0.7.0"}})
        self.assertEqual(response["result"]["platform"], "windows")
        self.assertEqual(response["result"]["dependencies"]["ytDlp"]["status"], "missing")

    def test_unsupported_os_does_not_silently_choose_macos(self):
        with self.assertRaises(UnsupportedPlatform):
            current_platform("Windows")
        adapter = current_platform("Darwin")
        self.assertIsInstance(adapter, MacOSPlatform)
        with self.assertRaises(ValueError):
            adapter.find_tool("arbitrary-command")

    def test_probe_output_and_runtime_are_bounded(self):
        runner = BoundedProbeRunner()
        output = runner.version_output(Path(sys.executable), ["-I", "-c", "print('x' * 100000)"])
        self.assertEqual(len(output), 512)
        with self.assertRaises(TimeoutError):
            runner.version_output(Path(sys.executable), ["-I", "-c", "import time; time.sleep(10)"])

    def test_installer_copies_package_and_removes_only_owned_sources(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            install.install("a" * 32, root / "host", root / "manifests")
            self.assertTrue((root / "host/flux_companion/ytdlp.py").is_file())
            (root / "host/flux_companion/user-note.txt").write_text("retain")
            install.uninstall(root / "host", root / "manifests")
            self.assertEqual((root / "host/flux_companion/user-note.txt").read_text(), "retain")
            self.assertFalse((root / "host/flux_companion/ytdlp.py").exists())

    def test_custom_provider_overrides_ytdlp_without_changing_the_result_contract(self):
        backend = Backend()
        result = media_service(backend, (CustomProvider(),)).inspect("https://example.com/watch")
        self.assertEqual(result.provider_id, "custom-example")
        self.assertEqual(result.inspection.media.title, "Custom example")
        self.assertEqual(backend.calls, [])

    def test_unmatched_custom_provider_uses_ytdlp_and_keeps_private_details_out_of_media(self):
        backend = Backend()
        result = media_service(backend, (CustomProvider(),)).inspect("https://other.example.com/watch")
        self.assertEqual(result.provider_id, "yt-dlp")
        self.assertEqual(len(backend.calls), 1)
        public = dataclasses.asdict(result.inspection.media)
        self.assertNotIn("secret", str(public))
        self.assertNotIn("format_id", str(public))
        selections = result.inspection.media.selections
        self.assertTrue(selections[0].has_video)
        self.assertFalse(selections[0].has_audio)
        self.assertTrue(selections[1].has_audio)
        self.assertEqual(result.inspection.plans[selections[0].id], {"format_id": "v1"})

    def test_explicit_decline_allows_fallback_but_real_failures_do_not(self):
        backend = Backend()

        class Declining(CustomProvider):
            def inspect(self, url):
                raise ProviderNotApplicable()

        self.assertEqual(media_service(backend, (Declining(),)).inspect("https://example.com/watch").provider_id, "yt-dlp")
        backend.calls.clear()

        class Failing(CustomProvider):
            def inspect(self, url):
                raise ProviderError("Source access failed")

        with self.assertRaisesRegex(ProviderError, "access failed"):
            media_service(backend, (Failing(),)).inspect("https://example.com/watch")
        self.assertEqual(backend.calls, [])

    def test_provider_collisions_and_invalid_results_are_rejected(self):
        with self.assertRaises(ValueError):
            MediaService((CustomProvider(), CustomProvider()))

        class Broken(CustomProvider):
            def inspect(self, url):
                return ProviderInspection(super().inspect(url).media, {})

        with self.assertRaisesRegex(ProviderError, "plans"):
            media_service(Backend(), (Broken(),)).inspect("https://example.com/watch")

    def test_invalid_input_is_rejected_before_any_provider_runs(self):
        backend = Backend()
        service = media_service(backend)
        for url in ["file:///tmp/file", "https://user:secret@example.com/", "http://127.0.0.1/",
                    "http://localhost/", "http://host.local/", "https://example.com:bad/", "https://example.com/\n"]:
            with self.subTest(url=url), self.assertRaises(ValueError):
                service.inspect(url)
        self.assertEqual(backend.calls, [])

    def test_ytdlp_normalization_bounds_formats_and_handles_missing_metadata(self):
        raw = extracted()
        raw.update(title=None, id="fallback-id", duration=float("nan"))
        raw["formats"] += [{"format_id": "drm", "vcodec": "avc1", "has_drm": True},
                           {"format_id": "v1", "vcodec": "avc1"}]
        result = normalize(raw)
        self.assertEqual(result.media.title, "fallback-id")
        self.assertIsNone(result.media.duration)
        self.assertEqual(len(result.media.selections), 2)
        raw["formats"] = [{"format_id": str(i), "vcodec": "avc1"} for i in range(205)]
        result = normalize(raw)
        self.assertEqual(len(result.media.selections), 200)
        self.assertTrue(result.media.truncated)
        for invalid in [{"_type": "playlist"}, {"formats": []}]:
            with self.assertRaises(ProviderError):
                normalize(invalid)


if __name__ == "__main__":
    unittest.main()
