# Optional website permissions regression — 2026-10-22

A fresh Flux installation registered both network observers before the user granted website access. Chrome reported a webRequest host-permission error. The release manifest intentionally keeps HTTP/HTTPS access optional.

The background worker now discovers granted origins before registering observers and limits their filters to approved HTTP/HTTPS patterns. Permission changes reconcile the filters; removing the last grant removes both observers. Registration runs on each worker evaluation. A `prepare-request` response waits for reconciliation before allowing a download's probe to start, preserving redirect metadata after worker dormancy. Observation remains independent of the automatic capture setting.

## Verification

- All 180 TypeScript unit/integration tests passed, including seven observer lifecycle tests. Local HTTP fixture servers required execution outside the filesystem sandbox.
- Chrome 155 passed all 15 automatic capture cases and all three redirect cases, including a narrow host grant, an unapproved CDN host and background termination before a redirect download.
- A new browser regression uses the release manifest unchanged, enables developer mode in a disposable profile, and reads Chrome's actual extension error collection. Fresh startup and an explicit request after background termination both leave runtime errors/warnings and manifest errors empty. The unapproved request still returns the required permission origin.
- Negative control: the previous committed background code, bundled into a temporary extension, reproduced the exact reported error twice on startup. The new browser check therefore examines an error collection that detects this failure.
- Typecheck, production build, package audit, changed-file formatting and whitespace checks passed.

The redirect tests now accept either “Ready to save” or “Completed,” since the existing automatic save flow can finish before the assertion. The worker restart case still verifies the final SHA-256 checksum.

Reload the unpacked extension from `dist` to use the fix. Chrome may retain the old error entry until it is cleared in the extension's Errors view.
