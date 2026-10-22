# Flux download manager

An optional native media companion is being designed. See the [roadmap](docs/media-companion-roadmap.md), [architecture decision](docs/architecture/002-optional-media-companion.md), and [protocol](docs/media-companion-protocol.md). It is not implemented or required by the current extension.

Flux is a browser-native Chrome MV3 download manager with a real segmented HTTP engine, persistent OPFS staging, and explicit Save As export. **Version 0.6.0 is an engineering preview, not a production-readiness claim.** Keep the manager tab open during Flux engine transfers. No native host, desktop app, offscreen document, account, or remote processing service is required.

## Build and install

Use a current supported Node.js release compatible with Vite 7 (Node 22.12+ is suitable), npm, and desktop Chrome 120 or later. Windows and macOS are the initial targets; the recorded environment is Windows.

```sh
npm ci
npm run build
```

1. Open `chrome://extensions` in Chrome.
2. Enable **Developer mode**.
3. Choose **Load unpacked** and select this repository's `dist` folder.
4. Pin Flux to the toolbar if desired, then open its popup and full manager.

The development server is optional (`npm run dev`); it is not the installed extension and is not needed by end users. Rebuild and click Reload on the extension card after source changes.

For upgrades, retain the same absolute installation folder and reload the existing extension card. An installation loaded from this project's `dist` keeps its extension ID and local jobs when rebuilt there. If you installed an extracted ZIP elsewhere, replace the built contents in that same folder and Reload. Loading a different versioned folder creates a separate unpacked extension and separate local storage.

## Download and save

1. Open the manager and choose **Add download**, or right-click an ordinary HTTP(S) link and choose **Download with Flux**.
2. Enter a direct file URL, optional filename, expected SHA-256, limits, priority, or schedule. Grant access to that website when prompted.
3. Keep the manager open. Compatible servers use verified parallel ranges; incompatible servers use a safe single stream. Pause and resume preserve verified completed ranges when the resource supports recovery.
4. To save automatically, click **Choose download folder** once. Flux retains the directory handle locally, streams verified files into it, and adds numbered suffixes when names already exist. Category subfolders are optional in Settings. If Chrome revokes folder access, choose it again; staged data is retained.
5. **Ready to save** means the bytes are verified in Chrome's private staging storage. Click the file's **Save** action or **Save file** in details, then select a destination.
6. Export streams the file and checks its SHA-256 again. **Completed** means the destination was committed successfully. Canceling Save As retains staged data for another attempt.

Settings affect queue concurrency, per-host limits, manual/adaptive connection mode, bandwidth, schedules/time windows, recovery, theme, and optional offers. Popup actions control the actual manager. History filters, details, renaming, priorities, retry, cleanup, and direct-media detection are available in the manager.

Connection mode/count settings are defaults for new jobs; use a paused job's details to change its own limits. Global bandwidth changes affect running transfers. History retention is applied when **Clean temporary data** is invoked; tracked unfinished files are retained.

To replace Chrome's ordinary downloader for supported files, click **Enable automatic downloads** in the manager (or **Enable** in the popup) and approve the HTTP/HTTPS website-access prompt once. Capture is opt-in; installing the extension alone cannot grant website access. It immediately applies to existing tabs. Normal file links, download attributes, cross-origin links, and recognized filename query parameters queue directly in Flux without opening the Add dialog or starting a duplicate native download. Extensions/excluded hosts remain configurable.

For downloads created outside recognized link clicks, Flux observes the actual request method. A reproducible public GET may be paused in Chrome, verified with a minimal probe, durably queued in Flux, then canceled in Chrome. POST, cookie-authenticated, unknown-method, unsafe, or otherwise unreproducible requests retain their original browser transfer. With capture enabled, eligible original transfers appear in Flux as **Original browser transfer**, including trusted blob/data download links on public pages. These rows control Chrome's original pause/resume/cancel request and show its progress and completion. They retain Chrome's destination, session and security review. No cookies, authorization headers, POST bodies or data URL payloads are copied. These transfers do not use Flux segmentation, bandwidth quotas, queue schedules or hash verification. Closing the manager leaves them running while Chrome remains open.

