# Verification evidence — Flux 0.1.0

Historical evidence for 0.1.0. Current capture and redirect behavior is recorded in [0.2.0 verification](verification-0.2.md); refusal/offer semantics below describe the earlier build.

Recorded 2026-10-19 on Windows, Node 24.18.1, npm 11.16.0, installed Chrome 155.0.8059.82. This is an engineering preview. Passing these checks does not establish general production readiness or full IDM parity.

## Executed checks

| Check                                              | Actual result                                                                                                                                              |
| -------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run check`                                    | Strict TypeScript, 93 unit/integration tests across 9 files, and release build passed. Tests completed in 23.76 seconds in the final combined run.         |
| Chrome Playwright suite, `LARGE_FILE_MIB=100,1024` | All 7 browser tests passed in 2.1 minutes.                                                                                                                 |
| Package audit                                      | 15 files, about 381.6 KiB unpacked; MV3, optional host permissions, local executable assets, no eval/Function construction or remote HTML assets detected. |
| Dependency audit                                   | Zero reported vulnerabilities after upgrading the initially vulnerable Vitest dependency. Final cached audit used the freshly retrieved advisory data.     |
| Formatting                                         | Prettier check passed; generated benchmark files formatted afterward.                                                                                      |
| Benchmark                                          | 18 final runs, three per mode, all checksums correct, no failures. See [measurements and raw data](benchmark-results.md).                                  |
| Release archive                                    | Portable Node ZIP writer produced a standard ZIP. Windows `tar` listed/extracted it; extracted file SHA-256 values were compared against `dist`.           |

The browser suite loaded a temporary copy of the actual build with only a fixture host grant added to its manifest. A public-looking fixture hostname mapped to loopback, with test-only local-network flags. No local-address bypass, pregranted host access, debugging permission, or fixture server ships in the release. Playwright Chromium download was unavailable (regional HTTP 403), so the installed Chrome route used the documented CDP extension-load API in an isolated profile.

## Demonstrated behavior

- Real overlapping ranged HTTP fetches, exact boundaries/coverage, OPFS random writes and flushes, streamed persisted-byte verification, final SHA-256, and safe single-stream fallback.
- Real-network fixtures for ignored/incorrect ranges, disconnects, throttling/429, temporary 503, truncated bodies, changed ETags, missing length, authentication/expiration errors, redirect refusal and corruption.
- Persisted range reuse after pause, changed-resource restart, corruption rejection, and deterministic cleanup of in-flight writes before closing storage.
- Actual manager closure/reopen and an actual Chrome browser-context process close/relaunch with the same test profile, restoring and resuming a 12 MiB job. This is a graceful restart, not an OS crash or power-loss test.
- Service-worker target termination during a 16 MiB transfer; the manager-owned dedicated worker continued and produced the correct hash. The test explicitly terminated the service worker through DevTools; it did not measure natural idle expiry.
- Multiple manager tabs cannot both own execution. Popup, URL-prefilled review, redirect failure display, persisted settings, and dark/light/420px layouts exercised in Chrome.
- Unit/integration coverage for queue priority/order, daily/overnight windows, pause at closing/resume at opening, no idle window polling, shared host limits, adaptive backoff, live global limiter changes, canceled budget removal, metadata failure, picker/removal races, export corruption, and destination-commit/history-write failure.

## Large-file evidence

| Size                        | Transfer | Final source SHA-256 | Streamed test export | Independent exported-byte validation    | Recovery at this size |
| --------------------------- | -------- | -------------------- | -------------------- | --------------------------------------- | --------------------- |
| 100 MiB (104,857,600 bytes) | Passed   | Matched              | Passed               | Every byte matched deterministic source | Not tested            |
| 1 GiB (1,073,741,824 bytes) | Passed   | Matched              | Passed               | Every byte matched deterministic source | Not tested            |
| 5 GB / 5 GiB                | Not run  | Unverified           | Unverified           | Unverified                              | Unverified            |
| 10 GB / 10 GiB              | Not run  | Unverified           | Unverified           | Unverified                              | Unverified            |

The browser tests substitute an OPFS file handle for `showSaveFilePicker`, retaining the real browser streaming/write path and checksum gate while avoiding a native operating-system dialog. This does **not** verify user-visible filesystem destinations, native overwrite/collision dialogs, Safe Browsing decisions for those destinations, or OS permission failures. No whole-file application buffer is used for these large-file validations. Total browser RSS, worker/native buffer peaks, and production disk behavior remain unprofiled. About 3.9 GB of free disk was available initially, insufficient for staged plus exported 5/10 GB files; those capacities are not advertised as verified.

## Final benchmark snapshot

8 MiB file, HTTP/1.1, 16 KiB fixture writes paced at 16 ms per response, three repetitions per mode. Median MiB/s: native Chrome **0.57**, Flux single **0.59**, four **2.15**, eight **2.22**, sixteen **2.21**, adaptive **0.77**. Up to six simultaneous requests reached the fixture for 8/16 modes. Conservative adaptation was slower than manual four connections on this short workload. Native completion timing includes independent disk hashing; Flux timing ends at verified OPFS staging and excludes final export. These are not equivalent full user-destination completion measurements and establish no Internet speed multiplier.

[Earlier 16 MiB / 32 ms raw baseline](benchmark-baseline-data.json) used an earlier implementation snapshot before the final persisted-segment verification and limiter refinements; it is supplementary and is not merged with the final measurements.

## Remaining release gates and constraints

- Native Save As, permission-grant/denial/revocation prompts, notification delivery, opt-in content/native offers, and direct media discovery need additional manual acceptance testing on real websites.
- macOS, minimum-version Chrome 120, real Internet HTTP/2/3 behavior, multi-gigabyte crash recovery, physical quota exhaustion, power-loss durability, total memory/idle CPU, and Chrome Web Store review remain unverified. Quota and persistence errors are fault injected in automated tests.
- Redirect following, cookie/header forwarding, POST/blob/dynamic downloads, DRM/HLS assembly, and transfer while Chrome/manager is closed are intentionally unsupported. Browser fallback is explicit.
- Public-host DNS rebinding cannot be completely prevented by browser fetch; host grants and user review remain essential. See [security review](security.md).

Release ZIP: `releases/flux-0.1.0.zip`, 127,600 bytes, 15 files. SHA-256: `20421c421f0e59ffc71cb3aa9297f8c72aeda234f6823b369ef278993bf331ed`. The package contains only `dist` contents and third-party notices, with no test server, development dependencies, or native helper.
