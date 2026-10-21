# MPEG-TS development evidence and remaining integration

Date: 2026-10-21. This is the historical prototype record; its observations are superseded by the integrated [0.8 review](code-review-0.8.md) and [verification](verification-0.8.md). TS is **not part of the installed 0.7.0 support claim**. The broader media goal remains open.

The [mux.js primary documentation](https://github.com/videojs/mux.js/blob/main/README.md) describes its MPEG-TS-to-fMP4 pipeline, combined output and timestamp options. [RFC 8216](https://datatracker.ietf.org/doc/html/rfc8216) remains the HLS format reference. Runtime integration must satisfy the original [media acceptance contract](media-feasibility.md), rather than merely saving a list of segments.

## Reproducible fixture

`tests/fixtures/generate-ts.mjs` takes the project's own synthetic H.264/AAC MP4 samples and produces PAT/PMT/PES/ADTS/Annex-B MPEG-TS packets with continuity counters, PCR and PTS/DTS. It requires Node only for fixture generation, not for extension execution. Binary files use `.mpegts` locally so TypeScript does not parse transport bytes as source; playlist URLs use the ordinary `.ts` extension. Four generated resources total 82,908 bytes. Per-resource hashes are in `tests/fixtures/media/ts-fixture.json`.

An isolated `.bench/media-tools` dependency evaluation pins mux.js 6.3.0 (Apache-2.0). The extension's package dependencies, installed files and release ZIP were not changed by that evaluation. The downloaded package and dependency tools stay outside the distributable.

## Standalone output experiment

The development pipeline feeds generated TS in 564-byte chunks to the transmuxer. Its raw initialization uses unknown 32-bit movie/track durations and its generated single-track moofs rely on an implicit first-traf base. Before independent-file validation, the experiment zeroes fragmented initialization durations, marks the equivalent relative moof base explicitly and normalizes the common one-second source timeline origin. Audio/video offsets and sample addresses are preserved.

An independent Chrome page decoded the resulting 54,156-byte MP4: duration 4.110767 seconds, 160×90, red/green/blue at 0.5/2/3.5 seconds, decoded 440/880/1320 Hz with RMS about 0.0707, audio duration 3.946667 seconds. Output SHA-256: `4ea97f117db0e4f5bc4b3fe77f14cb014c40a54a36694ce76012e4fb28289a2f`. The experiment and exact result are `.bench/check-ts.mjs` and `.bench/ts-playback-proof.json`. This proves a candidate container/playback path, not integrated download/resume acceptance.

## Findings that must be resolved before integration

- The candidate ADTS parser advances its loop by the untrusted frame length without first rejecting zero/undersized frames. A zero length can make no progress. Do not ship an unguarded parser. Pin and verify any corrective vendor patch, retain its license/notice and test malformed input.
- Candidate video code can retain GOPs and pull a later keyframe when a segment begins without one. Resume must preserve sample identity and timeline continuity; starting an arbitrary fresh converter for a missing part is not yet proven equivalent to the uninterrupted output.
- The existing 0.7 MP4 path requires all tracks in the first moof. The candidate emits an audio moof/mdat followed by a video moof/mdat in each combined logical part. Common-origin selection must inspect first occurrences of both tracks before writing fixed-width timestamps.
- Bound source bytes, packet/PES/NAL/sample counts and output/metadata sizes, including before large allocations inside a parser. A bounded fetch read buffer alone does not bound the converter's retained fragment/GOP state.
- Add ordered source/output checkpoint mapping, allowance/throttle integration, cancellation, validator/source-change handling and full-context resume tests. Verify independent playback again on the actual extension's exported output, then update the support matrix.
- Separate audio/language rendition composition, discontinuities, ordinary non-DRM encryption, live recording and DASH still require their own implementations and evidence.
