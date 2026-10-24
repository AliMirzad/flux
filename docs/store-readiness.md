# Chrome Web Store readiness

Applies to 0.10.0. This is a release gate, not a claim of approval. The local package may be evaluated unpacked before submission. Store review and publisher actions are external steps.

## Required before submission

- Build from a clean install and archive the exact versioned distributable ZIP, checksums, dependency lockfile, and release notes.
- Verify the ZIP contains the MV3 manifest at its root, bundled executable assets, working icons, no test fixtures, and no development server dependency.
- Load that exact build in supported Chrome versions on Windows and macOS. Record lifecycle, pause/resume, corruption, permission, recovery, export, and network-failure acceptance results.
- Record measured benchmarks and explicit unverified capacity targets. Describe when acceleration works without promising a fixed multiplier.
- Publish a privacy policy that explains local URL/history/partial-content storage, signed URL sensitivity, retention/deletion, permissions, no telemetry/backend/account requirement, and any actual data sharing. Match the developer-dashboard disclosures to the shipped behavior.
- Provide a single-purpose description: browser-native download management with optional segmented transfers. Include genuine screenshots, exact manager-tab lifetime requirements, direct-URL/authentication limitations, and support/contact information.
- Justify every packaged permission and optional host pattern. Remove unused permissions, including those retained only for hypothetical future features. [Permission policy](https://developer.chrome.com/docs/webstore/program-policies/permissions)
- Confirm all JavaScript/WASM is packaged and reviewable. No remote code or obfuscation should prevent reviewers from determining functionality. [MV3 requirements](https://developer.chrome.com/docs/webstore/program-policies/mv3-requirements)
- Recheck the [current Chrome Web Store policies](https://developer.chrome.com/docs/webstore/program-policies) at submission time and provide reviewers with steps to exercise optional host grants and real transfers.

## Permission review worksheet

| Permission / capability          | Product purpose and review question                                                                                                                                                 |
| -------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| contextMenus                     | Add the user-invoked Download with Flux action.                                                                                                                                     |
| storage                          | Persist extension-level settings or integration state; large content belongs in OPFS.                                                                                               |
| alarms                           | Best-effort scheduling prompts. Confirm no keepalive loop.                                                                                                                          |
| downloads                        | With opt-in capture, pause/probe/durably queue eligible public GETs before canceling Chrome's transfer; preserve unsupported requests. Provide explicit browser fallback.           |
| webRequest                       | Read-only request method/initiator and own-request redirect metadata; bounded memory, no credential headers or request bodies, no blocking listener.                                |
| activeTab                        | User-invoked inspection of ordinary page media; verify the toolbar grant and failure explanation.                                                                                   |
| scripting + optional host access | Register/inject eligible-link capture only after explicit enablement and site grants. No unrelated page scraping.                                                                   |
| optional HTTP(S) host patterns   | Manual addition requests a destination origin; automatic capture explicitly requests HTTP/HTTPS website access once. Explain scope before granting and allow revocation/exclusions. |
| notifications (optional)         | Optional ready-to-save notices; avoid leaking signed URLs.                                                                                                                          |

The current manifest does not include unlimitedStorage, cookies, debugger, nativeMessaging, webRequestBlocking, or offscreen. Reconcile this worksheet again if permissions change. The project should not be described as production ready until critical acceptance gates have actual recorded passes and known security issues have been addressed.
