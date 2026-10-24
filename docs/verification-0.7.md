# Verification evidence - Flux 0.7.0

Date: 2026-10-21. Environment: Windows, Chrome 155.0.8059.85, Node 24.18.1. This milestone implements a tested HLS MP4 VOD path and fixes reviewed capture/storage/export failures. The complete IDM/AB capability request remains active.

## Final checks

- Strict TypeScript, production build and package audit passed. The package contains 15 files, approximately 514.6 KiB unpacked, with no new manifest permission or runtime dependency.
- All **158 unit/integration tests across 16 files passed**, in **25.97 seconds**. Additional regressions cover exact media byte ranges, nonzero timestamp origins, weak-validator source changes, corrupt fragments/staging, checkpoint failure rollback, compound-key deletion, atomic precloning and both destination history-failure paths.
- The complete **39-test Chrome suite passed in 2.2 minutes**, with `LARGE_FILE_MIB=100`, the supplied Soft98 URL and `FLUX_COLD_BACKGROUND=1`. It covers full-browser recovery, background termination, capture/exclusions, original POST/session/blob/data downloads, queues/calendars/retries/allowance, destinations, a streamed 100 MiB export and actual HLS playback.
- `npm run format:check`, `npm audit --json` and `npm audit --omit=dev --json` passed. Both audit queries reported zero known vulnerabilities at the time of the check; this is not a guarantee against unknown issues.

## Reproduced click failure

An already-open website retained its old content listener after the extension context was invalidated. The listener prevented the click and then synchronously threw while trying to message Chrome. The original test observed no native download for ten seconds. The fixed script checks runtime availability before interception, handles synchronous messaging failure through the ordinary browser fallback and replaces its previous listener during reinjection. The same real-Chrome regression now starts the original browser download. Normal capture/reconnect tests still start Flux without native duplicates, including an iframe that existed before opt-in.

The test invalidates a CDP-loaded fixture extension with runtime.reload. That entry does not automatically re-enable like a normal installed-card Reload, so actual UI Reload/re-enable remains separately unverified. Refresh older website tabs once when upgrading from 0.5 so their earlier script is replaced.

## Media evidence

The extension reviews an HLS master, selects its rendition, streams initialization and four logical media parts into OPFS and exports an ordinary MP4 through the real application Save As path. Only the native picker is substituted with an OPFS destination. An independent ordinary Chrome page decodes those exported bytes and seeks to visual/audio markers. Output is 52,973 bytes; SHA-256 matches the synthetic source:

```text
b401e2699b342d4e446ef5b8e6450b52de596c449e1bda37fd34227979297b07
```

Duration: 4.0832 seconds, 160×90. At 0.5/2/3.5 seconds, decoded frames are red/green/blue and audio windows contain 440/880/1320 Hz with RMS about 0.0707. The decoded audio duration is 3.9463 seconds. Exact results are in [playback proof](hls-playback-proof-0.7.json).

A failing second media part preserves initialization and the first part. A complete Chrome-context restart restores the same job and checkpoints; retry revalidates the old first part with HEAD and does not replay its GET payload. Final output retains the independent hash. A missing CDN grant stops before that host's payload fetch and retains initialization. Page discovery opens HLS review without enqueueing a raw playlist as video.

Support is limited to completed, unencrypted fMP4 H.264/AAC renditions with selected tracks already together. The [media contract](media-feasibility.md) retains unfinished MPEG-TS, separate audio/languages, encryption, live/discontinuity and DASH work. Short-file playback does not prove long timelines, broad codec compatibility or peak total-process memory.

## Live link and destination integrity

The supplied Soft98 URL completed after background termination: 3,574,116 bytes, four verified ranges and SHA-256 `1bea6dd8e2befc9bb1ff1b090c9c8d6e954a390278980dc776df695ff9de6e02`. An independent browser response matched its size and checksum; see [live evidence](live-link-result-0.7.json). This evidence uses an isolated Chrome profile with a test grant, not the user's live profile.

Actual default Downloads/category saving and Save again complete in Chrome. A regression then changes one staged byte, retries saving and confirms a SHA-256 refusal before any new Chrome download ID appears. The earlier successful destination remains intact. Manager tests inject a history-commit failure after successful destination completion for both saving paths and retain completed state.

## Package and installed path

`releases/flux-0.7.0.zip` contains **168,685 bytes and 15 files**. Windows tar extracted it, and every extracted file hash matches `dist`. Archive SHA-256:

```text
36940bb6fe652d66641ad24ecc43b97ddaa718373a1995ed33aa771a513b64d1
```

Read-only Chrome configuration inspection found the existing extension ID configured to load this workspace's `releases/flux-0.5.0` folder. Broad HTTP/HTTPS access was present, but its IndexedDB capture switch and live runtime errors were not inferred from permissions. After backing up that folder, the verified 0.7 build was copied into that **same absolute installation path**; the 15 copied file hashes match the build and permissions are unchanged. Older hashed assets were retained for still-open extension pages. The original 0.5 ZIP remains unchanged. Details are in [installation update](installation-update-0.7.json).

Chrome still needs **Reload on that existing extension card**, then a website Refresh. Settings → Check download integration reports the actual loaded version and integration state. The user subsequently confirmed: version 0.7.0 is active and the download starts. This closes the reported installed-profile startup failure for that confirmation; it does not certify every site or permission-dialog flow. A different unpacked path would create a different extension ID and separate local data.

Native consent dialogs, macOS, power loss, sustained/total-process memory and 5/10 GiB acceptance remain unproven. The prior 1 GiB result belongs to [0.4 evidence](verification-0.4.md); it is not rerun or enlarged by the 100 MiB result here. See [source review](code-review-0.7.md) for findings and remaining work.
