# Media companion milestone 2 evidence

Date: 2026-10-22. Platform: macOS arm64, installed Chrome 155.0.8059.86, Node 26.4.0. Scope: diagnostics only, no media extraction or native download support.

## Implemented

- Optional `nativeMessaging` permission, requested only by the Settings connection check.
- Manager-side bounded hello response validation, ten-second deadline, abort/disconnect cleanup and Web Lock to serialize diagnostics across tabs.
- Python native host with a 256 KiB frame bound, partial-read handling, origin allowlist validation, protocol negotiation and typed rejection of all unimplemented commands.
- yt-dlp/FFmpeg/ffprobe executable availability and bounded version probes; fixed search paths, no shell arguments from the extension and no installation of dependencies.
- macOS development install/uninstall with absolute interpreter paths, isolated Python mode, restrictive file permissions, refusal to overwrite existing installations and preservation of unrelated data.

## Results

| Check                               | Result                                                                                                                         |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| TypeScript unit suite               | 92 tests passed across 13 files, including 9 new companion tests                                                               |
| Existing integration suite          | 68 tests passed across 5 files with one worker                                                                                 |
| Python host/installer/adapter suite | 18 tests passed, including real framed subprocess exchange, installer ownership, provider selection and metadata normalization |
| Extension build and package audit   | Passed; native messaging remains optional in the distributable                                                                 |
| Actual Chrome -> native host        | Passed with Homebrew Python 3.13.5; Settings rendered companion version and dependency status                                  |
| Missing-host recovery               | Passed after removing the temporary registration; a new check cleared old diagnostics and displayed an actionable error        |

Native acceptance uses `PYTHON_PATH=/opt/homebrew/bin/python3.13 node scripts/check-companion.mjs` against a built `dist`. It uses a disposable extension/profile and a registration under that profile's `NativeMessagingHosts`. Native permission is pregranted only in the test copy. The host source and launcher are unmodified installer outputs for the final acceptance run. Temporary profiles and registrations are cleaned up.

After extracting the [adapter boundaries](media-provider-adapters.md), all 18 Python tests and both actual Chrome checks passed again with Homebrew Python 3.13.5. The installed host imports its copied package under isolated Python mode. The TypeScript unit/integration/build results above are from milestone 2; this Python refactor did not change extension code. Provider tests use fixtures and custom adapters, not live yt-dlp extraction. Injecting a fake Windows platform proves host separation, not Windows runtime support.

## Findings and limits

The first browser check registered the host in the normal Chrome directory, which the isolated profile did not search. It failed without launching the host. Registration inside the temporary user-data directory corrected this test setup.

The tested pyenv Python 3.11.1 still timed out under Chrome while its direct subprocess tests passed. Its cause remains unresolved. System Python 3.9.6 passed a diagnostic run, but the supported development setup requires Python 3.10+ and the final acceptance used Homebrew Python 3.13.5. Do not infer compatibility for all Python installations.

The normal Chrome optional-permission prompt, denial/regrant UI, minimum Chrome version, Windows, packaged runtime, signing/notarization and end-user installation remain separate acceptance gates. Cancellation/timeout branches have TypeScript test coverage; no media subprocess lifecycle is claimed. The diagnostics connection closes after its response and does not establish background execution. Extraction, media jobs, destination management, proxy profiles, journal recovery and dependency updates remain future milestones.
