# Milestone 4 destination checkpoint

Date: 2026-10-22. This records the first part of milestone 4. Native downloads remain disabled, and milestone 4 is not complete.

## Implemented behavior

`companion/configure.py` approves, lists and revokes existing folders through an explicitly invoked local command. The development installer also packages this command. SQLite persists at most 50 approvals in a separate owner-only data directory, outside the installation receipt. Reinstall and uninstall preserve approvals and user media.

Approvals bind a canonical path to the macOS device, inode and creation time. Reapproving the same identity reuses its UUID and updates the label. Missing or replaced directories are omitted from native listings. Revocation is idempotent. SQLite transactions serialize concurrent approvals and enforce the limit.

The host advertises `destinations.list`, negotiates before serving it, accepts only empty parameters and projects IDs and labels. Native approval/revocation operations remain unsupported. Storage failures return a bounded error without local paths. The configuration command and installer can select an isolated data directory locally; Chrome cannot supply one.

Platform-specific file permissions, database link checks and directory identity live in `MacOSPlatform`. Windows needs equivalent access control and identity handling behind that interface. This checkpoint establishes macOS support only.

## Verification

- 46 Python tests passed with Python 3.14.4, including 16 destination tests. Resource warnings were treated as errors.
- New cases cover persistent approvals, canonical aliases, changed folder identity, simulated inode reuse with changed creation time, revocation, preservation of existing media, invalid inputs, concurrent approvals, the 50-folder limit, unsafe permissions, database/sidecar links, corrupt data, future schema versions and native capability gates.
- A copied, isolated configuration command and a real framed installed host shared the same test approvals. Uninstall preserved the test database and save folder while removing owned configuration source.
- Type checking, Vite build and extension package audit passed. No extension application code changed in this checkpoint; the 99 TypeScript unit tests and 68 browser-engine integration tests remain earlier evidence.
- Chrome 155.0.8059.86 passed real manager diagnostics, local approval/revocation across native sessions, opaque handle projection, rejection of remote path/approval requests and missing-host recovery. The acceptance script used the pinned Homebrew Python 3.14.4 runtime and unmodified installer output.
- Chrome acceptance ran in a disposable profile with temporary registration and destination data. Cleanup removed that registration and data. Native messaging was pregranted only in the temporary extension; the normal permission prompt remains a manual gate.

Commands:

```sh
/opt/homebrew/Cellar/yt-dlp/2026.3.17_1/libexec/bin/python -B -W error::ResourceWarning -m unittest discover -s companion -p 'test_*.py'
npm run build
PYTHON_PATH=/opt/homebrew/Cellar/yt-dlp/2026.3.17_1/libexec/bin/python node scripts/check-companion.mjs
```

## Remaining milestone 4 work

Destination lookup returns a private path and checks its current identity. It does not reserve or open the directory for writing. The download implementation must revalidate and hold the approved directory while creating confined staging files, avoid symlink races and prevent overwrites at publication. This API alone is not a safe file writer.

Job creation, durable finalization, provider execution, guarded media transfer, offline merging/conversion and ffprobe verification are not implemented. A successful folder listing establishes neither writability nor playable output. The inspection worker still forbids filesystem writes and external execution. Milestone 4 exits only after independently verified video and extracted audio are saved through the complete supported flow.
