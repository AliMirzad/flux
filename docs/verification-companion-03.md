# Media companion milestone 3 evidence

Date: 2026-10-22. Scope: single-item inspection and format review on macOS. Native download jobs remain disabled.

## Implemented behavior

Settings offers a public media URL form, inspect/cancel controls, title, nullable duration, and at most 200 format choices. Unknown codec/track data is represented by nullable flags and the label `tracks unverified`. A format selection does not yet create a download.

The host admits one inspection and retains the latest review's source, provider and private selection plans for at most ten minutes. The review is bound to the direct route and connection. A shared Web Lock prevents another Flux tab from taking ownership while inspection or review is active. Closing the review, leaving Settings or disconnecting discards it. An explicit cancellation produces `CANCELED` after the worker stops; the UI uses port closure to release its entire session.

The platform adapter starts a separate Python worker. The worker uses yt-dlp `2026.03.17` from the same interpreter's package environment. The launcher preserves virtual-environment paths. An installed CLI executable alone is insufficient; missing or mismatched package versions return `DEPENDENCY_MISSING`.

## Network and execution policy

- Only the pinned stdlib urllib transport is enabled. HTTP(S) URL checks cover extractor requests and redirects; socket checks inspect actual numeric destinations so a public hostname resolving to private space is rejected before connection.
- Private, loopback, link-local, mapped and known IPv6 transition destinations are denied. Proxy settings and profile overrides are disabled; the preview uses explicit direct requests.
- Browser cookies, ambient plugins/config, external JavaScript runtimes, remote components, subprocess execution and alternate C transports are disabled. Worker file writes and filesystem mutations are denied.
- Responses must use identity encoding. Body reads are bounded to 8 MiB per response and 32 MiB per inspection, including redirect bodies; at most 100 socket connection attempts are admitted. Socket timeout is ten seconds, worker deadline 85 seconds and client inspection deadline 90 seconds. Native worker output remains bounded to 256 KiB.
- Cancellation terminates/reaps the worker. Parent-pipe EOF exits an orphaned worker without waiting for extraction. No external child programs are allowed in the inspection worker, so this containment does not establish FFmpeg/download process-tree behavior.

These controls rely on trusted packaged CPython and yt-dlp code. They are not an OS sandbox for hostile plugins. Custom adapters must be explicitly packaged and registered inside the guarded worker. Paths that need unsupported transports fail rather than bypassing the policy.

## Results

| Check                        | Result                                                                                                                 |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| TypeScript unit suite        | 99 tests passed across 13 files, including 16 companion tests                                                          |
| Python suite                 | 30 tests passed with the pinned yt-dlp runtime, Python 3.14.4                                                          |
| Build                        | Type checking, Vite/background build and package audit passed                                                          |
| Live worker                  | MDN's public `flower.mp4` returned title `flower` and one MP4 selection                                                |
| Actual Chrome                | Chrome 155.0.8059.86 displayed that live review through the unmodified installed companion                             |
| Private URL and missing host | Private source rejected; removing registration produced an actionable connection failure and cleared stale diagnostics |

The same Chrome run also passed cross-tab ownership rejection while a review was displayed, and cancel returned to the inspection form without a stale review. A screenshot of the actual review was inspected for layout and visible unknown metadata.

The MDN sample did not expose duration, height or codecs through this extraction path. The UI displayed duration unavailable and tracks unverified. This is evidence of the single-format inspection path, not verified multi-track site coverage.

Python tests cover real guarded socket/urllib calls, private DNS results, scheme/credential/transition-address denial, response budgets, worker timeout/cancel/reaping, parent EOF, cleanup when signaling fails, admission limits, private review projection, expiry and bounded playlist traversal. TypeScript tests cover capability negotiation, retained port ownership, cancellation, deadlines, disconnect invalidation, malformed reviews and error redaction.

The earlier 68 integration tests passed at milestone 2. This milestone does not change browser-engine logic; those results remain the earlier baseline, not a new execution claim.

## Reproduce

Build Flux, then run with a Python runtime containing the pinned requirements:

```sh
PYTHON_PATH=/absolute/path/to/runtime/bin/python \
COMPANION_SAMPLE_URL=https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4 \
node scripts/check-companion.mjs
```

The recorded runtime was Homebrew yt-dlp's Python 3.14.4 environment. The automation uses a disposable Chrome profile and native registration, pregrants native messaging in its test extension copy and removes the registration afterward. The normal permission prompt is still a manual acceptance gate. A prior wait for the format selector timed out because its implicit accessible label included option text; the review had rendered. An explicit accessible name corrected the test and UI label.

Several other public samples timed out or returned multiple items. No universal website claim follows from this acceptance. Proxy routing, cookies/login, impersonation, compressed responses, external JS challenges, multi-item playlists, media jobs, output destinations, conversion, persistence, packaged distribution and Windows remain outside this preview. The previously recorded pyenv-to-Chrome launch issue remains unresolved.
