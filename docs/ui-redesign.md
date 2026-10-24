# Flux UI redesign — implementation and verification

## Integration status after 0.10 review, 2026-10-21

The shared redesign is preserved in 0.10. The reviewed build passes the complete 20-case capture suite, including script-generated blob takeover and original-copy cleanup. The earlier failure notes below are historical candidate results. The cookie indicator is now an actual per-download control limited to the original source origin; a real Chrome test verifies unchecked behavior and unrelated-CDN cookie omission. Fixed referrer/user-agent behavior is shown as text. Separate fMP4 audio/language selection is integrated into Advanced HLS review. Final broad evidence is recorded in [0.10 verification](verification-0.10.md).

## Follow-up: simpler shell and download details

The avatar/quick menu was removed. Sidebar spacing now adapts to viewport height, with every
navigation destination verified inside the sidebar at heights from 480 to 941px without scrolling.
Decorative footer content is reduced in short windows so navigation remains accessible.

Download details now opens with a compact overview: file identity, progress, three transfer metrics,
source URL and basic metadata. Editable filename, queue, priority, connection and scheduling fields
have their own Settings tab. Connections and Timeline remain separate. Saving provides a visible
confirmation, and persisted values were verified by reopening the dialog. Light/dark and narrow
layouts were rendered and inspected. The build and all four tests in `redesign.spec.ts` passed.

Additional modified file: `src/ui/manager/Details.tsx`.

The final details pass keeps all tab panels mounted so unsaved field edits survive switching tabs.
Tab/panel associations and Arrow / Home / End keyboard navigation are implemented. Editing after
a successful save clears the old success message. The overview stays compact and connection
statistics remain available for both Flux and Chrome-managed jobs.

## Implemented screens and flows

The redesign covers the manager shell, dashboard, download rows, empty states, toolbar,
filters, bulk actions, popup (empty and active), manual and intercepted Add Download,
General / Advanced / Schedule tabs, multiple-link review, numbered-series generation,
text/JSON import, queue list/editor/file controls, download details, media discovery,
all settings groups, permissions, and local storage controls.

Multiple-link entry now starts with pasting or importing links. Numbered-series generation
is available in an expandable section. Selection counts, select/deselect all, filtering,
queue choice, and adding paused downloads are retained. No fabricated jobs are shipped.

Settings have section shortcuts, separate connection-mode / connection-count / speed-limit
cards, two-column category-folder fields with category icons, and clearer grouped switch rows.
The browser-download explanation in the saving banner is expandable rather than always
occupying the main workspace.

## Shared design system

- One ordered `theme.css` entry point avoids different CSS chunk order in popup and manager.
- Light surfaces: off-white / white, navy text, emerald accent. Dark surfaces: navy / charcoal,
  elevated blue-gray inputs, teal accent. Existing theme persistence and system preference remain.
- Shared 9px controls, 13px cards, 18px dialogs, thin borders, restrained shadows and gradients.
- Light accent text/buttons use #008672 (4.51:1 against white) and hover #007d69 (5.08:1).
- Dialog content scrolls within the viewport, with visible action rows. Popup height is bounded
  at 600px; long download lists scroll independently.
- Arrow-key / Home / End navigation and panel relationships were added to Add Download tabs.
- Dropdown arrows are local SVG assets, compatible with the extension's existing CSP.
- Reduced-motion preferences are respected.

## Files changed in this phase

- `src/ui/tokens.css`
- `src/ui/theme.css` (new ordered entry point)
- `src/ui/redesign.css` (new shared presentation layer)
- `src/ui/assets/chevron-down.svg` (new)
- `src/ui/manager/main.tsx`
- `src/ui/manager/AddDownload.tsx`
- `src/ui/manager/BatchDownloads.tsx`
- `src/ui/manager/Queues.tsx`
- `src/ui/manager/SaveSetup.tsx`
- `src/ui/popup/main.tsx`
- `src/ui/popup/popup.css`
- `src/ui/popup/popup-refresh.css`
- `src/ui/settings/Settings.tsx`
- `tests/browser/redesign.spec.ts` (new)
- `tests/browser/capture.spec.ts` (two assertion corrections described below)

The worktree already contained other user edits. Those edits were retained. This phase did
not modify the engine, service worker, messaging schema, permission manifest, or storage model.

## Verification

| Check                                                 | Evidence / result                                                                                                                                                                                                |
| ----------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| TypeScript and production build                       | Passed, including packaged MV3 audit                                                                                                                                                                             |
| Unit/integration suite                                | 20 files, 187 tests passed                                                                                                                                                                                       |
| New UI/browser suite                                  | 4 tests passed; both themes, persisted preferences, keyboard tabs, preserved unsaved edits, batch import/selection, real pause/resume, captured queue choice, embedded dialog, sidebar fitting 480–941px heights |
| Responsive UI                                         | Screenshots and overflow checks at 1672, 1000, 760, 620 and 390px; manager, settings, Add Download and batch dialog                                                                                              |
| Existing advanced / extension / capture-dialog suites | 12 tests passed                                                                                                                                                                                                  |
| Existing media suite                                  | All 12 passed when run with their required preceding media fixtures                                                                                                                                              |
| Category folders / save-dialog checks                 | All 4 selected tests passed                                                                                                                                                                                      |
| Existing capture suite                                | Not fully clean; see remaining issue below                                                                                                                                                                       |

Actual Chrome screenshots are in `test-results/redesign/`, including:

- `light-dashboard.png`, `dark-dashboard.png`
- `light-add-general.png`, `dark-add-advanced.png`, both Schedule variants
- `light-batch-review.png`, `dark-batch-empty.png`
- `light-settings-transfers.png`, saving/browser/storage variants in both themes
- `light-popup.png`, `dark-popup-active.png`
- `dark-queue-files.png`, queue editor variants
- `dark-capture-queue-chooser.png`, `dark-captured-add-{general,advanced,schedule}.png`
- `responsive-{width}.png`, `responsive-{add,batch,settings}-{width}.png`

These are screenshots of the installed extension in temporary Chrome profiles, not mockups.

## Remaining regression issue

The full capture run still fails the scripted-blob cleanup case: Flux creates a verified
completed job, but the original browser blob download can remain on disk / in Chrome's list.
The later exclusion and queue-choice cases fail after Playwright restarts the shared fixture
following that failure. Both later cases pass in the independent capture run, and queue choice
also passes in the new standalone UI test. The background cleanup root cause is not claimed
resolved by this visual redesign.

Two test assertions were corrected without changing production download code:

1. Native takeover now expects the canceled Chrome record to be erased, matching the current
   background handler's explicit `chrome.downloads.erase` call.
2. Blob cleanup is polled rather than checked immediately after the job completes; this retains
   the zero-duplicate requirement and still exposes the remaining cleanup failure.

The current full capture result is 16 passed / 3 failed. An independent run excluding the two
original problematic cases passed all 17 remaining cases before the first assertion correction.
The capture suite must not be described as entirely passing.

## Visual differences from the references

The reference illustrations are approximated with CSS/vector decoration. No source font or
original illustration assets were supplied. Existing supported controls, descriptive text and
real browser limitations take priority over concept-only controls. This is a cohesive redesign,
not a claim of pixel-for-pixel identity with every concept image.
