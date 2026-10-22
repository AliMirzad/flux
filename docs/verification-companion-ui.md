# Companion setup and media UI checkpoint

Date: 2026-10-22. Continues draft PR #7 and milestone 4. Native media downloads remain disabled.

## User flow

Flux Settings includes extension ID copying and **Download macOS installer**. The download comes from a local extension asset, not a remote repository. Its ZIP contains the companion source, pinned requirements, an end-user setup guide and executable install, folder-setup and uninstall commands. The build uses the shared deterministic ZIP writer and records Unix executable permissions for the commands.

The user unzips the archive, opens `Install.command`, pastes the extension ID and chooses an installed Python 3.10+ executable. After confirmation, setup creates a virtual environment and downloads pinned yt-dlp. Replacement of an existing registration needs local confirmation. The user returns to Flux to check the connection and grant optional native messaging permission.

**Download folder setup** provides a separate ZIP with an executable command that opens macOS's folder picker. It invokes the installed configuration launcher, which binds the installing interpreter and local data directory. Folder approval stays local. **Refresh save folders** reads opaque IDs and labels through the negotiated capability and releases its native port. Old companions receive an upgrade message; empty or unavailable destinations have an actionable empty state. Native storage errors are redacted.

The media section has a public URL field, format review, track metadata and an approved-folder selector. Refresh follows the existing companion Web Lock and is disabled during inspection/review. Closing Settings cancels pending requests. **Download media** stays disabled with an explanation until the native execution and output verification pipeline is implemented.

## Evidence

- 105 TypeScript unit tests passed across 13 files. New cases cover destination capability negotiation, bounded parsing, duplicate handles, private-field projection, error redaction, cancellation, timeout and disconnect cleanup.
- 48 Python tests passed with ResourceWarning treated as an error. New launcher tests verify that it retains the selected data directory and that legacy installation receipts preserve an unowned file named `configure`.
- Type checking, Vite build and package audit passed. The build includes both setup ZIPs. Formatting and whitespace checks passed.
- The release ZIP passed independent Python ZIP entry/CRC validation and its SHA-256 manifest check after extracting the shared packaging writer.
- `scripts/check-companion-installer.py` ran the packaged executable in a temporary home directory. It rejected an invalid extension ID before installation, created a fresh virtual environment, downloaded/imported yt-dlp 2026.03.17, established framed native communication, approved a test folder and ran the packaged uninstall command. Registration and owned host files were removed; approvals and runtime were preserved until temporary-directory cleanup.
- Chrome 155.0.8059.86 passed ID copying, the UI installer download, archive validation, native connection diagnostics, approved-folder selection and revoked-folder refresh. The helper was installed from the downloaded archive, not repository source.
- The real Chrome check also passed live MDN sample inspection, disabled download gating, cross-tab ownership rejection, cancel, private source rejection, missing-host recovery and a 480px viewport overflow check. Setup and media-review screenshots were inspected.
- Chrome used a disposable profile and temporary registration/data. Native messaging was pregranted only in the temporary extension. Normal-profile registration was unchanged.

Commands after building:

```sh
npm test -- tests/unit
/opt/homebrew/Cellar/yt-dlp/2026.3.17_1/libexec/bin/python -B -W error::ResourceWarning -m unittest discover -s companion -p 'test_*.py'
/opt/homebrew/Cellar/yt-dlp/2026.3.17_1/libexec/bin/python -I -B scripts/check-companion-installer.py
PYTHON_PATH=/opt/homebrew/Cellar/yt-dlp/2026.3.17_1/libexec/bin/python \
  COMPANION_SAMPLE_URL=https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4 \
  node scripts/check-companion.mjs
```

## Limits

This is an unsigned development installer. It requires an existing Python installation and internet access, and does not bundle FFmpeg/ffprobe. It is not milestone 8's signed distribution with a packaged runtime, dependency updates or clean-machine acceptance. macOS opening/permission consent, the graphical folder picker and confirmation prompts still need human acceptance. Automated checks tested the local approval path and executable installer commands; they did not click the OS folder picker or Gatekeeper UI.

The tested runtime was Homebrew Python 3.14.4. Earlier pyenv 3.11.1 Chrome launch problems remain unresolved. Windows, native job execution, merge/conversion, safe staged publication and independently verified output remain pending. Selecting a format or save folder creates no job.

## First permission grant recovery — 2026-10-22

A user installed the packaged companion successfully but received “Could not connect. Install the macOS companion for this extension ID.” The installed launcher completed a framed handshake in 1.36 seconds, and the registered extension ID matched the open Flux page. In that page, Chrome reported `nativeMessaging` granted while `typeof chrome.runtime.connectNative` was still `undefined`. Reloading the page and checking again connected successfully, with yt-dlp 2026.03.17 and FFmpeg/ffprobe 8.1 reported by the installed helper. The runtime used Python 3.11.1 from pyenv for this diagnostic; inspection with that runtime was not tested.

Diagnostics, folder listing and media inspection now distinguish an unavailable native API from a missing installation. The UI explains that Chrome needs the page reloaded and offers **Reload Flux**. Reload remains an explicit action, with a reminder to finish or pause active downloads first. After reloading, reopen Settings and retry the operation. The companion does not need reinstalling for this case.

Validation: 114 unit tests passed, including unavailable-API recovery and cancellation precedence for all three native operations. Typecheck/build/package audit and formatting/whitespace checks passed. The browser regression simulates successful permission approval in a document lacking native bindings and checks the explanation and reload button. It does not automate Chrome's permission prompt. The installed user's normal-profile connection was visibly verified after reloading.