Chrome reports native downloads only after they start, so the native handoff cannot promise zero initial browser bytes. Removing a linked row cancels an unfinished request and removes only Flux's record; saved files and Chrome download history remain. **Show in folder** locates a completed file without executing it. When Chrome cannot resume a protected request, start it again on its website. **Use browser download** for a stopped Flux job switches its existing row to a new Chrome GET after destination consent; it cannot reconstruct a previous POST. Blob/data entries are omitted from exported URL lists because they cannot be replayed as ordinary HTTP links.

## Queues, lists and expired links

- **Manage queues** creates named queues with independent start/stop, concurrency, speed limits, selected weekdays, first-start/final-stop dates, and daily/overnight windows. Overnight weekday selection belongs to the opening day. Queues can stop when verified or repeat every 1–10,080 minutes, retaining earlier copies. The global limits still apply. Select a queue when adding files or editing a paused job.
- **Add multiple links** reviews up to 500 URLs, imports text/JSON lists, expands patterns such as `part[001:010].zip`, filters by filename/host, and skips already-pending URLs. Drop links or paste them outside an input to open the same review.
- **Grab page links** reads ordinary links/direct media from the most recent accessible web tab, validates public HTTP(S) URLs, and opens the batch review. **Export link list** saves all or selected URLs and metadata; it can include signed URL queries, so store it privately. Imported lists never assert completion or restore unverified byte checkpoints.
- Select individual rows or all visible rows for bulk pause/resume/cancel/remove. Use **Refresh download address** in a stopped job's details for expired links. Resume re-probes identity; a different final resource URL safely restarts instead of merging unrelated bytes.

The full remaining browser-feasible parity work is tracked in [the IDM/AB capability audit](docs/feature-parity.md).

## Download allowance and completion feedback

Settings can limit Flux payload allowance in MiB per fixed 1–168 hour window. Exhausted jobs retain completed ranges and resume at the reset boundary while the manager remains open. Allowance usage is persisted before ranges are authorized; reserved ranges and up to 1 MiB of shared unused credit count conservatively. Interrupted attempts and retransmissions consume allowance. This is not a meter for headers, browser prefetch buffers, Chrome-managed downloads or other apps. A server that cannot resume a file larger than a full allowance needs a higher allowance. Changing allowance settings pauses active streams before applying the new limit.

Enable completion sound in a user gesture to activate the local audio context. Chrome can suspend audio after reopening; no external sound assets are fetched. A named queue can use one completion notification instead of per-file notifications when Notifications is enabled. Queue completion means all files were verified; destination saving can still be pending.

## Automatic recovery of failed transfers

Settings can enable **Automatic retry attempts** (0–20, default off) with an initial delay of 1–86,400 seconds. A named queue can override the defaults, including explicitly disabling retries. After the engine's short request retries finish, typed temporary network errors and HTTP 408/425/429/500/502/503/504 failures can schedule another whole-transfer attempt. The delay doubles up to 24 hours; a longer server Retry-After remains a lower bound. Attempt counters, failure time and next deadline persist locally. Reopening the manager restores the original deadline. Closed/stopped queues and concurrency limits delay dispatch without consuming an attempt. Keep the manager open for the timer to run.

Retries reuse and revalidate durable completed ranges; they do not bypass integrity checks. Login/access, missing-file, storage, verification and browser-managed errors need attention. Enabling the policy also applies to existing failures that retained a typed transient classification. **Stop automatic retries**, **Pause all** and selected pause clear the pending retry, including after reopening. Manual Retry starts a fresh attempt budget. Refreshing the address also clears the prior failure plan. An exhausted budget leaves the file failed for manual action. Imported URL lists never restore failure/retry status.

## Constraints and privacy

Public GET URLs are the primary supported input. Requests omit credentials and referrers. Redirects are followed one validated hop at a time using read-only response metadata; private destinations, HTTPS downgrades, loops, and unapproved hosts are blocked before requesting the next hop. Use the failed job's grant/retry action for a new redirect origin, or enable automatic capture to grant website access once. Cookie sessions, POST/blob downloads, referrer-bound requests, protected streams, and DRM remain outside Flux's transfer engine. No fixed speed gain is promised. Local hashes establish consistency and optional expected-digest matching, not malware detection or publisher authenticity.

