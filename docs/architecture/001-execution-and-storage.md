# ADR 001: Visible execution owner and recoverable OPFS storage

Date: 2026-10-19. Status: selected design; runtime acceptance is tracked separately.

## Context

Flux must stream multi-gigabyte resources, write disjoint ranges, recover after abrupt termination, and avoid native software. MV3 event workers are unsuitable as the sole owner of an arbitrarily long transfer. Extension pages provide a foreground execution context; OPFS offers random-access worker I/O. Neither constitutes a promise that the OS or browser keeps a process alive. See the [feasibility assessment](../technical-feasibility.md) for official references.

## Decision

The manager application service owns execution scheduling, job lifecycle commands, settings, and a dedicated module worker. React sends commands to that service and renders throttled snapshots; it does not implement transfer logic. The worker owns transfer execution, request abort controllers, range scheduling, bandwidth gates, checkpoint writes, and OPFS access handles. The extension service worker handles context menus, automatic capture, offers, alarms, and manager navigation. It serializes durable enqueue operations, while the manager imports those entries on initialization and queue-wake messages. The popup communicates with the manager and can open it when absent.

Manual redirects are resolved through the trusted background context using read-only metadata from Flux's own responses. Every destination passes public-address, scheme, host-permission, loop, and hop-limit checks before the next fetch. Worker/manager messages carry redirect decisions, not credentials. Transfer execution remains in the manager-owned worker.

Before each request, the worker asks the background to prepare observation and waits for acknowledgement. This starts a dormant background context before network response events occur. Without that handshake, the 0.2.0 observer could miss an extension-owned redirect and only restart when asked for its already-lost metadata. Lifecycle regression tests observe the manager DOM rather than repeatedly messaging the background, which would mask this failure.

Native capture first pauses a known safe public GET and verifies that it can be fetched without credentials. A replacement job is committed in a paused `capturePending` state before Chrome is canceled. Successful cancellation activates the job and wakes the manager. Failure before cancellation removes a newly created replacement and resumes Chrome. If activation fails after cancellation, the retained job can be resumed explicitly; held jobs never auto-run during recovery. This protocol minimizes duplicate ownership without claiming an atomic cross-API transaction.

Eligible unreproducible originals can have `engine: browser` records linked to Chrome's download ID plus start time. The background serializes native metadata updates and commands. Chrome owns transport, session, destination and security handling; no Flux worker or OPFS stages those bytes. A visible manager polls at most 32 active browser rows concurrently once per second for progress; idle rows do not keep a timer, and closing the manager leaves the Chrome request intact. Popup commands can control that original without opening an engine manager. Recovery reads Chrome status rather than requeueing a POST as a GET. Source attribution for trusted blob/data download links uses a bounded single-use session hint and Chrome filename determination; data payloads do not cross messaging. Native rows have no Flux hashes, range checkpoints, bandwidth budget or queue policy. They cannot be repeated by a periodic queue.

A named Web Lock serializes execution ownership across manager tabs in one extension storage bucket. Only the lock holder executes jobs; another tab remains a viewer or reports that the manager is already active. Hold the lock for the owner's actual lifetime, not for an arbitrary timeout. Lock loss/worker termination is handled like a crash. [Web Locks specification](https://www.w3.org/TR/web-locks/)

## Persistence protocol

Each job has an internal ID, original URL, validated resource metadata, state, ordering/schedule fields, staged-file key, completed ranges, and checksums. OPFS paths use internal IDs rather than network-provided filenames.

For each range:

1. Validate response status, exact Content-Range boundaries/total, identity, encoding, and body length.
2. Stream bytes into their absolute offsets. Handle short writes by continuing until all bytes are written.
3. Finish the range checksum and flush the file handle.
4. Commit the completed range and checksum to IndexedDB in one metadata transaction.
5. Treat the completed metadata transaction as the recovery checkpoint. UI byte counters may also include uncommitted in-flight bytes.

