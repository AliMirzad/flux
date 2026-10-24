# Release acceptance outside the automated fixture environment

Candidate: 1.0.0-rc.1. The automated Windows report is [release-acceptance-v1.md](release-acceptance-v1.md). These checks are prepared, **not recorded as passes**. A macOS device was unavailable on 2026-10-24. Native Chrome permission bubbles and operating-system file pickers are not exercised by headless fixture pregrants or browser-storage picker substitutes.

## Installation and upgrade

1. Record OS version, Chrome version, candidate ZIP SHA-256, date and tester.
2. Back up an existing unpacked extension folder. Keep its exact absolute path and existing Chrome extension card; replacing a folder at a different path creates a separate identity and storage.
3. Replace files in that same folder with the candidate. Reload its existing extension card, then refresh the website tab. Confirm Settings → Check download integration reports version 1.0.0, an active listener and the expected capture setting. The sidebar displays 1.0.0-rc.1.
4. Confirm existing queue names, settings, completed history and a paused transfer remain. Resume the paused file and compare its independently supplied checksum.
5. For a fresh installation, confirm no website access is granted before a user action. Enable capture, approve Chrome's website-access prompt, refresh an already-open site and click an ordinary file link. Confirm one Flux row and no duplicate Chrome transfer. Disable capture and confirm the original Chrome download works again.

## Native permissions and destination writes — Windows and macOS

1. Add a public URL on a previously ungranted origin. Deny the website prompt: no transfer may occur. Retry, grant it and verify successful download. Revoke the site grant while paused; resume must explain the missing access and retain partial content.
2. Download a known file with an independent SHA-256. Choose Save as, cancel the real OS picker and confirm the verified job remains ready to save. Choose Save as again, approve a destination and compare the saved file independently.
3. Choose download folder, deny/cancel first, then select a writable folder. Enable automatic saving, download two files with the same name and confirm neither existing file is overwritten. Restart Chrome, reopen the manager and verify folder permission is rechecked.
4. Revoke destination access or make the directory unavailable. Confirm saving fails clearly while staged content remains verified and can be saved elsewhere.
5. Enable Chrome's “Ask where to save each file” option. Confirm the native save-dialog explanation and recommended destination setup remain usable.
6. Turn notifications/sound on in a user gesture. Confirm the filename-only notice and audible tone, including after reopening. Disable them and confirm no completion feedback is emitted.

## macOS lifecycle and large files

1. Repeat basic transfer, pause/resume, manager closure/recovery, full Chrome restart, capture, category folders and Save as on actual Chrome/macOS.
2. With adequate free disk, run `npm ci`, `npm run check`, set `CHROME_PATH` to the installed Chrome executable, then run `npm run test:browser`, `npm run benchmark` and `npm run test:capacity`. Capacity requires two complete copies plus at least 2 GiB headroom. `FLUX_TEST_ROOT` can point to a dedicated test volume. Profiles are isolated; never point at a personal Chrome profile.
3. Provide the original unpacked 0.10 artifact through `FLUX_UPGRADE_FROM` for upgrade acceptance. Without it, the upgrade test explicitly skips; a skip is not an upgrade pass.
   Set `FLUX_CAPACITY_NATIVE=1` to add a real Chrome Downloads API write and an independent filesystem SHA-256 check after the browser writable-stream export. The harness uses an isolated test destination, not a personal Downloads folder. `FLUX_CAPACITY_REPORT` can select a separate evidence file.
4. The manually dispatched [acceptance workflow](../.github/workflows/acceptance.yml) prepares Windows/macOS runners and uploads evidence; optional capacity runs need sufficient runner disk. The workflow has not been uploaded or run by this local task. Native dialogs still require this checklist after automated success.

Do not reinterpret orderly browser-restart tests as power-loss, filesystem-crash or OS-crash durability guarantees. Chrome 120 remains the manifest floor, not a separately tested browser version. Record minimum-version acceptance before claiming that release range is verified.

## Distribution owner actions

Provide publisher identity, a support/contact address and a hosted privacy-policy URL; reconcile store disclosures and submit the exact checked archive. No store upload, public release, commit or push is part of this local preparation. Stable cross-platform release remains gated on actual macOS/native-consent acceptance or an explicit narrower release scope.
