# Flux security and privacy review

Review baseline: 2026-10-19. This is a threat model and control checklist, not a penetration-test certificate. Implementation and browser tests must demonstrate each control before release.

## Trust boundaries

Downloaded bytes, URLs, HTTP fields, filenames, persisted records, and page links are untrusted. Only packaged extension code commands the engine. Automatic capture requires explicit opt-in and host grants; a trusted link click can request an eligible file under that policy. Background handlers revalidate source/target hosts, extension sender, rules, exclusions and URL shape before durable enqueueing. Privileged settings/deletion/export commands accept trusted extension UI senders only. No externally_connectable entrypoint or arbitrary page fetch proxy is exposed.

The engine validates URLs again even if the UI already validated them. Allow only HTTP(S), reject embedded credentials and excessive input, normalize with the URL parser, and strip fragments. Reject localhost names, .localhost, .local, single-label/internal names, and non-public IPv4/IPv6 literals, including alternative spellings normalized by URL parsing and IPv4-mapped IPv6. Test reserved, loopback, link-local, private, multicast, and unspecified address forms. Page-derived URLs require explicit capture opt-in and matching host grants, or a manual review and permission action, before privileged network access.

**Residual risk:** browser fetch does not expose a dependable pre-connect DNS/IP validation hook. A public-looking hostname may resolve or rebind to a private address. Hostname filtering is defense in depth, not complete SSRF prevention. Capture is opt-in, origin grants are required, and every redirect target is validated before fetching. Comprehensive local-network isolation is not claimed.

## Requests and redirects

