# Media companion protocol v1

Status: hello/diagnostics and milestone 3 single-item inspection are implemented. Job operations remain disabled. See [ADR 002](architecture/002-optional-media-companion.md).

## Transport and bounds

Host name: `com.flux.media_companion`. Use Chrome native messaging, UTF-8 JSON with a four-byte native-endian byte-length prefix. Stdout contains frames only; diagnostics use redacted stderr. Limit every frame to 256 KiB, below Chrome's host-to-browser message ceiling. Reject invalid JSON, truncated input, invalid envelope types and oversized lengths before allocation. Unknown operations receive a typed error. A framing violation closes the connection.

Every envelope has `protocol: 1`, `kind: request | response | event` and a bounded string `id`. Responses echo the request ID. Requests contain `method` and `params`; responses contain exactly one of `result` or `error`. Events contain `event`, `jobId`, `revision` and `data`. UUIDs identify requests, reviews and jobs; reject strings over 128 characters. Ignore unknown optional fields for forward compatibility, but reject unknown enum values and incompatible protocol majors. Capability names gate optional operations; protocol version alone does not enable features.

```json
{
  "protocol": 1,
  "kind": "request",
  "id": "a7f8c4df-009c-4ef9-9902-f8e97806479a",
  "method": "hello",
  "params": { "extensionVersion": "0.7.0" }
}
```

```json
{
  "protocol": 1,
  "kind": "response",
  "id": "a7f8c4df-009c-4ef9-9902-f8e97806479a",
  "result": {
    "companionVersion": "0.1.0",
    "protocol": 1,
    "capabilities": ["diagnostics", "inspect", "inspect.cancel", "destinations.list"],
    "platform": "darwin",
    "dependencies": {
      "ytDlp": { "available": false, "status": "missing" },
      "ffmpeg": { "available": false, "status": "missing" },
      "ffprobe": { "available": false, "status": "missing" }
    }
  }
}
```

These are illustrative wire examples, not evidence of installed binaries or supported capabilities. Reject all commands except `hello` until negotiation succeeds. Initial request deadlines: hello/diagnostics 10 seconds, inspect 90 seconds, journal/control operations 10 seconds. A timeout means unknown outcome for a mutation; reconcile using its stable job ID before retrying. Maximum eight outstanding requests, one inspection and one running native job. Queue at most 100 unfinished jobs; additional creates receive `BUSY`.

## Methods

| Method              | Parameters                                                                                                        | Result / rule                                                                                                                         |
| ------------------- | ----------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `hello`             | `extensionVersion`                                                                                                | Version, platform, explicit capabilities and dependency availability/versions; no absolute executable paths                           |
| `diagnostics`       | none                                                                                                              | Redacted dependency/registration status and actionable codes; available in milestone 2                                                |
| `inspect`           | `url`, optional `proxyProfileId`                                                                                  | Opaque `reviewId`, sanitized title, duration or null, at most 200 formats and `expiresAt`; no raw extractor JSON or signed media URLs |
| `inspect.cancel`    | `requestId`                                                                                                       | Cancels the referenced active inspection; idempotent                                                                                  |
| `destinations.list` | none                                                                                                              | At most 50 approved opaque destination IDs and display labels; configuration is local, not an arbitrary path command                  |
| `jobs.create`       | `jobId`, `reviewId`, `selectionId`, `output` (`video` or `audio-mp3`), `destinationId`, optional `proxyProfileId` | Durable snapshot after commit; defaults to explicit direct route until proxy capability exists                                        |
| `jobs.list`         | optional cursor, `limit` 1–50                                                                                     | Journal snapshots, next opaque cursor or null                                                                                         |
| `jobs.get`          | `jobId`                                                                                                           | Authoritative snapshot or `NOT_FOUND`                                                                                                 |
| `jobs.cancel`       | `jobId`                                                                                                           | Snapshot with `cancelRequested`; completion event follows after children stop; repeated cancel is safe                                |
| `jobs.retry`        | `jobId`, `expectedRevision`                                                                                       | New attempt on the same job after compatible state/revision validation; reinspection required if the review/resource changed          |

`inspect` retains source/selection metadata privately for at most ten minutes. Bind the review to the selected route and proxy-profile revision; creating a job with a different route requires a new inspection. Recheck before dispatch; expired reviews require a new inspection. Selection IDs bind actual available format combinations and output capability. A successful inspection is not a download guarantee. Bound URL inputs to 8192 characters, titles/labels to 512 characters and error messages to 1024 characters. Large format sets return a bounded subset with `truncated: true`; do not silently imply it is the full list.

