# Flux 0.10.0 - separate HLS audio and integration review

- Select a named audio/language rendition for completed fMP4 HLS, combine it with video and preserve the selection through full-browser recovery, repeat copies and version-3 URL lists. Ordinary identity AES-128 is supported on either source. Encoded media samples stay unchanged. Separate TS audio, live/discontinuities and DASH remain open.
- Integrates the final manager/popup redesign, capture confirmation and queue flows. Compatible cookie-authenticated GETs can use the original source session. The real Advanced cookie toggle controls it; every unrelated redirect/media/key origin omits credentials. Imports do not silently opt into cookies.
- Approved page blob/data downloads use bounded sender-bound messages and verified OPFS staging, including script-triggered blob handoff. Replay, oversized/out-of-order chunks, overlap and orphan-cleanup races are refused; abandoned transfers expire. Received page files cannot accidentally re-download their source page.
- Review and exact acceptance evidence: [source findings](code-review-0.10.md), [verification](verification-0.10.md). The full requested capability goal remains open.

# Earlier release: Flux 0.9.0 - ordinary AES-128 HLS

- Completed H.264/AAC MP4 and independently decodable TS HLS can use ordinary identity AES-128 CBC/PKCS7. Review includes key origins. Explicit/media-sequence IVs, encrypted initialization with an explicit IV, rotated keys, clear transitions and complete encrypted byte ranges are supported. DRM/sample encryption remain unsupported.
- Raw keys remain temporary; checkpoints retain a fingerprint alongside ciphertext identity and decrypted/converted output extent/hash. Resume refuses a changed key while retaining committed output. Invalid key lengths and padding cannot commit the failed part.
- Ciphertext uses fixed 256 KiB blocks with a bounded part size/object count. The decryption/conversion path keeps input alive until flush. Key traffic shares throttling/allowance accounting, including a full-window check that prevents repeated key-only pauses.
- Actual Chrome export, playback, encoded sample identity, full restart recovery and missing key-origin access are verified. See [0.9 review](code-review-0.9.md) and [verification](verification-0.9.md). The full capability goal remains open.
- The current workspace also includes a configurable queue chooser for newly captured jobs when named queues exist, plus clearer queue scheduling/status controls. The browser acceptance suite covers holding a click without a duplicate native download, choosing a named queue in the popup and completing that job.

# Earlier release: Flux 0.8.0 - bounded MPEG-TS HLS conversion

- Completed, unencrypted H.264/AAC HLS with independently decodable MPEG-TS parts can produce a playable MP4. Each part is capped at 16 MiB and converted in a packaged child worker with cancellation and a processing deadline. Unsupported keyframe boundaries, split program metadata, codecs and discontinuities are refused explicitly.
- Source bytes/validators and converted output extents/hashes have distinct durable checkpoints. Full Chrome restart retains converted output, revalidates its source with HEAD and fetches only missing parts. First-part checkpoint failure rolls back initialization and timeline metadata.
- Review addressed malformed AAC non-progress, silent pre-keyframe frame loss, TS packet continuity, 33-bit timestamp rollover, standalone duration and fragment-address assumptions. Actual Chrome export/playback verifies color/audio/seek markers and every encoded video frame/AAC sample against the source.
- The user's installed 0.7.0 activation and download startup were confirmed. The 0.8 artifact is separately tested and packaged; that confirmation does not establish 0.8 activation. Remaining media, crawling and localization work stays open.

See [0.8 verification](verification-0.8.md), [source review](code-review-0.8.md) and the [capability audit](feature-parity.md).

# Earlier release: Flux 0.7.0 - verified MP4 HLS assembly and integration review

- Review completed, unencrypted MP4 HLS playlists, choose a quality and download a single H.264/AAC rendition to a playable MP4. Worker staging validates initialization, fragment/sample bounds and relative decode timelines, with incremental hashing and durable logical-part checkpoints. Full Chrome restart revalidates retained parts before fetching missing payload.
- User-invoked page media discovery includes HLS playlist links and recent resource entries. Playlist selections open review instead of downloading the manifest as a finished video. MPEG-TS, separate audio, encryption, live/discontinuity workflows and DASH remain unfinished.
- Completed files save to Chrome's Downloads folder by default, with configurable category paths, collision handling and Show in folder. Save As and an explicitly chosen folder remain available. A browser save-dialog notice explains its setting and folder alternatives.
- Existing-frame capture injection now includes already-loaded iframes, with a top-frame fallback for restricted children. Settings can inspect the loaded background version, capture switch, host grant and listener, or reconnect existing capture without expanding permissions.
- Downloads-folder saving rehashes the exact staged File snapshot before starting a native write. History errors after successful saving retain the completed destination. Batch/queue/media transactions clone all inputs before starting writes. MP4 field boundaries and URL-list versions receive additional validation.

