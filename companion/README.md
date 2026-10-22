# macOS development companion

The development preview provides connection diagnostics, single-item media inspection with bounded format selection, and locally approved save-folder handles. It does not save media, install media dependencies, or change proxy settings. The packaged end-user installer belongs to milestone 8.

## Install and check

Prerequisites: macOS, desktop Google Chrome, Python 3.10 or later at a stable absolute path, and Flux built and loaded unpacked from `dist`. Keep the same extension folder to preserve its ID. Python is required only for this source-based development setup; distribution will package its runtime.

1. Build Flux with `npm ci` and `npm run build`, then load/reload `dist` through `chrome://extensions`.
2. Copy Flux's extension ID from its extension card.
3. From the repository root, run:

```sh
python3 companion/install.py install --extension-id YOUR_EXTENSION_ID
```

4. Open Flux Settings, choose **Check companion connection**, and grant the optional native messaging permission. The result reports the companion version and whether yt-dlp, FFmpeg and ffprobe can be found and probed. Missing media tools do not prevent connection diagnostics.

The installer registers `com.flux.media_companion` only for that extension ID under `~/Library/Application Support/Google/Chrome/NativeMessagingHosts`. Source, launcher and the host's own allowlist are copied into `~/Library/Application Support/Flux/Media Companion`. The launcher uses the installing Python interpreter's absolute path, preserving virtual environments, and does not run shell initialization files. Moving/removing Python requires reinstalling the companion. A changed extension ID also requires reinstalling.

No native registration or permission is needed for ordinary Flux downloads. A failed connection check does not change existing jobs. The check opens a temporary port and closes it after diagnostics; there is no resident process or automatic launch at Chrome startup. It does not install anything until you run the installer.

## Enable media inspection

Inspection uses the pinned yt-dlp **Python package in the installing interpreter**, not the separately discovered command-line executable. A CLI version in diagnostics does not prove that the Python package is available. Install the requirements into a dedicated runtime, then use that same runtime for installation:

```sh
python3 -m venv "$HOME/Library/Application Support/Flux/Media Runtime"
"$HOME/Library/Application Support/Flux/Media Runtime/bin/python" -m pip install -r companion/requirements.txt
"$HOME/Library/Application Support/Flux/Media Runtime/bin/python" companion/install.py install --extension-id YOUR_EXTENSION_ID
```

Uninstall an existing host before reinstalling with a different interpreter. The independently created virtual environment is user-managed and is not removed by host uninstall.

In Flux Settings, enter a public media URL under **Inspect media** and choose **Inspect media**. The result shows the title, available duration and at most 200 format choices. Track metadata may be unknown; those choices say **tracks unverified**. Selecting a format does not download it yet.

One inspection or retained review owns the companion across Flux tabs. **Cancel inspection**, **Close review**, leaving Settings or closing the manager releases that connection. Reviews expire after ten minutes. An inspection worker stops on cancellation, timeout or parent-pipe closure; the host keeps no resident service or persistent review journal.

The preview supports direct HTTP(S) connections only. Proxy profile parameters are rejected. Ambient proxies, browser cookies, external JavaScript runtimes, impersonation transports, downloaded components and ambient plugins are disabled. Responses must honor identity encoding, and inspection has time/connection/body limits. These restrictions reduce website coverage. Playlists with multiple items are rejected; a single-item HTML playlist wrapper is accepted. See [milestone 3 verification](../docs/verification-companion-03.md) for evidence and limits.

## Approve save folders locally

Milestone 4 now has its destination configuration boundary. Downloads and a destination picker in Settings remain disabled until execution, processing and output verification are implemented. Approving a folder alone does not start a job or create media files.

Run the local command with the companion's Python runtime:

```sh
python3 companion/configure.py approve "$HOME/Downloads" --label "Downloads"
python3 companion/configure.py list
python3 companion/configure.py revoke DESTINATION_ID
```

The installer also copies `configure.py` into the host directory. That copy supports isolated invocation using the installing interpreter:

```sh
python3 -I -B "$HOME/Library/Application Support/Flux/Media Companion/configure.py" list
```

Approval requires an existing folder and a display label. It stores the canonical path and filesystem identity locally in `~/Library/Application Support/Flux/Media Companion Data/destinations.sqlite3`. The directory is owner-only and the database is private to the same OS account. This protects against other users; it does not isolate the companion from software running as you. Folder writability and safe file creation must also be checked when a download starts.

Chrome can request `destinations.list`, which returns at most 50 opaque IDs and labels. Native messages cannot approve/revoke folders or supply paths. A moved, deleted or replaced folder becomes unavailable; approving its replacement creates a new handle. Approving the same folder again updates its label without consuming another slot. Symlinks supplied during local approval are resolved once; retargeting that alias does not redirect the saved approval.

Revocation removes the approval and preserves files in the folder. Host uninstall preserves approvals in the separate data directory. To erase approvals as well, remove that data directory locally after uninstalling. `--data-dir` on the installer and configuration command supports isolated development data; use the same directory with both commands. It is a local installation option, never an extension message parameter.

## Troubleshooting and removal

- If permission is declined, run the check again to grant access.
- If Chrome cannot connect, verify the ID used during installation, the Python runtime and the native registration. Missing host, wrong origin and launcher errors may appear as the same Chrome connection failure; inspect Chrome's native messaging stderr for detail.
- Diagnostics search `/opt/homebrew/bin`, `/usr/local/bin`, `/usr/bin` and `/bin`, not your interactive shell configuration. Tools elsewhere report missing. Version probes are bounded and never return executable paths.
- After changing companion source, uninstall/install to refresh the copied source. Reload Flux after rebuilding extension code.
- The launcher uses Python isolated mode so ambient Python configuration cannot change the host's imports. Homebrew Python 3.13 passed the recorded Chrome acceptance check. The tested pyenv Python 3.11.1 timed out when launched by Chrome even though subprocess tests passed; its cause is unresolved. Use a verified interpreter to run the installer rather than assuming every Python installation works.

```sh
python3 companion/install.py uninstall
```

Uninstall removes this installation's native registration and owned source/launcher files, preserving unrelated files. It refuses mismatched registrations. Existing installations are never overwritten. `--host-dir` and `--manifest-dir` support isolated installer tests; use the same values for uninstall. They do not configure arbitrary Chrome search locations.

## Verification

```sh
python3 -m unittest discover -s companion -p 'test_*.py' -v
npm test -- tests/unit/companion.test.ts
npm run build
```

Python tests cover real framed subprocess communication, local destination approvals and an isolated install/uninstall, without modifying your Chrome registration. TypeScript tests cover diagnostics parsing, protocol mismatch, disconnect, timeout and cancellation.

For an actual Chrome acceptance check after building:

```sh
PYTHON_PATH=/opt/homebrew/bin/python3.13 node scripts/check-companion.mjs
```

Use your installed, supported Python path; the example records the tested runtime. This script launches an isolated Chrome profile, registers the host inside that temporary user-data directory, checks the Settings UI and missing-host behavior, then removes its files. It does not register into your normal profile. The temporary extension pregrants native messaging, so the normal optional permission prompt remains a manual acceptance gate. See the [milestone 2 evidence](../docs/verification-companion-02.md).

The installer copies the `flux_companion` package with an owned-file receipt. Uninstall uses that receipt to preserve unrelated files. The isolated launcher also disables bytecode generation so source cleanup does not leave generated package caches.

Protocol and architecture: [v1 contract](../docs/media-companion-protocol.md), [ADR 002](../docs/architecture/002-optional-media-companion.md), [platform and custom-provider contracts](../docs/media-provider-adapters.md).
