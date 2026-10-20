# Verification evidence - Flux 0.3.0

Historical milestone. [0.4 verification](verification-0.4.md) records the later successful isolated 1 GiB retry with more disk headroom, along with advanced scheduling and allowance coverage. The original failed export below remains part of the history.

Environment: Windows, Chrome 155.0.8059.82, Node 24.18.1 and npm 11.16.0. This is a compatibility and feature milestone in the ongoing [capability audit](feature-parity.md), not completed IDM/AB parity or production acceptance.

## Confirmed reported failure and repair

The 0.2.0 build was tested with only a single fixture-origin grant. Ordinary same-host redirects and missing-CDN permission reporting passed. After the background service-worker target was terminated, a new transfer failed with the user's exact message:

```text
The redirect destination could not be read. Retry the download.
```

The network response arrived before its observer was active. Snapshot polling can hide this bug by waking the background. The repaired engine explicitly prepares observation and receives acknowledgement before each request. The regression observes the manager DOM without background polling; it passes after the repair. The worker remains event-driven with no keepalive loop.

## Executed evidence

- `npm run check` passed: strict TypeScript, **109 unit/integration tests** across 11 files, build and package audit. Final unit/integration duration was 23.39 seconds. Final build audit: 15 files, about 428.2 KiB unpacked.
- The subsequent final storage-recovery build passed **20 Chrome tests in 1.2 minutes** with `LARGE_FILE_MIB=100`, the supplied live URL, and `FLUX_COLD_BACKGROUND=1`. This includes the extra page-discovery/list-export workflow. That command did not repeat the 1 GiB export; its failed result below remains part of the acceptance record.
- A final parent-page exclusion guard was then checked with **13 capture/redirect tests passing in 20.2 seconds**, including an allowed CDN iframe inside an excluded top-level site. Bulk cancellation/removal require explicit confirmation before staged data is deleted.
- Twelve focused Chrome tests passed in 18.8 seconds: ordinary/download-attribute/cross-origin link capture, new iframe capture, durable native GET takeover, POST/cookie-session preservation, real named-queue batch transfers, expired URL replacement, source exclusion, disabling existing scripts, automatic verified export with collision avoidance through manager reload, and narrow-grant/cold-worker redirects.
- The expanded 20-test run passed **19 tests**. It included actual Chrome process-context restart, manager closure and ownership, forced background termination, direct-link capture, the real Soft98 resource with the background stopped first, and a complete 100 MiB download/verification/export with independent byte validation.
- The remaining 1 GiB case downloaded and verified its source bytes but its additional OPFS test export hit `QuotaExceededError`; it did **not** complete export in this run. The staged job stayed Ready to save. About 2.1 GB of physical free disk remained after test cleanup. Browser quota estimates did not guarantee enough physical capacity for the additional copy. Do not report this run as 20/20 or claim current 1 GiB end-to-end acceptance.
- That pressure also exposed a closed IndexedDB connection. The repository now reconnects once when transaction creation fails with `InvalidStateError`, before any write was submitted; it never replays an already committed transaction. A dedicated regression verifies the retained job and a later batch commit. Storage errors now explain how to free space or choose another destination while retaining verified data.

## New workflows

Named queues apply independent concurrency, start/stop, bandwidth pacing, and daily/overnight windows below the global limits. Integration coverage verifies that a stopped queue does not start jobs, one queue's active-file limit does not consume another queue's free slot, and stopping an active queue retains queued ownership for later continuation. Batch validation precedes a single metadata transaction; duplicate pending URLs are skipped. Text/JSON imports and numbered URL patterns have parsing and unsafe-input tests.

Expired addresses can be replaced on a stopped unfinished job. The same job/checkpoints remain available, and resume uses the original identity validator; a changed final URL restarts safely. Matching an ETag on an unrelated new URL is not treated as proof of identical content.

Automatic folder export serializes filename selection and checks stored bytes again before destination commit. Existing filenames receive numbered suffixes; three separately downloaded files were independently hashed while the pre-existing file remained unchanged. The directory handle survived manager reload in Chrome.

The final browser acceptance also exercised page link discovery with rejection of a private-address link, filtered selected import, selected resume with correct file bytes, paste/drop review events, and exported JSON lists. These are live extension UI paths, not mocked manager calls. Clipboard/drop data was provided as browser DOM events; OS clipboard transport itself was not automated.

The folder and Save As tests substitute real OPFS destination handles for native dialogs. Native directory-picker consent, operating-system destinations/overwrite dialogs, and renewed external-folder permission prompts remain manual acceptance gates. This does not establish arbitrary filesystem access. Tests use temporary extension copies with fixture host grants; no grants, loopback exceptions, or test flags ship.

## Live Soft98 result

The supplied URL traversed `dl2.soft98.ir` → `dl2soft98.82.ir.cdn.ir` → `edge11.82.ir.cdn.ir`. With the background service worker stopped before adding the URL, Flux staged and verified **3,574,116 bytes**, and a separate browser fetch matched SHA-256:

```text
1bea6dd8e2befc9bb1ff1b090c9c8d6e954a390278980dc776df695ff9de6e02
```

ZIP magic bytes were checked; no content was executed. The live test waits on the actual manager DOM before requesting its final snapshot, so background polling cannot conceal startup failure. URL query parameters are omitted from this report.

The final cold-background live response is preserved in [live-link-result-0.3.json](live-link-result-0.3.json).

## Remaining acceptance

The [capability audit](feature-parity.md) preserves remaining feasible features instead of declaring the broad goal complete. Native permission UI, OS power loss, macOS, 5/10 GB capacities and process-wide memory profiling remain unverified. The current 1 GiB export needs adequate free disk and a fresh end-to-end acceptance run. Earlier 0.1/0.2 capacity and benchmark results are historical evidence, not a replacement for this failed export run.

## Package

The audited final build was packaged as `releases/flux-0.3.0.zip`: **141,596 bytes, 15 files**. Windows tar extracted it; every extracted file's SHA-256 matched the built `dist` file, and the root manifest reports 0.3.0. The extracted directory `releases/flux-0.3.0` can be loaded unpacked. Archive SHA-256:

```text
791978378095423876155fd38141e437a2433ede77ddc20feaa561a66aea9c30
```

The final destructive selected-action confirmation/list-export test also passed in Chrome (1.6 seconds). Exported destination files are preserved when staged downloads are removed or canceled.
