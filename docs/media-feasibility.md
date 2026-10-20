# Segmented media: feasibility and acceptance contract

Research date: 2026-10-20. Status: **not implemented or advertised as supported**. This records the next engineering requirements for the requested IDM/AB media capability; it does not replace them with a playlist downloader.

## Source findings

[RFC 8216](https://datatracker.ietf.org/doc/html/rfc8216) defines playlists, alternate renditions, initialization sections, byte-range segments and discontinuities. MPEG-TS and fragmented MP4 need different container handling. A list of segment URLs alone does not establish a valid combined file. This supports a manifest-aware download plan rather than treating a playlist as an ordinary binary file.

[DASH-IF's timing model](https://dashif.org/Guidelines-TimingModel/) describes representation timelines and segment addressing, including numbered/time templates and initialization resources. Audio and video can have distinct timelines. Selecting and joining tracks therefore needs presentation/timescale handling; a simple template string expansion is insufficient evidence of synchronization.

The [W3C ISO BMFF byte-stream format](https://www.w3.org/TR/mse-byte-stream-format-isobmff/) describes initialization and media boxes, fragment addressing and decoder requirements. MSE append acceptance is useful validation, but a downloadable standalone artifact also needs independent duration, seek and playback checks. Arbitrarily concatenating complete MP4 files or repeating initialization metadata is not a validated remux strategy.

The primary [mux.js documentation](https://github.com/videojs/mux.js/blob/main/README.md) offers a browser JavaScript MPEG-TS-to-fragmented-MP4 transmuxer and describes combined audio/video output, timestamps and initialization data. It is a candidate for the TS path, not an installed dependency or proof that arbitrary HLS/DASH export works. Licensing, pinned package contents, worker/CSP behavior, fragment memory use and standalone-file duration still require local evaluation. Separate fragmented audio/video composition needs its own verified approach.

## Required implementation

1. Discover and review public manifest sources under existing capture/host rules. Offer quality, audio/language and output choices. Do not silently turn a detected manifest into an engine download or mistake a playlist file for the finished video. Live recording requires a separate finite stop policy; VOD and live acceptance must be distinguished.
2. Parse a bounded manifest and resolve each child URL against its actual validated response URL. Apply existing credential omission, scheme/private-address, redirect, host-grant, downgrade and loop controls to child playlists, initialization resources and media segments. No arbitrary page JavaScript, cookie scraping, DRM license requests or remote processor is part of this design. Ordinary supported non-DRM encryption requires explicit format/key handling and its own tests, rather than a blanket claim that all encryption is DRM.
3. Persist a selected rendition/track plan, ordered timing/byte-range metadata, immutable plan identity and completed logical-segment checkpoints. Reopening must revalidate both plan identity and stored bytes. Changed plans, initialization sections, codecs or discontinuities need a demonstrated safe merge strategy or an actionable refusal retaining valid partial data.
4. Run container parsing/remuxing in the visible manager's worker. Stage/export through OPFS and File System Access with bounded buffers and backpressure. Feed every payload through bandwidth/allowance controls. Bound per-segment parser state, not just fetch read buffers. Cancellation must abort all outstanding requests and release handles. Integrate transient failures with the 0.6 bounded retry policy without inventing byte-range identity for different segment URLs.
5. Produce an ordinary playable media artifact with correct track metadata and timing. Test separate audio/video, muxed renditions, range-addressed media, alternate audio, missing segments, timestamp gaps, changed resources and long timelines. MP4 hash success alone cannot prove that the output decodes, seeks or stays synchronized.

## Evidence needed before a support claim

Use deterministic, redistributable media fixtures with known visual/audio markers and expected duration. Exercise actual Chrome playback of the exported file, decoded frames, audio presence, start/middle/end seeking and A/V alignment; supplement with an independent container inspection. Test pause/reload/resume, a failed segment after a committed checkpoint, cross-host permission refusal, corrupt segments, storage exhaustion and bounded memory under long/large workloads. Preserve exact input/output fixture hashes and the tested support matrix.

Native tools may generate or inspect development fixtures if available, but the shipped extension must not depend on one. Keep all runtime JavaScript/WASM packaged locally and audit any added dependency. The no-helper/no-backend constraints remain unchanged.
