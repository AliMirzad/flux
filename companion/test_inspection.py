import io
import json
import os
import subprocess
import sys
import tempfile
import threading
import time
import unittest
from pathlib import Path
from unittest.mock import patch

import host
from flux_companion.inspection import InspectionController, InspectionFailure, RetainedReview, WorkerInspector
from flux_companion.media import MediaInfo, MediaSelection, ProviderInspection
from flux_companion.network import DirectNetworkPolicy, LimitedReader, NetworkDenied, ResponseBudget
from flux_companion.platforms import MacOSPlatform
from flux_companion.ytdlp import normalize


def result():
    item = MediaSelection("opaque", "720p", "mp4", 720, True, False)
    return "custom", ProviderInspection(MediaInfo("Sample", 12.5, (item,)), {item.id: "private"})


class WaitingInspector:
    def inspect(self, url, canceled):
        canceled.wait(2)
        if canceled.is_set():
            raise InspectionFailure("CANCELED")
        return result()


def completed(controller):
    deadline = time.monotonic() + 3
    while time.monotonic() < deadline:
        value = controller.poll()
        if value is not None:
            return value
        time.sleep(0.01)
    raise AssertionError("Inspection did not finish")


class InspectionTests(unittest.TestCase):
    def test_public_connect_policy_rejects_private_rebinding_and_transition_addresses(self):
        import socket
        policy = DirectNetworkPolicy()
        for address in ["127.0.0.1", "192.168.1.2", "169.254.169.254", "::1", "fc00::1",
                        "::ffff:8.8.8.8", "64:ff9b::7f00:1", "2002:7f00:1::", "example.com"]:
            with self.subTest(address=address), self.assertRaises(NetworkDenied):
                policy.audit("socket.connect", (type("Socket", (), {"family": socket.AF_INET6})(), (address, 443)))
        policy.audit("socket.connect", (type("Socket", (), {"family": socket.AF_INET})(), ("8.8.8.8", 443)))

    def test_policy_blocks_redirect_schemes_credentials_external_execution_and_writes(self):
        policy = DirectNetworkPolicy()
        for url in ["file:///tmp/test", "http://localhost/", "https://user:secret@example.com/"]:
            with self.assertRaises((NetworkDenied, ValueError)):
                policy.audit("urllib.Request", (url, None, {}, "GET"))
        for event, args in [("subprocess.Popen", ()), ("socket.sendto", ()),
                            ("ctypes.dlopen", ()), ("open", ("/tmp/file", "w", os.O_WRONLY))]:
            with self.subTest(event=event), self.assertRaises(NetworkDenied):
                policy.audit(event, args)

    def test_real_socket_and_urllib_are_guarded_in_an_isolated_process(self):
        source = """
import socket, sys, urllib.request
from flux_companion.network import DirectNetworkPolicy, NetworkDenied
sys.addaudithook(DirectNetworkPolicy().audit)
socket.getaddrinfo = lambda *a, **kw: [(socket.AF_INET, socket.SOCK_STREAM, 6, '', ('127.0.0.1', 9))]
for action in [lambda: socket.create_connection(('127.0.0.1', 9)),
               lambda: urllib.request.urlopen('file:///etc/hosts'),
               lambda: urllib.request.build_opener(urllib.request.ProxyHandler({})).open('http://public.example.com/')]:
    try:
        action()
    except NetworkDenied:
        continue
    except urllib.error.URLError as exc:
        if isinstance(exc.reason, NetworkDenied):
            continue
        raise
    raise AssertionError('Request was not denied')
"""
        checked = subprocess.run([sys.executable, "-B", "-c", source],
                                 env={**os.environ, "PYTHONPATH": str(Path(__file__).parent)},
                                 capture_output=True, timeout=5)
        self.assertEqual(checked.returncode, 0, checked.stderr)

    def test_response_budget_bounds_individual_and_aggregate_reads(self):
        budget = ResponseBudget()
        budget.remaining = 4
        reader = LimitedReader(io.BytesIO(b"12345"), budget)
        self.assertEqual(reader.read(2), b"12")
        with self.assertRaises(NetworkDenied):
            reader.read()
        self.assertTrue(reader.closed)
        other = LimitedReader(io.BytesIO(b"abcd"), ResponseBudget())
        other.remaining = 3
        with self.assertRaises(NetworkDenied):
            other.read()

    def test_library_backend_bounds_playlist_traversal_before_processing(self):
        from flux_companion.worker import LibraryBackend
        from flux_companion.media import ProviderError

        class Downloader:
            def extract_info(self, url, **kwargs):
                assert kwargs == {"download": False, "process": False}
                return {"_type": "playlist", "entries": iter([{}, {}, {}, {}])}

            def process_ie_result(self, *args, **kwargs):
                raise AssertionError("A playlist must not be processed")

        with self.assertRaises(ProviderError):
            LibraryBackend(Downloader()).extract("https://example.com/")

    def test_admission_cancel_and_review_expiry(self):
        controller = InspectionController(WaitingInspector())
        controller.start("first", "https://example.com/watch")
        with self.assertRaises(InspectionFailure) as failure:
            controller.start("second", "https://example.com/watch")
        self.assertEqual(failure.exception.code, "BUSY")
        controller.cancel("unknown")
        controller.cancel("first")
        self.assertEqual(completed(controller), ("first", None, "CANCELED"))
        controller.review = RetainedReview("expired", 1, "provider", "https://example.com/", result()[1])
        controller.expire()
        self.assertIsNone(controller.review)

    def test_review_packet_contains_only_public_metadata(self):
        inspector = type("Inspector", (), {"inspect": lambda *args: result()})()
        controller = InspectionController(inspector)
        controller.start("first", "https://example.com/watch")
        request_id, value, error = completed(controller)
        self.assertEqual(request_id, "first")
        self.assertIsNone(error)
        self.assertEqual(value["formats"][0]["selectionId"], "opaque")
        self.assertNotIn("private", json.dumps(value))
        self.assertTrue(controller.review)
        controller.close()
        self.assertIsNone(controller.review)

    def test_worker_timeout_and_cancel_reap_the_child(self):
        class Platform(MacOSPlatform):
            def start_inspection_worker(self):
                self.child = subprocess.Popen([sys.executable, "-I", "-c", "import time; time.sleep(30)"],
                                              stdin=subprocess.PIPE, stdout=subprocess.PIPE, start_new_session=True)
                return self.child

        for cancel in [False, True]:
            platform = Platform()
            canceled = threading.Event()
            if cancel:
                canceled.set()
            with self.assertRaises(InspectionFailure) as failure:
                WorkerInspector(platform, timeout=0.05).inspect("https://example.com/", canceled)
            self.assertEqual(failure.exception.code, "CANCELED" if cancel else "EXTRACTION_FAILED")
            self.assertIsNotNone(platform.child.poll())

    def test_worker_exits_when_parent_pipe_closes_during_inspection(self):
        source = """
import sys, time
from flux_companion import worker
worker.run = lambda url: time.sleep(30)
worker.main()
"""
        child = subprocess.Popen([sys.executable, "-B", "-c", source],
                                 env={**os.environ, "PYTHONPATH": str(Path(__file__).parent)},
                                 stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        try:
            child.stdin.write(b'"https://example.com/"\n')
            child.stdin.flush()
            time.sleep(0.1)
            self.assertIsNone(child.poll())
            child.stdin.close()
            self.assertEqual(child.wait(timeout=3), 1)
        finally:
            if child.poll() is None:
                child.kill()
                child.wait()
            child.stdout.close()
            child.stderr.close()

    def test_pipe_cleanup_stops_worker_even_when_signaling_fails(self):
        class Platform:
            def start_inspection_worker(self):
                source = "from flux_companion import worker; import time; worker.run = lambda url: time.sleep(30); worker.main()"
                self.child = subprocess.Popen([sys.executable, "-B", "-c", source],
                    env={**os.environ, "PYTHONPATH": str(Path(__file__).parent)},
                    stdin=subprocess.PIPE, stdout=subprocess.PIPE)
                return self.child

            def stop_inspection_worker(self, child):
                raise PermissionError("Signaling is unavailable")

        platform = Platform()
        with self.assertRaises(PermissionError):
            WorkerInspector(platform, timeout=0.1).inspect("https://example.com/", threading.Event())
        self.assertEqual(platform.child.wait(timeout=3), 1)

    def test_protocol_validation_precedes_worker_and_proxy_is_explicitly_rejected(self):
        session = host.Session(inspector=WaitingInspector())
        hello = {"protocol": 1, "kind": "request", "id": "hello", "method": "hello",
                 "params": {"extensionVersion": "0.7.0"}}
        with patch.object(host, "diagnostics", return_value={"capabilities": ["diagnostics"]}):
            session.dispatch(hello)
        for params, code in [({"url": "http://localhost/"}, "INVALID_URL"),
                             ({"url": "https://example.com/", "proxyProfileId": "x"}, "UNSUPPORTED_CAPABILITY")]:
            response = session.dispatch({**hello, "method": "inspect", "params": params})
            self.assertEqual(response["error"]["code"], code)
        self.assertIsNone(session.inspections.active)
        session.dispatch({**hello, "method": "inspect", "params": {"url": "https://example.com/"}})
        session.close()
        self.assertTrue(session.inspections.active[1].is_set())

    def test_missing_codec_metadata_is_explicitly_unknown(self):
        value = normalize({"formats": [{"format_id": "direct", "ext": "mp4"}]})
        selection = value.media.selections[0]
        self.assertIsNone(selection.has_video)
        self.assertIsNone(selection.has_audio)
        self.assertIn("unverified", selection.label)


if __name__ == "__main__":
    unittest.main()
