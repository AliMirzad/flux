# ADR 002: Optional local media companion

Date: 2026-10-22. Status: proposed for review; milestone 1 design complete, runtime not implemented.

Tracking: [issue #6](https://github.com/AliMirzad/flux/issues/6). See the [roadmap](../media-companion-roadmap.md) and [protocol](../media-companion-protocol.md).

## Problem and scope

Flux's browser engine is appropriate for public direct downloads and its supported browser media subset. Broader website extraction, audio conversion and track merging would duplicate substantial work already maintained by yt-dlp and FFmpeg. Users may opt into a local companion without losing standalone extension functionality.

The initial scale is one local OS user, one Chrome profile connection and one running native media job. No remote service, Telegram integration, cloud storage integration or browser-cookie import is included. DRM processing and arbitrary executable commands are excluded. macOS is first; Windows follows after its own installer and runtime acceptance.

This decision relaxes the earlier no-helper constraint only for the optional companion. ADR 001 continues to govern browser-engine jobs. Earlier README and capability-audit claims describe the shipped browser-only runtime; this ADR does not claim native functionality exists.

## Components and ownership

1. React presents connection status, media review and native job snapshots. It never launches commands or decides completion.
2. A manager-side companion client owns the `runtime.connectNative` port while the manager is open. A Web Lock prevents duplicate ownership across manager tabs. The client validates messages and exposes typed application operations.
3. A Python native messaging host, initially developed as source and later packaged with its runtime, owns extraction, processing, subprocess cleanup and an SQLite job journal. yt-dlp runs in an isolated child process so cancellation does not depend on a cooperative Python thread. FFmpeg children belong to that job's process group.
4. A platform adapter owns host registration, approved destinations, dependency discovery and process-group termination. Installers do not alter browser or OS proxy settings.

Chrome native messaging carries control and bounded metadata only. Media bytes go directly from the host to the chosen native destination, outside OPFS. Native jobs have a separate namespace and journal; they do not masquerade as browser-engine or Chrome-download records. The companion journal is authoritative; any extension snapshot is a disposable cache.

## Lifecycle decision

The first release uses an on-demand host, not a resident daemon. Closing the manager disconnects its port. On disconnect the host stops admission, cancels extraction/download/processing children, and records interrupted work where possible. It must exit within five seconds, escalating from graceful termination to forced process-group termination. Abrupt host death must not leave uncontrolled child transfers; the platform implementation must demonstrate containment before a support claim.

Manager reopening reconnects and reconciles the journal. Jobs found in an active state become `interrupted`; they do not restart without an explicit retry. Partial data is retained, but resume is conditional on extractor/resource compatibility. Sleep may interrupt connections; no promise of unattended scheduling or full-Chrome-shutdown downloading is made. A persistent background service would require a new ADR, user-visible lifecycle control and separate acceptance.

## Persistence and finalization

Store configuration and SQLite under the current user's platform application-data directory, with restrictive permissions. Use schema versions and transactions. Reject a newer unsupported journal schema without rewriting it. Protocol compatibility and journal schema compatibility are independent.

Destinations are selected/configured locally and represented to the extension by opaque IDs. Commands cannot supply arbitrary filesystem paths. Use generated job directories on the destination volume for partial files, constrain extractor filenames, and reject traversal, symlink escape and output outside the approved root. Reserve a unique final filename without overwriting existing files. Final output is published only after the downloader and required processing succeed, the output exists and nonzero length is verified, and media inspection confirms the expected tracks. Record finalization intent before publication and reconcile a crash between publication and journal completion. File existence alone never implies successful completion.

Cancellation retains partial data by default. Removing history never deletes exported files; deleting staged data is a separate explicit command in a future supported capability. Native output does not inherit browser SHA-256, allowance, queue scheduling or bandwidth guarantees. Those controls stay unavailable until separately implemented and verified.

## Trust boundaries

Register only explicitly allowed extension origins. Validate the invoking origin in the host as well as the native-host manifest. No HTTP listener, arbitrary CLI arguments, shell execution, executable path selection, environment overrides or automatic cookie access is exposed over the protocol. Invoke fixed tools with structured arguments and ignore ambient yt-dlp configuration/plugins. Allow only HTTP(S) media inputs; reject credentials in URLs, local/private literal addresses and local hostnames.

Native extraction can request additional hosts, manifests and redirects. The browser engine's request policy does not automatically protect this path. Before real URL support ships, enforce public-destination validation on every outbound path, including DNS resolution, redirects and external downloaders; alternatively disable paths that cannot enforce it. DNS rebinding and proxy-side resolution require explicit treatment and acceptance evidence. Milestone 2 diagnostics must not enable unrestricted URL execution as a shortcut.

Restrict the journal, logs and temporary files to the OS user. Redact query strings, tokens, proxy credentials and sensitive extractor errors from UI/logs. No telemetry or remote processing is introduced. Dependency updates are explicit and versioned; do not download executable updates during extraction.

## Proxy boundary

Reserve opaque proxy profile IDs now; actual proxy support ships in milestone 7. Profiles are configured locally, with secrets in the OS credential store. Snapshot the selected profile revision when creating a job. Extraction, playlists, media and network-capable child processes must use the same selected route unless an explicit future policy says otherwise. A selected proxy failure fails the job rather than retrying direct. No settings alter Chrome's proxy. DNS/IPv6 and child-process routing require evidence, not inference from a successful yt-dlp request.

## Alternatives

- Extension-only extraction retains easy installation but requires maintaining site adapters and browser media processing. Keep it for existing supported functionality.
- A localhost server adds a listening endpoint and authentication complexity without a need at this scale. Use native messaging instead.
- A resident daemon enables jobs after Chrome closes but adds startup, supervision and update obligations. Defer until that behavior is requested and designed.

## Verification and rollout

Milestone 2 implements only framing, origin validation, hello/capabilities, dependency diagnostics and installation. Test malformed/oversized/truncated frames, incompatible versions, disconnect and reconnect in an isolated profile. Subsequent milestones test duplicate-safe job creation, stale review, journal crashes, cancellation at each processing phase, path confinement, playable output and routing failures. Validate macOS and Windows independently. Packaging/license/signing review precedes distribution.

Official references: [Chrome native messaging](https://developer.chrome.com/docs/extensions/develop/concepts/native-messaging), [yt-dlp embedding and dependencies](https://github.com/yt-dlp/yt-dlp), [Chrome proxy scope](https://developer.chrome.com/docs/extensions/reference/api/proxy).
