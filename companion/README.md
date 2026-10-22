# macOS development companion

Milestone 2 provides connection diagnostics only. It does not inspect URLs, download media, install media dependencies, or change proxy settings. The packaged end-user installer belongs to milestone 8.

## Install and check

Prerequisites: macOS, desktop Google Chrome, Python 3.10 or later at a stable absolute path, and Flux built and loaded unpacked from `dist`. Keep the same extension folder to preserve its ID. Python is required only for this source-based development setup; distribution will package its runtime.

1. Build Flux with `npm ci` and `npm run build`, then load/reload `dist` through `chrome://extensions`.
2. Copy Flux's extension ID from its extension card.
3. From the repository root, run:

```sh
python3 companion/install.py install --extension-id YOUR_EXTENSION_ID
```

4. Open Flux Settings, choose **Check companion connection**, and grant the optional native messaging permission. The result reports the companion version and whether yt-dlp, FFmpeg and ffprobe can be found and probed. Missing media tools do not prevent connection diagnostics.

The installer registers `com.flux.media_companion` only for that extension ID under `~/Library/Application Support/Google/Chrome/NativeMessagingHosts`. Source, launcher and the host's own allowlist are copied into `~/Library/Application Support/Flux/Media Companion`. The launcher uses the installing Python interpreter's resolved absolute path and does not run shell initialization files. Moving/removing Python requires reinstalling the companion. A changed extension ID also requires reinstalling.

No native registration or permission is needed for ordinary Flux downloads. A failed connection check does not change existing jobs. The check opens a temporary port and closes it after diagnostics; there is no resident process or automatic launch at Chrome startup. It does not install anything until you run the installer.

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

Python tests cover real framed subprocess communication and an isolated install/uninstall, without modifying your Chrome registration. TypeScript tests cover diagnostics parsing, protocol mismatch, disconnect, timeout and cancellation.

For an actual Chrome acceptance check after building:

```sh
PYTHON_PATH=/opt/homebrew/bin/python3.13 node scripts/check-companion.mjs
```

Use your installed, supported Python path; the example records the tested runtime. This script launches an isolated Chrome profile, registers the host inside that temporary user-data directory, checks the Settings UI and missing-host behavior, then removes its files. It does not register into your normal profile. The temporary extension pregrants native messaging, so the normal optional permission prompt remains a manual acceptance gate. See the [milestone 2 evidence](../docs/verification-companion-02.md).

The installer copies the `flux_companion` package with an owned-file receipt. Uninstall uses that receipt to preserve unrelated files. The isolated launcher also disables bytecode generation so source cleanup does not leave generated package caches.

Protocol and architecture: [v1 contract](../docs/media-companion-protocol.md), [ADR 002](../docs/architecture/002-optional-media-companion.md), [platform and custom-provider contracts](../docs/media-provider-adapters.md). No credentials or website URLs are needed for milestone 2.
