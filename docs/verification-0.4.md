# Verification evidence - Flux 0.4.0

Environment: Windows, installed Chrome 155.0.8059.82, Node 24.18.1, npm 11.16.0. This milestone implements advanced queue scheduling, periodic runs, completion feedback and a durable shared download allowance. The broader [capability audit](feature-parity.md) remains active.

## Executed checks

- Strict TypeScript, **122 unit/integration tests across 12 files**, build and package audit passed. Final full test duration: **23.65 seconds**. Package audit: 15 files, about 444.0 KiB unpacked after adding the sound activation control.
- The full **23-test Chrome suite passed in 1.8 minutes**, using `LARGE_FILE_MIB=100`, the supplied Soft98 URL and `FLUX_COLD_BACKGROUND=1`. It includes the advanced workflows below, all capture and redirect regressions, browser-context restart, manager ownership/closure, explicit service-worker termination, verified 100 MiB download/export, and the actual CDN resource.
- After free disk increased to about 2.8 GB, the isolated **1 GiB (1,073,741,824 bytes) test passed in 1.2 minutes** against the final build: transfer, final SHA-256, streamed export and independent validation of every exported byte. The profile was cleaned afterward. Recovery at this size and native filesystem destinations remain separate gates.
- Three focused advanced Chrome tests initially passed in 20.5 seconds; the final build passed all three again in **20.7 seconds**, after adding explicit sound activation and the final global-window/periodic guard.
- Formatting and the actual output package are checked separately; no extra runtime dependency, host pattern or manifest permission was added.

## Queue calendar and completion

Unit tests verify weekday ownership for overnight windows, fixed first-start/final-stop bounds, and next selected-week boundaries without minute polling. A real Chrome test creates a Monday-only queue with a 22:00–22:02 window and a first-start date. The manager clock advances across opening, closing and the next selected Monday; real HTTP and OPFS operations remain active. The transfer starts, pauses, resumes and ends with the expected 3 MiB digest. Stop-after-verification then persists the stopped queue state.

Periodic queues retain the earlier verified job and create a new job/file for each unique non-canceled address. A real Chrome test advances the manager clock by one minute, gets two distinct copies, and independently matches their SHA-256 values to the deterministic fixture. New jobs and clearing the due marker commit in one IDB transaction. Integration coverage checks that atomic state and a due repeat waking at a later global-window opening, even when all earlier files are already verified.

An integration test verifies exactly one queue notification and no second notification-permission request when the completed queue stops. Queue completion means all files are verified; destination saving can still be pending. The actual OS notification display remains a manual platform check.

## Download allowance

The allowance persists a shared window and reservations before accepting payload. Ranges are authorized before fetching; when one range is refused, already-authorized sibling ranges finish instead of being aborted. Allowance mode keeps dispatched ranges at or below 1 MiB while retaining bounded range descriptors. Interrupted attempts and shared unused credit are conservatively counted. Browser prefetch buffers, headers, probes, other apps and native Chrome transfers are outside this accounting.

The real HTTP integration test downloads a 3 MiB resource under a 1 MiB allowance across three simulated windows. It preserves one additional complete checkpoint per window and requests each payload range exactly once. Final stored bytes and SHA-256 match the source. This guards against a low allowance repeatedly losing every partial segment.

The Chrome acceptance test exhausts a 1 MiB allowance, verifies a complete OPFS checkpoint, reloads the manager, confirms the paused state and no new transfer, then raises the allowance. It resumes only missing ranges and matches the final 3 MiB digest. Exact reset-time resumption, manual pause-all canceling automatic resumption, active-stream reconfiguration, concurrent reservation serialization, durable credit across restart and persistence failure paths have separate integration/unit coverage.

Known-size, non-resumable files larger than an entire allowance require an increased/disabled limit rather than an endless scheduled restart. An allowance measures authorized Flux payload, not an exact billable ISP or whole-device byte total.

## Sound and live-site evidence

The sound preference activates a local Web Audio context in a user gesture. Chrome tests instrument the native context and confirm oscillator creation for completion; the Test completion sound button restores activation after reopening. Speaker output, device volume and OS sound routing are not automatically verified. No remote sound asset or telemetry request is used.

The supplied Soft98 resource was again downloaded after terminating the background before adding the URL. It traversed two CDN hops and yielded **3,574,116 bytes** with matching independent SHA-256:

```text
1bea6dd8e2befc9bb1ff1b090c9c8d6e954a390278980dc776df695ff9de6e02
```

The response record is preserved in [live-link-result-0.4.json](live-link-result-0.4.json). The test observes the manager DOM before asking for a final snapshot, preventing polling from concealing background-startup failures. URL queries are omitted from the evidence file.

## Scope of acceptance

Test extension copies pregrant fixture hosts and use test-only hostname mapping; the shipped manifest retains optional host access. Native permission-consent and filesystem picker dialogs, external-folder OS behavior, macOS, power-loss recovery and total process memory profiling remain unverified. Tests substitute real OPFS destination handles for native save dialogs.

The 0.3 **1 GiB export failure under storage pressure remains part of the acceptance record**. After physical free disk increased from about 2.1 to 2.8 GB, an isolated 1 GiB retry **passed** against the final build. The 0.4 evidence therefore supports 100 MiB and 1 GiB download/verification/test export in this Windows environment, without asserting recovery at those sizes, arbitrary disk conditions, or native destination-dialog behavior. No 5/10 GB capacity claim follows from these runs. Keep the manager and Chrome open for transfers, calendar boundaries and repeated runs.

## Package

`releases/flux-0.4.0.zip` contains **145,755 bytes and 15 files**. Windows tar extracted it, every extracted SHA-256 matched `dist`, and the root manifest reports 0.4.0. The extracted `releases/flux-0.4.0` directory is available for inspection. Archive SHA-256:

```text
7e73c7c0cba398dd1af43f0e7509110102b3d315328f312e86ee93327c2447cf
```

For an upgrade, retain the original installation folder and Reload the existing extension card so its extension ID and local data remain the same. Do not treat a differently named unpacked directory as the same installed extension.
