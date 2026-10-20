# Verification evidence - Flux 0.6.0

Environment: Windows, installed Chrome 155.0.8059.82, Node 24.18.1 and npm 11.16.0. This milestone adds bounded whole-transfer retries to the existing engine and queue. The broader [capability audit](feature-parity.md) remains active.

## Automatic retry acceptance

The policy is off by default, configurable globally, and overridable per named queue. Attempts are bounded to 0–20, with an initial 1–86,400 second delay. Subsequent delays double up to 24 hours while respecting a longer server Retry-After. Only typed transient network/timeouts and HTTP 408/425/429/500/502/503/504 failures qualify. Existing transient failures can opt into the policy when it is enabled. Original Chrome requests, login/access, storage and integrity failures do not enter the policy.

Unit and manager integration coverage verifies the disabled default, queue inheritance/explicit disable, exponential cap, server not-before hints, invalid metadata refusal, priority ordering, per-file scheduling, persistence of deadlines and consumed counters, manual budget reset, exhaustion without further attempts, and pause-all canceling the plan across reopening. A retry-pending URL remains a duplicate for clicked-link/manual/batch enqueueing; a test confirms single-add refusal and batch skipping. A due failed file waits until both global and queue windows open without consuming attempts. Counters persist immediately before worker dispatch; a crash in the gap can conservatively consume an attempt without making a request.

A separate race regression delivers a worker failure synchronously during dispatch. The manager coalesces another pump pass and preserves its future retry deadline instead of losing the wakeup. This does not introduce an idle keepalive loop.

Two focused Chrome tests passed in **17.5 seconds**:

- A real 3 MiB file checkpoints its first 1 MiB, then its subsequent ranged request repeatedly receives HTTP 503 until the engine's short retries exhaust. Flux stores the failure and automatic deadline. Reloading the manager preserves the same job ID and deadline without another request. After the server recovers and the manager clock advances, one automatic attempt revalidates the checkpoint and downloads the missing bytes. The first 1 MiB range is requested exactly once; the final SHA-256 matches the independent deterministic fixture.
- A named queue overrides the disabled global policy. A separate HTTP 401 job remains failed without an automatic plan. The temporary-failure job displays Retry scheduled. Pause all cancels its plan, then reload and a clock advance issue no further request, even after the server recovers.

## Final checks

- Strict TypeScript, **135 unit/integration tests across 13 files**, the production build and package audit passed. The final unit run took **23.80 seconds**. The audited build contains 15 files, about **468.6 KiB** unpacked, with no new runtime dependency or manifest permission.
- The full **29-test Chrome suite passed in 2.0 minutes**, using `LARGE_FILE_MIB=100`, the supplied live URL and `FLUX_COLD_BACKGROUND=1`. It includes both new real-outage retry tests, all original-browser/capture regressions, queue/allowance/calendar behavior, browser-context recovery, service-worker termination, and a verified 100 MiB transfer/export.
- The user's Soft98 URL completed after explicit background termination: **3,574,116 bytes**, with an independently matching SHA-256 `1bea6dd8e2befc9bb1ff1b090c9c8d6e954a390278980dc776df695ff9de6e02`. The final record is preserved in [live-link-result-0.6.json](live-link-result-0.6.json). Redirect regressions observe the manager DOM without repeated snapshot calls waking the background first.

The browser suite uses isolated temporary profiles and test-only fixture grants; the shipped manifest keeps host access optional. Formatting is checked separately after preserving the evidence.

Normal-window native binary finalization, host/destination-consent dialogs, macOS, OS power loss and process memory profiling remain separate gates. This change does not extend the capacity claim beyond the recorded 100 MiB and 1 GiB evidence. See [0.4 verification](verification-0.4.md) and [0.5 original-browser evidence](verification-0.5.md). Keep Chrome and the manager open for Flux retries, queue boundaries and transfers.

## Package and upgrade

`releases/flux-0.6.0.zip` contains **153,304 bytes and 15 files**. Windows tar extracted it; every extracted file hash matches final `dist`, and the root manifest reports 0.6.0. The extracted `releases/flux-0.6.0` directory is available for inspection. Archive SHA-256:

```text
4b39b37957a6cd1c7aee4bafa7cb04c268dd4f87747aeacdb809fdd301b9cc36
```

Retain the original absolute installation folder when replacing the files and Reload the existing Chrome extension card. A different versioned unpacked folder creates another extension ID and separate local data. Automatic retries remain off until configured in Settings or a queue override. The remaining IDM/AB media, crawler and interface work remains visible in the capability audit rather than being declared complete by this milestone.