The complete parity request remains active; see [code review](code-review-0.7.md), [verification](verification-0.7.md) and [capability audit](feature-parity.md).

# Earlier release: Flux 0.6.0 - bounded automatic recovery for failed transfers

- Optional global and per-queue retry policies allow 0–20 automatic whole-transfer retries after short engine request retries are exhausted. Defaults remain off. Transient transport/timeouts and selected temporary HTTP failures qualify; authentication, access, storage and verification errors require attention.
- Failure times, server not-before hints, counters and next deadlines persist. Delays double up to 24 hours while honoring a longer Retry-After. Reopening restores the original deadline. Queue calendars and concurrency still gate dispatch; an attempt is consumed only when persisted for actual dispatch.
- Durable completed ranges are revalidated and reused on the next attempt. Manual retry resets the budget. Stop automatic retries, selected pause and Pause all cancel the pending plan across reopening. Refreshing an expired URL clears its prior plan. Original Chrome transfers never enter this policy.
- A coalesced queue wake prevents fast failure/completion events delivered during dispatch from losing the next scheduling pass. Redirect-observer timeouts have a typed transient classification.

See [0.6 verification](verification-0.6.md) and the [remaining capability audit](feature-parity.md).

# Earlier release: Flux 0.5.0 - original browser transfers in Flux

- Capture now links eligible session-authenticated and POST downloads to their original Chrome request. Flux shows actual progress, pause/resume/cancel and completion without replaying a POST or copying credentials.
- Trusted blob/data download links retain their bytes and filename. A bounded, single-use page attribution hint lets Chrome keep the original generated resource; data URL payloads never enter Flux records. Site exclusions also apply to generated links in cross-origin frames.
- Original browser transfers continue with Chrome open after the manager closes. Popup controls work without an engine manager. Chrome retains destination selection and security warnings; these rows do not claim Flux hash verification, connection settings, schedules or allowance enforcement.
- Show in folder locates completed browser files without opening them. Removing a browser row preserves saved files and Chrome history. Canceled or non-resumable protected requests require the website or Chrome review rather than an invented GET retry.
- Explicit Use browser download converts the stopped Flux row to a newly consented Chrome GET, preserving the history identity and marking any expected digest unverified. Completed Flux files retain their verified checkpoints when selected for bulk cancellation.
- Includes the previously reproduced cold-background redirect fix for the supplied Soft98 URL.

See [0.5 verification](verification-0.5.md) and the [remaining capability audit](feature-parity.md).

# Earlier release: Flux 0.4.0 - calendar queues and durable download allowance

- Queues can choose weekdays, first-start/final-stop dates, and overnight windows tied to their opening day. Boundary timers and alarms avoid idle polling.
- Periodic queues create new verified copies at 1–10,080 minute intervals, while retaining earlier copies. New jobs and clearing the next-run marker commit atomically. Repeats respect global and queue windows, including a global window reopening when all prior files are already verified.
- Optional queue completion notifications aggregate verified files once; queues can stop after verification. Optional completion tones use a locally activated Web Audio context.
- A shared allowance limits authorized Flux payload per fixed 1–168 hour window. Usage is persisted before ranges start. Complete allowed ranges finish before an allowance pause, avoiding repeated partial work without checkpoints. Allowance pauses survive reopening; raising/disabling the limit resumes eligible jobs. Changing the limit on active streams restarts them with the new configuration.
- Non-resumable files larger than a full allowance report an actionable configuration error. Range reservations, retries and up to 1 MiB of unused shared credit count conservatively; this is not whole-device network accounting.

See [0.4 verification](verification-0.4.md) and the [remaining capability audit](feature-parity.md). Browser-only lifetime and permission limits still apply. This milestone does not declare the complete IDM/AB request finished.

# Earlier release: Flux 0.3.0 - reliable redirect startup, queues and automatic saving

The reported error **The redirect destination could not be read** was reproduced after terminating the extension background worker before a new download. Read-only observers missed the redirect while the worker was stopped. Each engine request now receives an explicit background-ready acknowledgement before fetch begins. This is per-operation coordination, without a keepalive loop. A single-origin grant and a missing CDN grant have dedicated browser tests.

- Automatic capture starts at document start and supports frames as well as existing tabs.
- Named queues have independent start/stop, concurrent-file limits, bandwidth pacing, and daily/overnight time windows, within the global limits.
- Batch review accepts text/JSON lists, numbered URL patterns, filtering and selection. Existing pending URLs are skipped; validated jobs commit together.
- Page link discovery, drop/paste review, selected row actions, and URL-list export connect to the real queue.
- Stopped downloads can refresh expired addresses. Resume revalidates identity; a changed final resource URL restarts safely.
- An explicitly selected download folder supports automatic streamed export, optional category directories and numbered filename collision handling. Folder handles are stored locally. Revoked permissions retain verified data and require a new user folder selection.

