# Verification evidence — Flux 0.9.0

Date: 2026-10-21. Windows, Chrome 155.0.8059.85, Node 24.18.1. This milestone implements ordinary identity AES-128 HLS for the existing supported MP4/TS containers. The broader capability goal remains active.

## Final source and checks

- Strict TypeScript, production build and MV3 package audit passed: **16 files, approximately 637.0 KiB unpacked**. Manifest permissions, optional hosts and CSP match 0.8. No additional dependency or external processing service was added.
- **182 unit/integration tests in 19 files passed in 25.83 seconds**. New cases cover key/IV metadata, key rotation/clear transitions, encrypted initialization and byte ranges, exact clear-path output equality, changed key refusal/recovery, weak-validator ciphertext replay, malformed key/padding, key-stream cancellation, size/allowance boundaries and tiny network chunks across fixed buffer boundaries.
- The final full Chrome run passed **47 of 48 cases in 4.6 minutes**. Its only failure was the supplied public live URL reporting **Failed to fetch** before any data was committed. The preceding 0.9 candidate had passed that live check. A subsequent isolated run on the **same final build**, with a terminated background worker, passed in **9.8 seconds** and independently matched the file hash. All 48 distinct cases therefore have passes across those final two invocations; the full single invocation was not green. The cause of the one public-site fetch failure was not established.
- The first broad candidate run also found a queue-chooser test waiting for Manage queues while the previous test left Settings open. That test was being edited concurrently; the current version navigates back to All downloads and passes on the final build. It confirms a held capture, no duplicate native download, popup queue choice and correct final transfer. No concurrent source changes were found between the final build snapshot and packaging.
- Formatting passed. `npm audit --json` reported **zero known vulnerabilities**, including development packages. This is not a guarantee against unknown issues.

## Actual AES-128 output

The fixture uses Node's independent CBC implementation to encrypt the project's own synthetic media. Initialization uses an explicit IV; media exercises sequence-derived IVs, rotated keys, an explicit alternate IV and a clear part. Runtime decryption uses Chrome Web Crypto. An ordinary Chrome page decodes the actual file exported by Flux through Save As; only the native picker is substituted with an OPFS destination.

| Input               | Actual exported bytes | SHA-256                                                            |
| ------------------- | --------------------- | ------------------------------------------------------------------ |
| AES-128 fMP4 HLS    | 52,973                | `b401e2699b342d4e446ef5b8e6450b52de596c449e1bda37fd34227979297b07` |
| AES-128 MPEG-TS HLS | 54,156                | `885722613652e6b601d824c62e7633a0a045595d91a2741b522ef920fde210ab` |

Both outputs equal their clear-path output hashes and preserve every **62 encoded video frames and 185 AAC samples** from the original source. Independent playback has duration **4.0832 seconds**, dimensions **160×90**, red/green/blue seek markers at 0.5/2/3.5 seconds and **440/880/1320 Hz** audio with RMS approximately 0.0707. Audio duration is 3.946333 seconds for fMP4 and 3.946667 seconds for TS. Exact results: [AES fMP4 proof](aes-hls-playback-proof-0.9.json), [AES TS proof](aes-ts-playback-proof-0.9.json).

Both encrypted containers retain the first committed logical media part through a failing next part and full Chrome restart. Resume fetches the retained ciphertext with HEAD only, revalidates key fingerprints, preserves its output checkpoint and produces the uninterrupted output hash. A missing key-origin grant stops before fetching encrypted initialization. The clear-media regressions remain covered.

## Live link

The isolated final-build rerun produced **3,574,116 bytes**, four ranges and SHA-256 `1bea6dd8e2befc9bb1ff1b090c9c8d6e954a390278980dc776df695ff9de6e02`, matching an independent browser response. Its final host was `edge11.82.ir.cdn.ir`. See [live result](live-link-result-0.9.json). The test now records only host/error pairs for failed network requests and inspects the job only after a visible failure, preserving the cold-background test boundary and avoiding signed query logging.

## Exact package and installed state

`releases/flux-0.9.0.zip` contains **207,231 bytes and 16 files**. Windows tar extracted it; every file hash matches the final tested `dist` output, and permission/CSP fields match the 0.8 package. Archive SHA-256:

```text
afc29eec2aedf672e32669cd20dd61435bde1161b9b8431564eeaeef9b68e96b
```

The configured existing installation folder `releases/flux-0.5.0` still contains manifest **0.7.0**. The user confirmed that 0.7 is active and starts downloads. This work did not replace that folder or claim 0.9 activation in the user's profile. Loading a different unpacked folder creates a separate extension identity/storage; it is not an in-place update.

## Limits and remaining scope

Support is ordinary **identity AES-128 CBC/PKCS7**, public key/media URLs and completed H.264/AAC renditions with tracks already together. Encrypted plaintext parts are capped at 16 MiB, initialization at 1 MiB; TS retains its independently decodable part/program limits. Fixed crypto buffers bound part storage and object count, not measured peak browser-process memory. CBC does not authenticate the publisher or media.

Separate audio/languages, continuous TS between keyframes, split program sections, other ordinary encryption methods, discontinuities, live recording, DASH, site crawling and localization remain unfinished. Native dialogs, macOS, power loss and 5/10 GiB remain unproven. Earlier large-file evidence is unchanged; a 100 MiB browser export ran here. See [review findings](code-review-0.9.md), [media contract](media-feasibility.md) and the [complete capability audit](feature-parity.md).