Partially written bytes without a committed checkpoint are untrusted and may be overwritten. Never infer completion from file length or preallocation. No transaction spans OPFS and IndexedDB; a crash between flush and metadata commit wastes retransmission but must not invent completed data. Durability requests reduce risk but cannot eliminate device failure. [IndexedDB durability model](https://www.w3.org/TR/IndexedDB/#transaction-durability)

On reopen, move formerly active jobs into a recoverable paused condition. Verify each checkpoint's file extent and checksum; refuse continuation on corruption and retain partial data until the user cancels/restarts. Revalidate remote identity before scheduling missing ranges. Changed or unverifiable resources restart from zero automatically when resumed, with an explanatory note; their bytes are never merged with the old resource. A non-resumable stream restarts from zero on resume or retry.

## Finalization and export

Validation reads staged data in fixed-size slices, confirms complete coverage/length, checks each stored segment against its received-byte checksum, and computes a final incremental SHA-256. A user-provided expected digest, when present, must match. The file is ready to export only after validation. The manager closes any conflicting synchronous access handle before streaming a file snapshot to a destination selected in a direct user gesture. Export rechecks the full checksum before destination close. Completion of staging is distinct from successful destination close. Keep staged data after an interrupted export so the user can retry.

## Lifecycle and scheduling

Named queues add independent concurrency, start/stop, bandwidth and daily windows below the global limits. A stopped/closed-window queue aborts active workers and retains jobs as queued for automatic continuation; an explicitly paused file remains paused. The next global or queue window boundary uses a bounded timer and an alarm, without idle polling. Batch metadata commits use one IDB transaction. Optional folder saves serialize filename selection and verified exports; destination handles remain in local IDB and require browser-granted write permission.

Calendar queues add selected weekdays and absolute start/stop bounds. An overnight window belongs to its opening weekday. Periodic runs commit their new jobs and clear the due marker in one transaction spanning jobs/config, preserving earlier verified copies. Completion notifications are armed by actual execution and emitted once for a verified queue; stopping after verification is persisted.

The worker owns one shared durable payload allowance. It reserves ranges before fetch, using at most 1 MiB per dispatched range in allowance mode, and lets already-authorized siblings finish when another range is refused. Unused shared credit is bounded to 1 MiB. Unknown-size streams account incrementally; known non-resumable files larger than a complete allowance require a higher limit. A quota pause records its reset time alongside safe checkpoints; the manager schedules one wake event, while manual pause cancels automatic resumption. Changing allowance settings first stops active streams, so an earlier unmetered request cannot continue outside the newly enabled policy.

The worker records typed transient failures and server not-before times after its bounded request retries finish. An optional global/per-queue policy derives a durable next deadline from the original failure time and already-consumed automatic attempts. This avoids extending a delay on each reload. The priority queue admits due failed jobs alongside queued files, after checking the global/queue calendar, concurrency and host grant. It increments the counter and clears the retry plan before persisting dispatch, then asks the worker to run. A crash between that commit and message dispatch may conservatively consume one attempt. Successful resume revalidates checkpoints through the ordinary engine. Manual stop clears the transient plan, manual retry resets the counter, and original Chrome transfers never use this policy. A coalesced follow-up pump pass handles failure/completion events arriving while dispatch is in progress; no idle polling is added.

Closing/discarding the manager stops execution; unload handlers are only best effort. Checkpoints, not last-moment cleanup, provide recovery. A service-worker alarm sends a queue wake message to an already open manager; it does not reopen it. Lateness and sleeping/closed browsers remain constraints. Reconcile persisted due times and missing alarms on startup. Avoid periodic keepalive requests.

## Consequences

The manager must remain open while downloading. Staging plus export may require roughly two copies of the file, in addition to browser/OS temporary storage. OPFS cleanup is explicit and separate from removing history. The design supports bounded application buffers and deterministic restart behavior, at the cost of another disk pass for hashing and export. It does not guarantee native-downloader parity, continuous background execution, or a particular speed improvement.