Credential omission is the default network policy. An explicit per-download browser-session choice permits credentials only for the original source origin. Add Download initially checks that option; opted-in capture sets it for captured jobs. URL imports and legacy jobs do not gain session use. Every redirect and HLS child retains this one origin; other destinations omit credentials regardless of host grants. Referrers stay omitted. No cookie API, cookie-value access or forwarding of page Authorization/header fields is added. Signed URLs are secrets: do not log query strings or put them into diagnostic filenames. Fetch stays in manual-redirect mode. Read-only webRequest response metadata exposes Location for extension-owned requests; the next hop must pass URL/private-address, HTTPS downgrade, loop and host-permission checks before another request. Missing metadata fails closed. Page-origin redirect observations cannot populate this lookup. [Fetch request modes](https://fetch.spec.whatwg.org/#requests), [webRequest response events](https://developer.chrome.com/docs/extensions/reference/api/webRequest).

The additional webRequest permission is observational, without blocking or header mutation. A bounded in-memory ledger keeps public request URLs/methods/initiators/tab identifiers for up to 30 seconds to refuse POST/ambiguous native handoffs, and extension-owned redirect targets for up to five seconds. Cookies, authorization headers and response bodies are not recorded. Native takeover pauses the original, checks minimal replayability under that source-origin policy, persists a job, then cancels the original. That probe cannot prove semantic equality of every server-dependent variant. Failed replay resumes Chrome; POST, referrer-bound and otherwise unreproducible cases remain with Chrome; compatible cookie-only GETs can use Flux.

Linked original browser transfers store the Chrome download ID and start time together; commands refuse a missing or reused identity. Only trusted extension pages can issue native commands. Explicit registration requires a download started by this extension and validates a matching stopped Flux job when replacing its row. Pausing, resuming and canceling operate on the original request; Chrome security warnings are never accepted programmatically. Flux does not open or execute the file. The Show action reveals its folder. Removing a row keeps Chrome history and saved files.

For a trusted primary click on a blob/data download link, the content script requests a single-use filename prefix. Background verifies the sender's public page, host grant, capture setting and top-page exclusions. At most 64 source-page/parent-host/kind hints with random prefixes are stored in session storage; they expire logically after 15 minutes and are pruned on access. Chrome's filename callback consumes a matching hint, restores the original sanitized filename and rechecks capture/exclusions. This prefix path is the Chrome fallback. The primary page-file path fetches only inside the page content script, then sends acknowledged chunks of at most 256 KiB under a single-use random token. Session grants bind tab/frame/document/source URL and exact size, with one-hour expiry and eight slots. The manager rechecks current host access/capture/exclusions, checks sender identity before even aborting, rejects overlapping/out-of-order/malformed/oversized messages, expires idle uploads and serializes orphan cleanup against reception. A conservative 1 GiB file cap falls back to Chrome. Only complete, closed, hashed OPFS content is published. Page files carry a non-replayable flag; source refresh, retry/redownload, periodic queue copying and URL-list exports cannot mistake their source page for a file endpoint. No privileged extension fetch of a blob/data URL occurs. Generic generated-download observations with ambiguous parent attribution are skipped when site exclusions exist.

The 0.3 engine obtains a trusted background-ready acknowledgement before each fetch so a suspended background cannot lose its redirect observation. This is tied to an actual request, not an idle keepalive. Batch lists are validated before atomic enqueue; imported state cannot assert completed or verified bytes. Link-list exports can include signed URLs and are explicitly user initiated. A selected destination's filesystem handle stays in local IDB; automatic saves check write permission, serialize exports, and verify the complete output stream before commit. User/profile data deletion does not remove exported destination files.

Host permission is broader than one URL. Request it in a direct user gesture with a clear explanation: a single destination for manual entry, or explicit HTTP/HTTPS website access for automatic capture. Honor revocation and source/destination exclusions. Privileged fetch must stay in extension contexts. [Chrome cross-origin security guidance](https://developer.chrome.com/docs/extensions/develop/concepts/network-requests#security-considerations)

## Content and file safety

Render metadata as text through React; never inject downloaded HTML. Sanitize display/export names by removing separators, control characters, traversal components, Windows reserved names, trailing dots/spaces, and unsafe empty names; cap length. Use Content-Disposition only as an untrusted naming hint. OPFS uses generated identifiers. A save picker gives the user the final destination/collision choice; no arbitrary filesystem paths are accepted from a page.

Require exact range accounting and complete streamed-body length before checkpointing. Verify persisted range hashes after recovery. A computed SHA-256 is not malware scanning or proof of publisher authenticity. Flux does not open or execute downloaded files and does not approve dangerous downloads. Normal browser/OS file checks must remain effective; test File System Access export behavior on each target OS.

## Package and storage

Package code, workers, fonts, and hashing WASM locally. CSP must restrict executable sources to self; wasm-unsafe-eval may be necessary for a bundled WASM hash library but does not justify JavaScript unsafe-eval or remote code. No eval, dynamic remote script, trackers, account, backend upload, or analytics SDK belongs in the build. Audit the actual output, not only source dependencies. [MV3 executable-code requirements](https://developer.chrome.com/docs/webstore/program-policies/mv3-requirements)

Metadata and partial content remain in the local Chrome profile; they are not encrypted by Flux. Signed URL queries may persist for resume. Device/profile access can reveal them. Provide explicit history and partial-data deletion controls and explain the effect of uninstalling. Keep routine diagnostics free of full URLs, tokens, headers, or content. Notification text should avoid sensitive URL details.

## Release review gates

- Check runtime message allowlists, sender IDs/origins, schema limits, and error paths.
- Test private literal variants, URL credentials, unsafe filename inputs, and redirect refusal.
- Test permission denial/revocation and page offers on excluded sites.
- Check package output for remote imports, eval, secrets, and unneeded permissions.
- Run the package manager audit and inspect dependency advisories; record actual findings and remediation.
- Confirm data deletion, crash recovery, corrupted checkpoints, export cancellation, and quota failures.
- Reconcile published privacy disclosures with real network traffic and persisted fields.

No known issue should be relabeled as accepted production behavior merely to pass a release checklist. DNS rebinding remains an explicitly documented limitation.

## 0.7 media and destination review

HLS inspection and transfer reuse the engine's public-URL, source-origin session choice, redirect and host-grant controls for every child. Selecting a rendition does not grant arbitrary page requests a privileged fetch proxy. Manifests and MP4 metadata are bounded; unsupported encryption/protection, edit lists and fragment addressing are refused. Logical-part source validators/hashes and output checkpoints commit together after OPFS flush. Changed plans or stored hashes cannot silently append to a different presentation. User-invoked resource-list discovery is local metadata inspection, not continuous page-response collection.

Chrome Downloads-folder export now incrementally rehashes the exact immutable staged File snapshot before making its file-backed Blob URL available to Chrome. Writable-stream export verifies before destination close. Both retain a successful destination when only the subsequent history write fails. No new manifest permission or runtime dependency accompanies these changes. See [source review and regressions](code-review-0.7.md).

## 0.8 TS parser isolation

Untrusted MPEG-TS is processed in a dedicated local child worker with a bounded input size, packet/program/CRC/continuity checks, patched codec limits and a ten-second deadline per acknowledged operation. Abort/error/timeout terminates that child; it cannot own OPFS handles or commit progress. Source/output identity and initialization/timeline rollback are explicit. The Apache-2.0 vendor module is pinned and generated only after exact source-hash checks, with its license and changes included in package notices. No new permissions or remote processing are introduced. See [findings and tests](code-review-0.8.md); total-process memory and broad media compatibility are not certified by these guards.

## 0.9 ordinary AES-128 HLS

Only identity AES-128 full-segment CBC/PKCS7 is accepted. Key origins are included in review and every key request uses existing URL/redirect/grant/credential controls. Sixteen-byte key responses are imported into nonextractable Web Crypto keys; raw key buffers stay temporary and only their fingerprints persist for resume checks. Encrypted parts use bounded fixed-block accumulation, local decryption, then the existing container/hash/checkpoint pipeline. Changed keys, invalid lengths/padding and unsupported protection stop without committing the failed part. CBC provides no authenticity guarantee. See [source review](code-review-0.9.md) for the buffer-lifetime and allowance findings, tests and remaining scope.
