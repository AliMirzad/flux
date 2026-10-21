# Verification evidence — Flux 0.10.0

Date: 2026-10-21. Windows, Chrome 155.0.8059.85, Node 24.18.1. This milestone adds separate fMP4 HLS audio selection and integrates/reviews the shared UI, authenticated GET and generated-file changes. The overall requested capability goal remains active.

## Final source and checks

- Strict TypeScript, production build and MV3 package audit passed: **16 files, 754,714 bytes (737.0 KiB) unpacked**. Required permissions, optional permissions/hosts, minimum Chrome version and CSP match 0.9. No new dependency, native component or external processing service was added.
- **216 unit and real HTTP integration tests in 22 files passed in 25.83 seconds**. These include composition, original/alternate encoded samples, both-source recovery, encrypted composition, weak companion changes, timing rejection, atomic checkpoint rollback, compound allowance, retained audio choices, credentials, sender-bound ingestion, replay, malformed/oversized input, concurrent messages, expiry, cleanup races and non-replayable page files.
- The first composition candidate passed all 61 then-existing Chrome cases. After the integration security fixes, the capture subset passed **20/20 in 41.9 seconds**. The first broad final-build invocation passed **61/62 in 3.7 minutes**: the weekly-queue case read an undefined job before asynchronous addition finished. Its helper now waits for the Add Download dialog to close; no product code changed for this test repair. The corrected final broad run passed **all 62 cases in 3.7 minutes**, including that scheduling case, the cold-background live link, both themes, seven actual media exports, full-browser recovery and the new session/generated-file paths.
- Formatting passed. `npm audit --json` reported **zero known vulnerabilities**, including development dependencies. This does not rule out unknown vulnerabilities.
- Source hashes were recorded for the final `src`/`public` tree and remained unchanged through packaging. Packaging uses that tested build directly, without an intervening rebuild.

## Actual separate-track output

The fixture separates the project's own synthetic source into independent H.264 video and AAC audio, deliberately assigning track ID 1 to both sources. Master metadata offers original `(en)` and alternate `(fa)` choices. The alternate rotates the existing AAC samples; it verifies selection, not spoken-language recognition. Encrypted fixtures use Node's independent AES-CBC implementation; runtime uses Chrome Web Crypto.

An ordinary Chrome page decodes the actual file exported by Flux through Save As; only the native picker is substituted with a test destination. All three joined outputs contain **62 video frames and 185 selected AAC samples**, byte-identical to the chosen source samples. Independent decoding verifies **160×90**, duration **4.0832 seconds**, audio duration **3.946333 seconds**, red/green/blue markers and seeks at 0.5/2/3.5 seconds. Original tones are approximately 440/880/1320 Hz; alternate tones are approximately 880/440/880 Hz, with finite-window detection reporting about 460 Hz for its middle window. RMS is approximately 0.0706.

| Selected input                        | Actual output bytes | SHA-256                                                            |
| ------------------------------------- | ------------------- | ------------------------------------------------------------------ |
| Separate fMP4 original audio          | 53,101              | `33607a3932d6ecdd1c28a2bbdac8f812cb0e854052e2f00e69f8bef5b982cf64` |
| Separate fMP4 alternate audio         | 53,101              | `3009eb4555cb32473be564240fdf9719cfb69c24b43f7387753c3d9397d63a67` |
| AES-128 separate fMP4 alternate audio | 53,101              | `3009eb4555cb32473be564240fdf9719cfb69c24b43f7387753c3d9397d63a67` |

Exact evidence: [original selection](separate-original-playback-proof-0.10.json), [alternate selection](separate-alternate-playback-proof-0.10.json), [encrypted alternate selection](aes-separate-playback-proof-0.10.json). Existing clear/AES muxed fMP4 and TS playback remains covered.

Both clear and encrypted separate-track jobs retain paired initialization and first media through a failing later part and full Chrome close/relaunch. Resume verifies both source members, fetches their retained media using HEAD only, preserves the selected label and reaches the uninterrupted output hash. Missing audio-CDN access fails before fetching the video initialization. HTTP cases independently exercise a changed weak-validator companion, initial timestamp drift, failed metadata commit and compound allowance boundaries.

## Integration and session evidence

Actual Chrome verifies the approved source-cookie GET succeeds, unchecking the cookie control produces the expected 401, and a redirected CDN with its own session cookie receives no cookie. POST/referrer-bound downloads retain their original Chrome request and controls. Page-generated blob/data downloads preserve exact text, filenames, hashes and destination bytes; the blob case spans multiple 256 KiB message chunks. Script-triggered blob handoff removes the original Chrome copy after verified staging. Received page files expose a read-only source and cannot offer ordinary redownload. Exclusions, capture disable, popup confirmation, queue choice and stale content-script fallback remain covered.

The conservative page-file admission cap is 1 GiB, not a measured 1 GiB ingestion result. The content script obtains a browser Blob before slicing; bounded JSON messages do not establish total native/browser memory. Incomplete ingestion must be recreated on its website. The fallback can also depend on whether the page has already revoked its original blob URL.

## Live link and capacity

The supplied Soft98 link was exercised with a terminated background worker. The final-build broad invocation downloaded **3,574,116 bytes**, four ranges, final host `edge11.82.ir.cdn.ir`, SHA-256 `1bea6dd8e2befc9bb1ff1b090c9c8d6e954a390278980dc776df695ff9de6e02`, matching an independent browser response. [Exact live evidence](live-link-result-0.10.json) omits the signed URL query.

A **100 MiB** transfer, persisted verification and streamed test export ran in Chrome. Earlier successful 1 GiB HTTP evidence remains historical; it was not repeated here. 5/10 GiB, macOS, native picker/permission consent, power loss, long-media workload and total process peak memory remain unproven. Disk headroom was about 1.8 GiB during verification. No fresh performance benchmark or IDM comparison is claimed for the complete 0.10 package.

## Exact package and installation

`releases/flux-0.10.0.zip` contains **232,130 bytes and 16 files**. Windows tar extracted it; every extracted file hash matches `dist`. Manifest permission/CSP fields match 0.9. Archive SHA-256:

```text
8124a847b2726b38ed8687fee02fd051fcda850a22d1fafbc4ecf12510deadc5
```

After all checks passed, the configured existing installation folder `releases/flux-0.5.0` was updated in place from **0.7.0 to 0.10.0**, with all 16 shipped file hashes verified against the tested release. A recoverable copy is retained at `releases/install-backups/before-0.10-20261021-164520`. Required/optional permissions and CSP were checked before copying; old hashed assets remain so an open old page can still resolve its chunks. The original 0.5 ZIP is untouched. See [installation record](installation-update-0.10.json).

The user still needs to click **Reload on the existing Flux card** in `chrome://extensions`, then reopen the manager and refresh download pages. The last human-confirmed active runtime was 0.7; this milestone does not claim that 0.10 has already activated in that profile. Loading another unpacked folder creates a separate extension identity/storage.

## Remaining scope

Separate composition currently requires completed fMP4 video-only and audio-only renditions with supported codecs and strict alignment checks. Separate TS audio, continuous TS between keyframes, split program sections, other ordinary encryption, discontinuities/live recording, DASH, recursive site projects and localization remain unfinished. DRM remains unsupported. See [source review](code-review-0.10.md), [media acceptance](media-feasibility.md) and the [full capability audit](feature-parity.md).
