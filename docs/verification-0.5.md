# Verification evidence - Flux 0.5.0

Environment: Windows, installed Chrome 155.0.8059.82, Node 24.18.1, npm 11.16.0. This milestone integrates original Chrome transfers into Flux. The broader [capability audit](feature-parity.md) remains active.

## Original requests and controls

Cookie-authenticated and POST fixture downloads keep their original Chrome download identity. Flux records their actual status, without a replacement GET, copied POST body, cookies or authorization headers. An 8 MiB authenticated file pauses through Flux, stays paused after closing the manager, resumes through the popup without a manager, completes, and matches the independent deterministic fixture digest when read from disk. The Flux browser row correctly retains a null SHA-256 because Flux itself did not hash the transfer. A separate test cancels the original Chrome ID through the selected-row action and verifies USER_CANCELED with exactly one Chrome request record.

Generated blob/data download links use Chrome's actual filename delegate and a profile-local destination. Tests compare the saved UTF-8 file contents and exact filenames, confirm no data payload URL appears in Flux metadata, and remove each row while retaining the file and Chrome history. Exclusion coverage includes a generated link inside a cross-origin frame under an excluded parent page. Browser identity, interruption, review-required states, empty completed files, and no invented hash/checkpoint claims have unit coverage.

The native HTTP control tests use Playwright's normal DevTools download delegate. Generated-link filename tests use Chrome's default delegate because DevTools allowAndName bypasses extension filename determination. Default-delegate HTTP fixture downloads separately remained in progress after receiving every byte in headless Chrome, including with Flux's filename observer removed from a temporary diagnostic build. That default-delegate HTTP completion route is not accepted by these tests and remains a manual normal-window gate. The shipped extension does not change Chrome's security settings or approve dangerous downloads.

## Checks and scope

Strict TypeScript, **127 unit/integration tests across 13 files** (24.60 seconds), build, formatting and package audit passed. The focused 14-test capture suite passed in **28.2 seconds**. The final full **27-test Chrome suite passed in 1.7 minutes**, with `LARGE_FILE_MIB=100`, the supplied live URL and `FLUX_COLD_BACKGROUND=1`. It covers actual 100 MiB transfer/verification/export, browser-context recovery, manager ownership/closure, calendar/allowance/periodic behavior, cold redirects and the native control/filename cases above. A completed Flux file retains its verified segments, byte count and digest when included in bulk cancellation.

The supplied Soft98 URL again traversed its CDN chain after explicit background termination and matched an independent browser response: 3,574,116 bytes, SHA-256 `1bea6dd8e2befc9bb1ff1b090c9c8d6e954a390278980dc776df695ff9de6e02`. The final response evidence is preserved in [live-link-result-0.5.json](live-link-result-0.5.json). The cold-start regression observes the manager DOM before asking for the final snapshot, so polling cannot conceal the startup failure.

This change adds no manifest permission or runtime dependency. Native destination-consent dialogs, security-warning UI, Show in folder OS interaction, macOS, and native binary finalization in a normal window remain manual gates. Flux's 100 MiB and 1 GiB capacity evidence is preserved in [0.4 verification](verification-0.4.md); no 5/10 GB claim is made. Original Chrome rows do not use Flux's hashes, segmentation, allowance, bandwidth or calendar queue policies.

## Package and upgrade

`releases/flux-0.5.0.zip` contains **151,402 bytes and 15 files**, about 461.8 KiB unpacked. Windows tar extracted it; every extracted file hash matches the final `dist`, and its root manifest reports 0.5.0. The extracted `releases/flux-0.5.0` directory is available for inspection. Archive SHA-256:

```text
55a8caa47417175a9a9cd8b225c5c170d22912e3b8b0c8738debb2e09a48f1cd
```

Upgrade in the same absolute installation folder and Reload the existing extension card to retain its ID and local records. A differently named unpacked folder creates a separate installation. Enable automatic downloads once and approve website access for click capture. Keep the manager open for Flux engine transfers; original browser rows follow Chrome's own lifetime.
