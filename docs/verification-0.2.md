# Verification evidence - Flux 0.2.0

Historical evidence. [0.3 verification](verification-0.3.md) documents a subsequently reproduced background-startup redirect failure, its repair, and current export/storage acceptance limits.

Environment: Windows, Node 24.18.1, npm 11.16.0, installed Chrome 155.0.8059.82. This report covers the automatic capture and redirect fixes; it does not establish universal compatibility or production readiness.

## Executed checks

| Check                                                                             | Actual result                                                                                                                                                         |
| --------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run check`                                                                   | Strict TypeScript, 100 unit/integration tests across 10 files, build and package audit passed. Final test duration: 23.94 seconds.                                    |
| Full Chrome suite with `LARGE_FILE_MIB=100,1024` and the supplied `FLUX_LIVE_URL` | 13 tests passed in 2.5 minutes before the final excluded-source guard. Includes capture, redirects, lifecycle, 100 MiB, 1 GiB, and the real Soft98 file.              |
| Final capture regression suite                                                    | All six tests passed in 12.5 seconds after adding excluded-source protection, including the new cross-origin exclusion case.                                          |
| Final supplied-URL check                                                          | Passed again against the final build in 14.0 seconds; results are recorded below and in [live-link-result.json](live-link-result.json).                               |
| Package audit                                                                     | 15 distributable files, about 402.5 KiB unpacked, MV3, optional host access, bundled executable assets. No eval/Function construction or remote HTML assets detected. |

The capture tests loaded a temporary copy of the actual build with HTTP/HTTPS hosts pregranted, allowing the real enable action to run without automating Chrome's permission prompt. Fixture hostnames resolve to loopback through test-only Chrome flags. The live test grants HTTPS access to its temporary test copy. These grants and flags do not ship. Native permission-consent UI remains a manual acceptance step.

## Capture behavior demonstrated in Chrome

- Enabling capture applies to a tab opened before enablement. Normal file links, explicit download attributes, and cross-origin links start real Flux transfers with correct hashes and no native Chrome download entry. Repeated clicks do not enqueue a duplicate active job.
- Generated public GET downloads are paused, probed, durably queued, canceled in Chrome, and completed in Flux. The native entry is interrupted and the replacement job leaves its held state.
- Cookie-authenticated anchors, cookie-authenticated generated downloads, and POST downloads finish in Chrome without a failing replacement job. No cookies or authorization headers are copied.
- An excluded source site retains Chrome ownership even when its generated download points at another CDN host. Disabling capture affects already-injected pages.
- Same-host and cross-host redirects finish correctly. A private redirect target is rejected before the target route receives a request.

## Supplied Soft98 URL

The supplied WinRAR ZIP URL returned two CDN redirects:

`dl2.soft98.ir` → `dl2soft98.82.ir.cdn.ir` → `edge11.82.ir.cdn.ir`

The previous build refused the first redirect. The corrected build resolves each hop after validating its address and permission. A minimal GET received `206` with `Content-Range: bytes 0-0/3574116`. The real extension downloaded, stored, and verified all **3,574,116 bytes**, using four verified segments in the final repeat. Its SHA-256 matched a separate browser fetch of the final resource:

```text
1bea6dd8e2befc9bb1ff1b090c9c8d6e954a390278980dc776df695ff9de6e02
```

The independent response also had ZIP magic bytes. No downloaded executable or archive content was executed. The report omits the URL's query parameter. This verifies the supplied response at test time; signed links and server behavior can change.

## Lifecycle, export, and remaining limits

The full Chrome run retained the existing tests for parallel output/hash/export, pause and browser-context restart, manager closure, single execution ownership, context-menu prefill, and service-worker termination while a manager-owned transfer continues. It also completed download, verification, and streamed export for 100 MiB and 1 GiB with independent deterministic-byte checks. The dedicated worker streams to OPFS; the manager must remain open.

Export tests substitute an OPFS destination handle for the operating system's Save As picker. Native destination selection, overwrite prompts, OS permission failures, macOS, full OS shutdown/power loss, 5/10 GB capacity, and total browser RSS/native-buffer profiling remain unverified. No fixed acceleration or IDM parity is claimed. Existing [benchmarks](benchmark-results.md) describe the earlier 0.1.0 snapshot and were not rerun for this compatibility fix.

## Release

`npm run release` produced `releases/flux-0.2.0.zip`: 134,775 bytes, 15 files. Windows `tar` extracted the archive and each extracted file's SHA-256 matched `dist`; the root manifest reports 0.2.0. Archive SHA-256:

```text
6483486e4dca6b5dd4daaa29cc4793f475a423e936fa37af1bcf160a4e01a5b2
```

The archive contains only the built extension. Extract it before Load unpacked; existing `dist` installations need Reload, followed by **Enable automatic downloads** and website access approval. Capture remains opt-in after an upgrade. A verified extracted copy is available at `releases/flux-0.2.0` for direct Load unpacked.