Closing/discarding the manager stops Flux engine transfers. Original browser transfers can continue with Chrome open. Sleep or closing Chrome prevents transfer. Scheduling operates through the open manager; alarms provide a best-effort wake signal to that context and do not reopen it automatically. Reopen the manager to recover jobs.

OPFS content and URL history stay in the local Chrome profile, including signed query strings needed for resume. Flux adds no telemetry, analytics, or backend upload. Data is not encrypted by Flux. Staging and export need space for separate copies; quota estimates cannot reserve disk space. Cleanup and uninstall can remove data. Private address literals and local hostnames are rejected, but DNS rebinding remains a documented limitation.

100 MiB and 1 GiB download/verification/test export have current Windows acceptance evidence; native destination dialogs and recovery at those sizes remain separate gates. A 1 GiB export previously failed under disk pressure and passed after more headroom became available. 5 GB and 10 GB remain unverified engineering targets; the current roughly 2.8 GB free disk cannot support their staged-plus-exported copies. Read the actual evidence in [0.4 verification](docs/verification-0.4.md), [benchmark results](docs/benchmark-results.md) and [limitations](docs/limitations.md).

## Test, benchmark, and package

```sh
npm test
npm run test:browser
npm run benchmark
npm run release
```

`npm test` runs unit and real HTTP integration fixtures. Fixtures are development dependencies only. Browser tests require a built `dist` and either Playwright Chromium (`npx playwright install chromium`) or a suitable installed Chrome executable:

```powershell
$env:CHROME_PATH = 'C:\Program Files\Google\Chrome\Application\chrome.exe'
npm run test:browser
```

To exercise both available large-file sizes in the automated suite:

```powershell
$env:LARGE_FILE_MIB = '100,1024'
npm run test:browser
```

These tests use bounded streaming validation and a substituted OPFS export destination. They are not native OS save-dialog verification. Leave enough disk space for two copies plus Chrome's temporary files.

```sh
CHROME_PATH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" npm run test:browser
```

The installed-Chrome route uses CDP `Extensions.loadUnpacked` in an isolated test profile. It has been exercised with Chrome 155; older installed Chrome versions may not support that debugging command. The Playwright Chromium route uses extension-loading flags. Browser tests pre-grant a fixture origin in a temporary copy of the build and map it to the local fixture; these test-only network flags/grants do not ship. Tests substitute an OPFS destination for the native Save As picker, so the OS picker remains a manual acceptance gate. A Playwright Chromium download returned regional HTTP 403 in the recorded environment; installed Chrome provides the available route.

`npm run benchmark` produces measurements, not a speed guarantee; see its generated report for workload, repetitions, and exclusions. The existing benchmark report records the 0.1.0 snapshot; it is not a new 0.6.0 measurement. Do not extrapolate local fixtures to Internet performance or IDM parity. `npm run release` rebuilds, creates `releases/flux-0.6.0.zip` containing only the distributable `dist` contents, and writes its SHA-256 sidecar. The portable Node packager needs no system ZIP utility. Unzip the artifact before Load unpacked; publishing to the Web Store is a separate step.

## Design and release evidence

- [Technical feasibility and official API sources](docs/technical-feasibility.md)
- [0.6 bounded automatic retry evidence](docs/verification-0.6.md)
- [0.5 original-browser transfer evidence](docs/verification-0.5.md)
- [0.4 scheduler and allowance evidence](docs/verification-0.4.md)
- [Earlier 0.3 regression evidence](docs/verification-0.3.md)
- [Earlier 0.2 capture/redirect evidence](docs/verification-0.2.md)
- [Earlier 0.1 verification evidence](docs/verification.md)
- [Execution and storage ADR](docs/architecture/001-execution-and-storage.md)
- [Security and privacy review](docs/security.md)
- [Privacy policy](docs/privacy-policy.md)
- [Known limitations](docs/limitations.md)
- [Store readiness checklist](docs/store-readiness.md)
- [Release notes](docs/release-notes.md)

Consult the reports for final test counts and verified sizes. Passing small fixtures, building successfully, or producing a ZIP does not demonstrate full browser shutdown recovery, macOS behavior, 10 GB capacity, or store approval.
