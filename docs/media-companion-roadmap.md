# Optional media companion roadmap

Date: 2026-10-22. Tracking: [issue #6](https://github.com/AliMirzad/flux/issues/6).

The companion extends Flux with yt-dlp extraction and FFmpeg processing. Ordinary extension downloads remain available without installation. These are implementation milestones, not current support claims.

| Milestone | Deliverable | Exit evidence |
| --- | --- | --- |
| 1. Architecture and contract | Ownership, protocol, lifecycle, storage, security and acceptance decisions | Reviewed ADR and protocol; no runtime claim |
| 2. macOS connection | Native host, development installer and diagnostics | Installed extension connects; missing host, dependency and incompatible-version errors are actionable |
| 3. Media inspection | URL inspection and bounded format/track selection | Supported page returns real title, duration and available qualities without downloading media |
| 4. First complete download | Selected video/audio download, merge and conversion | Independently inspected, playable video and extracted audio saved on macOS |
| 5. Controls and recovery | Progress, cancel, concurrency, persistent history, retry and supported resume | Cancellation covers extraction/download/processing; interrupted work is reconciled without false completion |
| 6. Website compatibility | Representative site/format matrix and targeted fixes | Recorded successes, failures and regression fixtures; PH fixes only for reproduced failures |
| 7. Separate proxy routing | Explicit direct/proxy profiles for native jobs | Extraction, media, DNS and network-capable children verified; browser route remains separate; proxy failure does not silently fall back |
| 8. macOS distribution | Dependency packaging, install/uninstall, updates and signing/notarization | Fresh Mac installs without manual Python/yt-dlp/FFmpeg setup; compatibility and uninstall checks pass |
| 9. Windows distribution | Registration, packaging and platform behavior | Equivalent supported flows pass on a fresh Windows installation |
| 10. Release acceptance | End-to-end evidence, security/license review, docs and artifacts | Supported platform/site/format matrix passes with no release-blocking defects |

Milestone 4 is the first useful macOS checkpoint. Milestone 8 is the macOS beta. Milestone 10 is the cross-platform finish line. Website changes require ongoing extractor maintenance; universal website compatibility is not a release promise.

## Milestone 1 outcome

The design is recorded in [ADR 002](architecture/002-optional-media-companion.md) and the [version 1 protocol](media-companion-protocol.md). Runtime implementation starts at milestone 2. Future native capability does not establish native support today.