This is a tested milestone in the ongoing [IDM/AB capability work](feature-parity.md), not a claim of complete parity. See [0.3 verification](verification-0.3.md) for actual checks and platform limits. Load the 0.3.0 package or reload an existing `dist` installation, then enable automatic capture and approve website access. Keep the manager open.

# Earlier release: Flux 0.2.0 - automatic capture and CDN redirects

This release fixes eligible link clicks continuing through Chrome and direct URLs failing at ordinary CDN redirects. It remains an engineering preview with the platform acceptance limits listed below.

## Changes in 0.2.0

- One-time **Enable automatic downloads** action in the manager and popup. Approved capture applies immediately to already-open tabs. File links, download attributes, filename query parameters, and cross-origin links queue and start in Flux without a duplicate Chrome transfer.
- Safe native GET takeover: pause, verify a public response, commit a durable queue entry, then cancel Chrome. POST, session-only, ambiguous, excluded-site, and unreproducible downloads retain Chrome's original transfer. No cookie/header copying.
- Redirect resolution validates every destination and host grant before the next request, including cross-host CDN chains. Private targets, loops, and HTTPS downgrades are blocked. A failed job can request access to a new redirect host and retry.
- More compatible capability probes, per-request timeouts, single-stream fallback for invalid range probes, clearer authentication errors, and expanded default file extensions. Existing custom extension lists are preserved.
- Added read-only `webRequest` permission for short-lived request-method and own-request redirect metadata. No blocking request listener, cookie permission, remote code, or background keepalive was added.

## Verification and package

See [0.2.0 verification](verification-0.2.md) for unit/integration and real Chrome capture, redirect, lifecycle, large-file, and supplied Soft98 URL results. The Soft98 file was downloaded in the extension and its digest matched an independent browser response. Native OS Save As interaction, macOS, power-loss recovery, and 5/10 GB capacity remain unverified. Existing performance figures describe 0.1.0 and are not fresh 0.2.0 benchmarks.

Build with `npm run release`; extract `releases/flux-0.2.0.zip` and load its directory unpacked. For an existing installation built from `dist`, rebuild and click **Reload** in `chrome://extensions`, then enable capture and approve website access. Keep the manager tab open during transfers. **Ready to save** still requires explicit Save As; **Completed** means the destination was committed.

# Earlier release: Flux 0.1.0 - engineering preview

Date: 2026-10-19. This release is available for unpacked evaluation. Critical platform acceptance gates remain; it is not presented as production ready.

## Included

- MV3 extension with manager, popup, light/dark themes, real progress, details, queue/history views, and settings.
- Validated range probing, bounded concurrent segmented GETs, adaptive/manual connection settings, single-stream fallback, retry/backoff, per-host limits, and bandwidth pacing.
- OPFS random-access staging, durable completed-range checkpoints, recovery validation, incremental SHA-256, and streamed user-selected export with a second hash check.
- Pause/resume where resource identity and range support permit; queue priorities, schedules/time windows, recovery policy, filename handling, categories, and explicit data cleanup.
- Link context menu, manual URL entry, direct-media inspection, and opt-in page/native download offers. Native offers do not cancel Chrome's original download; accepting one can start a duplicate transfer.
- Local HTTP fixtures, unit/integration and real-browser tests, benchmark tooling, and a distributable build/ZIP workflow.

## Semantics and constraints

**Ready to save** means verified OPFS bytes await explicit Save As. **Completed** means export committed. The manager owns the execution worker and must stay open. Scheduling does not reopen the manager automatically; alarms are best effort. Public direct GET links are the main input; credentials/referrers are omitted and redirects fail closed. There is no native helper, offscreen lifetime workaround, telemetry, or backend.

See [limitations](limitations.md) and [security](security.md) for unsupported request types, disk costs, lifecycle restrictions, and DNS rebinding risk. The manifest requests storage, downloads, contextMenus, alarms, activeTab, and scripting; host access is optional per site and notifications are optional. It does not request unlimitedStorage, so ordinary quota/eviction constraints must be handled.

## Verification status

Final counts and measurements belong in the generated test/benchmark evidence, not inferred release claims. Real Chrome browser testing uses an isolated profile. Native OS Save As UI is substituted in automation and remains manually unverified. Full OS shutdown, macOS acceptance, large-file capacity targets, and Web Store review are separate gates. The recorded environment's roughly 3.9 GB initial free disk space prevents meaningful 5 GB/10 GB acceptance runs. No IDM comparison or fixed acceleration claim is made.

Build, test, installation, and use commands are in the [README](../README.md). Release packaging creates `releases/flux-0.1.0.zip` from the built extension only, with a SHA-256 sidecar.
