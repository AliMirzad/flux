# Verification evidence — Flux 0.8.0

Date: 2026-10-21. Windows, Chrome 155.0.8059.85, Node 24.18.1. This milestone adds a tested subset of MPEG-TS HLS conversion; the complete IDM/AB request remains active.

## Checks and package

- Strict TypeScript, production build and MV3 package audit passed: 16 files, approximately 618.9 KiB unpacked. Manifest permission, optional-host and CSP fields match 0.7 exactly.
- All **172 unit/integration tests in 18 files passed**, in **25.40 seconds**. New coverage includes TS packet/CRC/continuity validation, malformed AAC termination and frame budget, child cancellation/deadline cleanup, encoded sample identity, clock rollover and transformed checkpoint rollback/recovery.
- The full Chrome run passed **41 tests in 2.3 minutes**, with a 100 MiB streaming export. Its live-site test was skipped because the first invocation used incorrectly named environment variables. A separate run with `FLUX_LIVE_URL` and `FLUX_COLD_BACKGROUND=1` then passed that test in **9.0 seconds**. Thus all 42 distinct browser cases passed across those two invocations; no skipped live-site check is counted as a pass.
- `npm audit --json` reported zero known vulnerabilities, including development dependencies. Vendor regeneration reproduced the checked-in patched module. Formatting and the package audit were checked separately.
- ZIP: `releases/flux-0.8.0.zip`, **202,171 bytes**, **16 files**. Windows tar extraction and independent per-file SHA-256 comparison matched every tested `dist` file. Archive SHA-256:

```text
27e7339082391563f248a3d080804474b301ca649a4c51d8579ef1d074f45022
```

## Actual media output

The fixture generator packetizes the project's own synthetic H.264/AAC source into four MPEG-TS parts totaling 82,908 source bytes. The actual extension reviews the HLS playlist, converts it in packaged child workers, checkpoints the output, verifies it and exports through Save As. Only the native picker is substituted by an OPFS destination. An ordinary Chrome page independently decodes the exported bytes.

TS-derived MP4: **54,156 bytes**, SHA-256 `885722613652e6b601d824c62e7633a0a045595d91a2741b522ef920fde210ab`. Duration **4.0832 seconds**, **160×90**. Seeks at 0.5/2/3.5 seconds show red/green/blue; decoded audio windows contain **440/880/1320 Hz**, RMS approximately 0.0707. Audio duration is 3.946667 seconds. Every one of **62 encoded video frames and 185 AAC samples** matches the original source; container/timing metadata and added AVC parameter sets are excluded from that payload comparison. See [TS proof](ts-playback-proof-0.8.json).

The preexisting fMP4 path also independently decodes, seeks and retains exact original bytes: 52,973 bytes, SHA-256 `b401e2699b342d4e446ef5b8e6450b52de596c449e1bda37fd34227979297b07`. See [fMP4 proof](hls-playback-proof-0.8.json).

Both containers survive a failing second part followed by a full Chrome-context restart. The first committed source receives one original GET and one resume HEAD; its output checkpoint remains identical and the final checksum matches uninterrupted output. A malformed zero-length ADTS frame fails with no committed part or checksum, and the next normal TS job completes in the same manager. Missing-CDN-grant and page-discovery cases remain covered.

## Live link and installed state

The supplied Soft98 public URL completed after background termination: **3,574,116 bytes**, four ranges, SHA-256 `1bea6dd8e2befc9bb1ff1b090c9c8d6e954a390278980dc776df695ff9de6e02`. An independent browser response matched; see [live result](live-link-result-0.8.json). This test uses an isolated profile and does not replace the human's installed-profile evidence.

The user confirmed that **0.7.0 is active and downloading** after reloading the existing installation. That installed folder remains on 0.7; the separately packaged 0.8 release is not yet claimed active there. Loading another path would create a separate extension identity and local storage, so do not use a new Load unpacked path merely to update the existing installation.

## Scope and remaining work

Supported TS is completed, unencrypted H.264/AAC with independently decodable parts no larger than 16 MiB, supported single-program PAT/PMT, access-unit delimiters and keyframe starts. Missing/duplicate packets, invalid CRC, unsupported metadata/codecs and discontinuities are refused. Conversion is local; no native helper, backend, permission expansion or keepalive was added.

Continuous non-keyframe TS, split program sections, separate audio/languages, ordinary non-DRM encryption, live recording and DASH remain unfinished. Short media and input bounds do not prove long presentation synchronization or peak total-process memory. Native dialogs, macOS, power loss and 5/10 GiB remain unproven; the earlier 1 GiB result belongs to [0.4](verification-0.4.md). See [source review](code-review-0.8.md) and the [full capability audit](feature-parity.md).