The inspection preview returns `title`, nullable `duration`, `reviewId`, UTC epoch-millisecond `expiresAt`, `truncated` and `formats`. Each format contains an opaque `selectionId`, `label`, nullable `container` and `height`, and `hasVideo`/`hasAudio` values of `true`, `false` or `null` for unknown. Unknown tracks must not imply download/merge eligibility. Milestone 3 lists individual extracted formats; supported combinations/output choices will be defined with job execution. The latest review replaces the previous one and is discarded on disconnect. Flux retains its port and Web Lock while showing the review. All proxy-profile parameters are rejected until proxy support exists. `inspect.cancel` acknowledges `cancelRequested: true`; the original inspection response reports `CANCELED` after its worker stops.

The host persists canonical create parameters and `jobId` atomically before acknowledging admission. Reusing a job ID with identical parameters returns the existing job; different parameters return `CONFLICT`. Retain tombstones if deletion is later supported so delayed retries cannot recreate deleted jobs. Request IDs correlate replies; they are not durable idempotency keys. Retry/control commands use revisions to reject stale mutations.

Native destination configuration and proxy-profile editing are not remotely executable protocol operations in v1. Until the corresponding capabilities exist, disable those controls in Flux and return `UNSUPPORTED_CAPABILITY` rather than silently ignoring parameters. Download/conversion are disabled when required dependencies are missing.

The development host now implements `destinations.list` after negotiation, with exactly empty parameters. The result is an array of `{ "id": "opaque-uuid", "label": "Downloads" }` entries. It omits unavailable approvals, never returns local paths and rejects extra parameters with `INVALID_REQUEST`. Local storage failures return a redacted `DESTINATION_UNAVAILABLE`. There are no native `destinations.approve` or `destinations.revoke` methods. A separately invoked local configuration command manages these approvals. Job capabilities remain unavailable.

## Job snapshots and events

Snapshot fields: `jobId`, monotonically increasing durable `revision`, `state`, `attempt`, `title`, `destinationId`, `createdAt`, `updatedAt`, `cancelRequested`, `progress` and optional typed `error`. Timestamps are UTC epoch milliseconds. Progress includes `phase`, nonnegative `receivedBytes`, nullable `totalBytes`, nullable `bytesPerSecond` and nullable `etaSeconds`. Values apply to the current phase/attempt and may reset when a track changes; they are not a global percentage. Never fabricate totals for unknown-length streams.

States: `queued -> downloading -> processing -> completed`. `downloading` may complete directly if no processing is required. Active work may transition to `failed`, `canceled` or `interrupted`. Queued work can be canceled. Retry moves `failed | interrupted | canceled` to `queued` and increments `attempt`, retaining valid partial data only when supported. Terminal `completed` is immutable. Cancel that arrives after final commit returns completed; do not delete or mislabel the saved output. `cancelRequested` is a flag, not proof the process stopped.

Emit `job.updated` snapshots no more than four times per second per job; terminal/state transitions are immediate. Revisions increase only after durable journal writes; coalesce progress and persist no more than once per second. Events are best-effort within one connection, not a durable replay log. Drop stale/equal revisions. On reconnect, subscribe implicitly before listing jobs; buffer incoming events during paginated snapshot reconciliation and apply only newer revisions. Disconnection makes the displayed state stale, not completed or failed.

## Errors and shutdown

Error envelope: `code`, sanitized `message`, `retryable`, optional `jobId`. Codes: `INVALID_REQUEST`, `INCOMPATIBLE_PROTOCOL`, `UNSUPPORTED_CAPABILITY`, `DEPENDENCY_MISSING`, `INVALID_URL`, `DESTINATION_DENIED`, `REVIEW_EXPIRED`, `FORMAT_UNAVAILABLE`, `NOT_FOUND`, `CONFLICT`, `BUSY`, `NETWORK_ERROR`, `NETWORK_BLOCKED`, `PROXY_ERROR`, `EXTRACTION_FAILED`, `PROCESSING_FAILED`, `STORAGE_ERROR`, `CANCELED`, `INTERNAL_ERROR`. Retryability is advice; the user must explicitly retry in the initial release. Never include raw command lines, credentials, signed URL queries or extractor dumps.

Disconnect cancels in-flight requests and stops child processes within the ADR's five-second budget. No final event is required after a broken pipe. On next start, reconcile active journal entries and any finalization intent before returning snapshots. The extension must not blindly repeat a timed-out create or infer job completion from EOF.

## Contract acceptance checklist

- [ ] Encode/decode partial reads, UTF-8 byte lengths, size limits, malformed frames and clean EOF.
- [ ] Validate origin, negotiation, field bounds, capability gates and dependency failures.
- [ ] Prove duplicate create, conflicting create, timeout reconciliation and stale revision behavior.
- [ ] Prove review expiry, unavailable selection and destination confinement errors.
- [ ] Prove event reconciliation, reconnect, interrupted journal state and finalization crash handling.
- [ ] Prove cancellation and process cleanup during inspection, download and conversion.

These tests belong to the implementation milestones. Milestone 1 defines the contract without claiming they pass.
