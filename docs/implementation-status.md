---
document_id: FLINK-IMPLEMENTATION-STATUS
version: 1.0.10-phase2-manual-fit-removal
updated_at: 2026-09-10
scope: Phase 1 and Phase 2
status: phase_2_runtime_1_0_10_manual_fit_removal_pending_ci_and_device_regression
---

# Flink implementation status

This ledger separates implemented source, local verification, CI verification, and device verification. Runtime `1.0.6` retained the `isEqual(_:)` physical-identity repair, but device testing still returned `E_PATH_OUTSIDE_LIBRARY` during rename. Runtime `1.0.7` uses Foundation's promised-item resource values and concurrent source, parent, and library-root access intents. Runtime `1.0.8` adds a fixed, path-free diagnostic ID for rename/delete path-boundary rejections. Runtime `1.0.9` rebuilds every preflight operation URL from validated relative components beneath the current app-owned library root; the user then confirmed rename succeeds. Runtime `1.0.10` removes the manual `ページ全体` bridge and UI, while retaining automatic fit for opening, navigation, and layout changes. This intentional API removal raises the native API to 2. Its IPA and device regression are pending, so the Phase 2 exit gate is not claimed.

Process exception: before the repository's no-Git inspection constraint had been fully read, Codex ran read-only local `git status`, `git diff`, and `git log` inspection commands. No Git write, checkout, commit, tag, push, remote query, or GitHub operation was performed. Phase 1 evidence, native-signature inputs, and verification scripts do not depend on Git state; no further Git commands were used after the constraint was identified.

## Status vocabulary

`NOT_STARTED`, `IMPLEMENTED_UNVERIFIED`, `LOCAL_VERIFIED`, `CI_VERIFIED`, `DEVICE_VERIFIED_IPHONE`, `DEVICE_VERIFIED_IPAD`, and `BLOCKED` have the meanings defined in `03_implementation_plan.md`.

## Environment inventory

| Item | Observed or selected value | Evidence / status |
|---|---|---|
| Project entry | `expo-router/entry`; routes under `src/app/` | LOCAL_VERIFIED by file inspection |
| Package manager | npm 11.16.0; `package-lock.json` lockfileVersion 3 | LOCAL_VERIFIED |
| Local Node | 24.18.0 | LOCAL_VERIFIED |
| Expo | 57.0.21 (SDK 57) | LOCAL_VERIFIED from lock/install |
| React Native | 0.86.3 | LOCAL_VERIFIED from lock/install |
| React | 19.2.3 | LOCAL_VERIFIED from lock/install |
| Expo Router | 57.0.20 | LOCAL_VERIFIED from lock/install |
| TypeScript | 6.0.3 range selected by the SDK template | LOCAL_VERIFIED from lock/install |
| Native directories | `ios/` and `android/` are generated and ignored | LOCAL_VERIFIED by file inspection |
| CNG | enabled; generated native directories are not committed | CI_VERIFIED generation in run 7 |
| Deployment target | iOS / iPadOS 18.0 | CI_VERIFIED from packaged app metadata in run 7 |
| Bundle identifier | `com.aioi.flink` | User-selected value; LOCAL_VERIFIED configuration |
| Device families | iPhone + iPad (1 and 2) | CI_VERIFIED from packaged app metadata in run 7; devices pending |

Expo SDK 57's versioned reference records React Native 0.86, React 19.2.3, minimum Node 22.13.x, minimum iOS 16.4, and minimum Xcode 26.4. The selected Node 24.18.0, deployment target 18.0, and Xcode 26.6 satisfy those documented minima. This is a compatibility check, not a native build or device result.

Official references checked on 2026-09-10:

- <https://docs.expo.dev/versions/v57.0.0/>
- <https://docs.expo.dev/versions/v57.0.0/config/app/>
- <https://docs.expo.dev/versions/v57.0.0/sdk/dev-client/>
- <https://docs.expo.dev/versions/v57.0.0/sdk/filesystem/>
- <https://docs.expo.dev/versions/v57.0.0/sdk/document-picker/>
- <https://developer.apple.com/documentation/foundation/nsfilecoordinator/coordinate%28writingitemat%3Aoptions%3Awritingitemat%3Aoptions%3Aerror%3Abyaccessor%3A%29>
- <https://developer.apple.com/documentation/foundation/nsfilecoordinator/coordinate%28with%3Aqueue%3Abyaccessor%3A%29>
- <https://developer.apple.com/documentation/foundation/nsfileaccessintent>
- <https://developer.apple.com/documentation/foundation/url/promiseditemresourcevalues%28forkeys%3A%29>
- <https://github.com/actions/runner-images/blob/main/images/macos/macos-26-arm64-Readme.md>
- <https://docs.github.com/en/rest/releases/releases?apiVersion=2022-11-28>
- <https://cli.github.com/manual/gh_release_create>

## Selected native toolchain

| Item | Pinned value | Verification boundary |
|---|---|---|
| Runner | `macos-26`, arm64 | CI_VERIFIED in workflow run 7 |
| Xcode | 26.6, `Xcode_26.6.app` | CI_VERIFIED as Xcode 26.6 build 17F113 |
| Node / npm | 24.18.0 / 11.16.0 | LOCAL_VERIFIED |
| Ruby | 3.4.10 | CI_VERIFIED in workflow run 7 |
| CocoaPods | 1.17.0 exact | CI_VERIFIED; resolved lock is recorded locally |
| SDK / destination | `iphoneos` / `generic/platform=iOS` | CI_VERIFIED; packaged metadata reports `iphoneos26.5` and the generic device destination |
| Code signing | disabled by design | CI_VERIFIED; unsigned `.app` and IPA checks passed |

The machine-specific Xcode application directory is recorded for the future workflow but excluded from the runtime signature projection. The signature manifest contains logical relative input IDs only.

## Phase 1 task ledger

| Task | Status | Evidence / remaining work |
|---|---|---|
| P1-01 Existing project inspection | LOCAL_VERIFIED | `package.json`, lockfile, `app.json`, Router entry, TypeScript config, scripts, ignored native folders, and absent prior workflows were confirmed from project files. See the process exception above for the initial read-only Git inspection. |
| P1-02 Version ledger | LOCAL_VERIFIED | Actual dependency versions and SDK 57 documented minima are recorded above. |
| P1-03 Native toolchain | CI_VERIFIED | `config/native-toolchain.json` records exact versions; run 7 verified the pinned macOS/Xcode/Ruby/CocoaPods toolchain and supplied the resolved Pod lock. |
| P1-04 App configuration | LOCAL_VERIFIED | `plugins/with-flink-ios.js` enforces identity, tablet/orientations, sharing, camera text, deployment target, profile-scoped LAN, and no arbitrary loads. Both profiles passed public + introspected config checks. |
| P1-05 Dev client and local module scaffold | LOCAL_VERIFIED | SDK-compatible dev client and local-module/autolinking scaffold exist and appear in Expo introspection. Native compile remains Phase 2. |
| P1-06 Typed native API v1 contract | LOCAL_VERIFIED | TypeScript contract, validation, mocks, and explicit unavailable-native behavior passed the aggregate local checks. |
| P1-07 Pure domain tests | LOCAL_VERIFIED | Blink, library, reader, validation, and stale-response unit coverage passed the aggregate local checks. |
| P1-08 Static CI foundation | LOCAL_VERIFIED | Linux checks and fail-closed iOS preflight draft added. Static contract tests passed locally. |
| P1-09 Native signature | CI_VERIFIED | Run 7 recorded the historical runtime 1.0.5 development signature `1983454e6ddbcd9ef947f7af56ea2441655f5deba15d23ef93fd4fe62e9a544f`. Runtime 1.0.10 changes native inputs and native API version, so its development signature is intentionally unrecorded until CI builds it. No generated metadata, Git state, or absolute manifest path is hashed. Production remains intentionally unrecorded. |
| P1-10 Fixture plan and ledger | LOCAL_VERIFIED | Small non-overwriting generator, artificial blink JSON, and preparation notes added. Large/encrypted/realistic inputs remain ungenerated. |

## Phase 2 task ledger

The native framework and unsigned IPA boundaries are verified by CI. Runtime behavior remains subject to the two physical-device gates.

| Task | Status | Evidence / remaining work |
|---|---|---|
| P2-01 Storage | IMPLEMENTED_UNVERIFIED | `Documents/library`, private Application Support staging, bounded cache roots, owned-partial cleanup, blocked-path handling, and component/symlink root checks are implemented. Files-app visibility and deletion/recreation require a device. |
| P2-02 Files service | IMPLEMENTED_UNVERIFIED | Recursive metadata-only PDF scan, process-local opaque IDs, revisions, stable scan coalescing, partial warnings, and typed errors are implemented without opening PDFs during scan. External-provider behavior requires devices. |
| P2-03 Import coordinator | IMPLEMENTED_UNVERIFIED | Multi-select native picker, security scope, coordinated reads, 1 MiB streaming copy, capacity checks, cancellation, owned partial cleanup, atomic no-replace commit, collision suffixes, and partial success are implemented. Provider, 3 GiB, ENOSPC, and race cases require CI/device execution. |
| P2-04 Mutations and presenters | IMPLEMENTED_UNVERIFIED | Runtime 1.0.6 still rejected rename with `E_PATH_OUTSIDE_LIBRARY`. Runtime 1.0.7 uses `promisedItemResourceValues(forKeys:)` inside `.forMoving` / `.forDeleting` accessors as Foundation requires and coordinates source, existing parent, and library root as concurrent intents. Runtime 1.0.8 adds fixed, path-free diagnostics. Runtime 1.0.9 rebuilds the resolve, rename, and delete preflight URLs from validated indexed relative components below the current root, then retains symbolic-link, fingerprint, coordinator, and physical-identity validation; the user confirmed rename succeeds. The runtime 1.0.10 replacement build remains pending. |
| P2-05 PDF view | IMPLEMENTED_UNVERIFIED | Runtime 1.0.5 device observation confirmed PDF content display, previous/next navigation, and page-number jumps. Runtime 1.0.10 removes the manual current-page fit/zoom-reset button and native API. Private automatic fitting remains for opening, navigation, layout changes, and lifecycle resume. Device confirmation of the new build and device identity/OS are still unrecorded. |
| P2-06 Thumbnails | IMPLEMENTED_UNVERIFIED | Serial bounded queue, request cancellation/coalescing, page-0 PDFKit rendering, 512 px output, revision cache key, 32 MiB decoded/128 MiB disk limits, reader priority, memory warning, and thermal pause are implemented. Cache and pressure behavior requires devices. |
| P2-07 Face coordinator | IMPLEMENTED_UNVERIFIED | Runtime capability/authorization checks, one explicit shared ARSession, left/right/jaw coefficients, face identity, 128-sample pull buffer, monotonic timestamps, overflow discard, heartbeat watchdog, lifecycle/interruption, and thermal stops are implemented. ARKit values require both devices. |
| P2-08 Face debug | IMPLEMENTED_UNVERIFIED | Release-capable opaque white presentation, dark face mesh with white openings, shared session, no camera-frame export, covered ARSCNView, and rendering-off behavior are implemented. The no-camera-frame guarantee must still be visually inspected on both devices. |
| P2-09 Context and runtime metadata | IMPLEMENTED_UNVERIFIED | Process-local ContextBroker rejects stale/suspended reader, generation, epoch, and sample-time combinations. Run 7 verified and published embedded 1.0.5 metadata; replacement 1.0.10 / API 2 metadata is pending, and broker behavior still requires devices. |
| P2-10 Native smoke screen | IMPLEMENTED_UNVERIFIED | Minimal iOS screen exercises init/scan/import/cancel/rename/delete/thumbnail, PDF open/navigation, capabilities/permission/start/stop/reset/drain, numeric coefficients, debug face, and runtime metadata. Runtime 1.0.10 removes the manual page-fit control while retaining automatic fitting inside the native view. |
| P2-11 CI and first IPA | CI_VERIFIED | Workflow run 7 for `dev-runtime-v1.0.5` / source `c23ff74adfc37c439a98652106e461dca222a4eb` completed Linux preflight, pinned macOS build, app/IPA inspection, checksum verification, and GitHub Release publication. It remains valid historical evidence; runtime 1.0.10 now needs a replacement build. Same-tag rerun behavior remains tracked separately by TC-D08. |

## Native runtime state

| Field | Value |
|---|---|
| Native API | 2 |
| Native runtime version | 1.0.10 (manual-fit-removal build pending) |
| Algorithm | SHA-256, signature input schema 1 |
| Recorded installed signature | development: unrecorded for 1.0.10 / API 2; production: unrecorded. The 1.0.5 value remains in its Release metadata. |
| CocoaPods lock | resolved at `native-locks/ios/Podfile.lock`; SHA-256 `42765a460401c3c0803aeb5e32e1f296a270c75f23a209f49c97f57c8e99ad49` |
| Installed build metadata | Pending for 1.0.10 / API 2; stale 1.0.5 metadata was removed from the canonical comparison path and remains in `releases/assets/1.0.5`. |

Until 1.0.10 metadata is recorded, `native:check -- --profile development` must return `unresolved` with no mismatches, while `--require-resolved` must fail closed. Production remains unrecorded and must be checked explicitly only when a production runtime is prepared.

## Local evidence recorded so far

| Date | Command / check | Result |
|---|---|---|
| 2026-09-10 | `node scripts/native-signature.mjs --json --manifest` | Passed; deterministic logical manifest generated, Pod lock reported unresolved |
| 2026-09-10 | `node scripts/native-check.mjs --json` | Passed as `unresolved`; no mismatch fabricated |
| 2026-09-10 | `node scripts/native-check.mjs --require-resolved` | Failed as required while the Pod lock and installed runtime metadata are absent |
| 2026-09-10 | `node scripts/ci/validate-workflows.mjs` | Passed for TC-D05 / TC-D06 / TC-D07 static policy |
| 2026-09-10 | `npm run verify:ci` | Passed static policy for TC-D02 / TC-D05 / TC-D06 / TC-D07 / TC-D08; no macOS job was run |
| 2026-09-10 | build-input validator with `v1.0.0` / production / exact tag ref | Passed |
| 2026-09-10 | Phase 2 Swift source contracts | Passed storage/import/PDFKit/thumbnail/ARKit/face-debug/lifecycle static checks; this does not compile an iOS build |
| 2026-09-10 | release policy contracts | Passed Release provenance, tag resolution, checksum, rerun, and immutable/mutable behavior checks |
| 2026-09-10 | Expo Apple autolinking resolution | Passed; the local `FlinkNative` module is resolved for Apple platforms |
| 2026-09-10 | `vitest run tests/contracts` | 5 files, 36 tests passed |
| 2026-09-10 | `npm run verify:config` | Passed for production and development public/introspected configs |
| 2026-09-10 | `npm run verify:local` | Passed after the final clean install: typecheck, lint, 8 files / 114 tests, two-profile config, native check, and CI policy |
| 2026-09-10 | first manual `iOS unsigned IPA` run for `dev-runtime-v1.0.0` | Stopped in Linux preflight: a profile-separation contract test inherited `FLINK_BUILD_PROFILE=development`; macOS build and Release publication did not start |
| 2026-09-10 | profile-hermetic regression check | Passed the 13 native-signature contracts with both `FLINK_BUILD_PROFILE=development` and `production` after making the test profiles explicit |
| 2026-09-10 | second manual `iOS unsigned IPA` run for `dev-runtime-v1.0.1` | Reached the macOS build and failed compiling `FaceSessionCoordinator.drainSamples` because the lock-wrapper result was not returned; Release publication did not start |
| 2026-09-10 | face drain return regression check | Added a source contract for `return try withStateLock`; the focused 7-test Phase 2 native source suite passed |
| 2026-09-10 | third manual `iOS unsigned IPA` run for `dev-runtime-v1.0.2` | Xcode build succeeded; post-build verification inspected the Xcode 26 Debug stub instead of `Flink.debug.dylib` and stopped before IPA publication |
| 2026-09-10 | Xcode Debug dylib inspection regression check | Build verification now checks the app executable and Debug implementation dylib for device architecture, framework links, native module registration, and Dev Launcher evidence; the focused workflow-policy suite passed |
| 2026-09-10 | final pre-publication-repair Phase 2 `npm run verify:local` | Passed after the profile-test, Swift return, and Debug dylib verifier repairs: typecheck, lint, 11 files / 137 tests, two-profile config, native check with zero mismatches, and TC-D02 / TC-D05–TC-D08 static CI policy |
| 2026-09-10 | fourth manual `iOS unsigned IPA` run for `dev-runtime-v1.0.3` | Linux preflight, native compile, app inspection, IPA packaging, and local release-file verification succeeded. Publication created a Draft Release, then failed because the script used the published-only release-by-tag REST endpoint to retrieve that Draft. |
| 2026-09-10 | Draft Release discovery regression check | Publication now enumerates the authenticated paginated Release inventory, which includes Drafts for write-capable callers, matches the exact tag, rejects API failures/duplicates/malformed pages, and waits briefly for post-create visibility. |
| 2026-09-10 | post-repair `npm run verify:local` | Passed: typecheck, lint, 11 files / 141 tests, two-profile config, native check with zero mismatches, and TC-D02 / TC-D05–TC-D08 static CI policy. |
| 2026-09-10 | successful `iOS unsigned IPA` workflow run 6 for `dev-runtime-v1.0.4` | User reported every workflow step succeeded. Published metadata records source `124d7d5d8593728d04f9b06fdbb098981a9fed60`, Xcode 26.6 build 17F113, Debug/iphoneos26.5, arm64 app code, minimum OS 18.0, device families 1/2, bundle `com.aioi.flink`, and disabled code signing. |
| 2026-09-10 | downloaded Release input verification | `native-build-info.json` and `Podfile.lock` hashes match `SHA256SUMS.txt`; the lock includes local `FlinkNative` and CocoaPods 1.17.0. The IPA is not present in the local handoff directory, so its recorded `8ad49b3f…b5f8` digest remains CI/manifest evidence until the user's downloaded IPA is checked. |
| 2026-09-10 | development runtime resolution | Release lock and metadata were preserved at their canonical paths. `native-signature --profile development` reproduced `a04edf0d…b4aa` with no unresolved inputs, and `native-check --profile development --require-resolved` returned `compatible`. |
| 2026-09-10 | post-integration `npm run verify:local` | Passed: typecheck, lint, 11 files / 148 tests, two-profile config, inferred development native compatibility, and TC-D02 / TC-D05–TC-D08 workflow policy. |
| 2026-09-10 | first physical-device smoke with runtime 1.0.4 | User confirmed picker import, direct Files placement, delete, and explicit thumbnail generation. Rename failed with `E_PATH_OUTSIDE_LIBRARY`; reader open failed with Expo `ERR_VIEW_NOT_FOUND`, so navigation and fit were not reachable. Device model/OS was not supplied, so these are retained as partial observations rather than an iPhone/iPad verification status. |
| 2026-09-10 | runtime 1.0.5 rename/viewer repair | Added physical-root proof, balanced move notifications, and coordinated destination validation for rename, plus a native mount-ready barrier for initial PDF open. Focused regressions, typecheck, lint, and aggregate local verification passed; 11 files / 151 tests. At this pre-build checkpoint, `native:check --profile development` was intentionally unresolved with zero mismatches and no provisional signature was treated as Release evidence. |
| 2026-09-10 | successful `iOS unsigned IPA` workflow run 7 for `dev-runtime-v1.0.5` | Published metadata records source `c23ff74adfc37c439a98652106e461dca222a4eb`, development signature `1983454e…a544f`, Xcode 26.6 build 17F113, Debug/iphoneos26.5, arm64 app code, minimum OS 18.0, device families 1/2, bundle `com.aioi.flink`, and disabled code signing. |
| 2026-09-10 | downloaded 1.0.5 Release input verification | `native-build-info.json` SHA-256 `a8f1f075…5a1b` and `Podfile.lock` SHA-256 `42765a46…ad49` match `SHA256SUMS.txt`; the lock is byte-identical to the canonical lock. The manifest and metadata agree on IPA digest `5d4a79f3…cf62d6`, but the IPA itself is not in the local handoff directory, so its bytes were not independently rehashed here. |
| 2026-09-10 | runtime 1.0.5 development resolution | Release metadata was copied byte-for-byte to `config/installed-native-build-info.json`; the development signature was recorded in `config/native-runtime.json`. Both explicit and metadata-inferred `native-check --require-resolved` returned `compatible`. |
| 2026-09-10 | runtime 1.0.5 post-integration `npm run verify:local` | Passed: typecheck, lint, 11 files / 151 tests, two-profile Expo configuration, inferred development native compatibility, and TC-D02 / TC-D05–TC-D08 workflow policy. |
| 2026-09-10 | second physical-device smoke with runtime 1.0.5 | User confirmed PDF content display, previous/next navigation, and page-number jumps. Rename still returned `E_PATH_OUTSIDE_LIBRARY`. Pressing the already-fitted page control showed no visible change; zoom-then-fit was not yet tested. Device model and OS were not supplied, so these remain partial observations rather than an iPhone/iPad status. |
| 2026-09-10 | runtime 1.0.6 rename equality repair | Replaced archive-hash comparison of opaque `fileResourceIdentifier` values with Foundation's documented `isEqual(_:)` equality. Added a source regression that forbids hashing inside the physical-identity helper, retained fail-closed path and symlink checks, and clarified current-page fit labeling. Replacement CI build and device rename regression are pending. |
| 2026-09-10 | runtime 1.0.6 pre-build `npm run verify:local` | Passed: typecheck, lint, 11 files / 151 tests, two-profile Expo configuration, unresolved native check with zero mismatches, and TC-D02 / TC-D05–TC-D08 workflow policy. |
| 2026-09-10 | physical-device rename with runtime 1.0.6 | User reported `E_PATH_OUTSIDE_LIBRARY` persisted. The result disproves the identifier-equality repair as a complete fix and keeps both device gates unverified. |
| 2026-09-10 | runtime 1.0.7 coordinator repair | Replaced normal resource values inside `.forMoving` / `.forDeleting` accessors with Foundation-required promised-item values. Source, existing parent, and library root are coordinated as concurrent intents; a dev/inode root snapshot plus component-level promised-value checks prove containment without relying on accessor spelling, while the actual rename/delete uses the current intent URLs. File/parent identity remains identifier-or-inode fail-closed, and the source contract was updated. CI build and device regression are pending. |
| 2026-09-10 | runtime 1.0.7 post-repair `npm run verify:local` | Passed: typecheck, lint, 11 files / 151 tests, two-profile Expo configuration, unresolved runtime check with zero mismatches, and workflow policy validation. Native compile, IPA build, and physical-device regression remain pending. |
| 2026-09-10 | runtime 1.0.8 safe path diagnostics | Added a fixed `path.v1.*` diagnostic ID to every rename/delete `E_PATH_OUTSIDE_LIBRARY` branch. JavaScript accepts only an exact code/operation/allowlist match from the direct native envelope or the current Expo function-wrapper cause, and the smoke screen renders a Japanese explanation plus the ID. Raw bridge messages, paths, filenames, resource identifiers, and PDF data remain hidden. |
| 2026-09-10 | runtime 1.0.8 `npm run verify:local` and development native check | Passed: typecheck, lint, 11 files / 155 tests, two-profile Expo configuration, and workflow policy validation. Both default and explicit development native checks correctly returned unresolved with zero mismatches because no 1.0.8 IPA or installed metadata exists. Native compile, IPA build, and physical-device regression remain pending. |
| 2026-09-10 | runtime 1.0.9 rooted mutation-preflight repair | The 1.0.8 diagnostic `path.v1.relative-path-outside-root` isolated a false rejection before coordination. Resolve, rename, and delete now rebuild source/parent/destination URLs from validated relative components below the current library root; symbolic-link, fingerprint, coordinator, and physical-identity checks remain fail-closed. |
| 2026-09-10 | runtime 1.0.9 `npm run verify:local` and development native check | Passed: typecheck, lint, 11 files / 156 tests, two-profile Expo configuration, and workflow policy validation. Both default and explicit development native checks correctly returned unresolved with zero mismatches because no 1.0.9 IPA or installed metadata exists. Native compile, IPA build, and physical-device regression remain pending. |
| 2026-09-10 | physical-device rename with runtime 1.0.9 | User confirmed file rename succeeds after installing the rooted mutation-preflight repair. Device model and OS were not supplied, so this is a feature observation rather than a complete device gate. |
| 2026-09-10 | runtime 1.0.10 manual page-fit removal | Removed the smoke-screen `ページ全体` button, its help text, the TypeScript ref method/mock, the Expo view `fitCurrentPage` AsyncFunction, and the Swift method. Automatic fit on open/navigation/layout/resume remains private. The native API was intentionally raised from 1 to 2. |
| 2026-09-10 | runtime 1.0.10 `npm run verify:local` and development native check | Passed: typecheck, lint, 11 files / 156 tests, two-profile Expo configuration, and workflow policy validation. Both default and explicit development native checks correctly returned unresolved with zero mismatches because no 1.0.10 / API 2 IPA or installed metadata exists. Native compile, IPA build, and device regression remain pending. |
| 2026-09-10 | `expo-modules-autolinking resolve --platform apple --json` | Passed; `flink-native` resolves `FlinkNativeModule` and the `FlinkNative` pod |
| 2026-09-10 | one-shot `expo export --platform ios` | Passed; the Phase 2 smoke route bundled 1,506 modules without starting a persistent development server |
| 2026-09-10 | `npm ci` | Passed from `package-lock.json`; 872 packages audited |
| 2026-09-10 | `npx expo install --check` | Passed; Expo reports dependencies are up to date |
| 2026-09-10 | `npx expo-doctor` 1.20.4 | Passed all 21 checks |
| 2026-09-10 | small fixture generator + `pdfinfo` | Generator refused overwrites as designed; the normal and mixed-size synthetic fixtures each parsed as PDF 1.7 with 3 pages |

The 8-file / 114-test aggregate above is the retained Phase 1 baseline. The current aggregate is 11 files / 156 tests after Release input integration, fail-closed profile inference, promised coordinator-resource validation, identifier-or-inode identity proof, native-view readiness coverage, safe path diagnostics, rooted mutation preflight, and removal of the manual page-fit API/UI. Workflow runs 6 and 7 remain historical macOS build/package/publication evidence; runtime 1.0.10 still requires CI and both target devices.

`npm audit --omit=dev` reports 14 moderate advisories in the Expo SDK dependency graph and no high or critical advisories. The offered all-fixes path downgrades core Expo packages across incompatible major versions, so it was not applied. Reassess when an SDK 57-compatible upstream fix is available.

## Required development/distribution test status

| Test | Status | Notes |
|---|---|---|
| TC-D02 | CI_VERIFIED | Run 7 completed the repaired unsigned device build, implementation-dylib/framework inspection, IPA structure, minimum OS/device-family, checksum, metadata, and Release publication checks. |
| TC-D05 | LOCAL_VERIFIED | Static workflow validator confirms ordinary push/PR runs Linux checks only; `dev-runtime-v*` push is not a native trigger. Trigger-isolation behavior has not been separately recorded as a CI observation. |
| TC-D06 | LOCAL_VERIFIED | Static validator rejects artifact upload, EAS commands, signing secrets/files, signing enablement, and provisioning updates. Run 6 used the intended workflow, but this remains a source-policy assertion rather than a device result. |
| TC-D07 | CI_VERIFIED | Run 7 verified the existing development tag at both checkouts, transferred the exact source SHA, and revalidated the remote tag before publication. Invalid inputs remain contract-tested locally. |
| TC-D08 | CI_PARTIAL | Runs 6 and 7 verified the new Draft → upload → remote checksum → publish path for distinct tags. Existing-Release mutable replacement and immutable byte-identical no-op/difference rejection remain contract-tested only until one deliberate same-tag rerun is observed. |
| TC-D01, TC-D03–TC-D04, TC-D09 | NOT_STARTED | Require the development/production builds, Release assets, and/or physical devices. |

The partial, device-unspecified observations above do not promote an iPhone or iPad status. Reader, blink, UI, performance, security, and unreported file cases from TC-F01 through TC-P06 remain NOT_STARTED unless a separate row records the target model, OS, runtime, and actual result. Pure unit coverage must not be promoted to a device status.

## CI workflow boundary

`checks.yml` keeps ordinary push, pull-request, and manual checks on Ubuntu 24.04 with exact Node 24.18.0 / npm 11.16.0. `build-ios-ipa.yml` implements the Phase 2 path: trusted input validation, exact existing-tag checkout, Linux preflight, an arm64 `macos-26` / Xcode 26.6 job, CNG and locked Pods, resolved native metadata, unsigned device `.app` inspection, IPA packaging, and verified GitHub Release publication. Only the Release job receives `contents: write`; no Apple credential, EAS, or Actions Artifact path exists. Run 7 completed this path for runtime `dev-runtime-v1.0.5`; runtime 1.0.10 is pending. Same-tag rerun behavior remains a separate TC-D08 check.

## Fixtures

Small PDF fixtures are reproducible but ignored by version control. FIX-05 through FIX-09 remain preparation tasks. No user PDF, captured camera image, face mesh, or measured blend-shape time series was added. See `tests/fixtures/README.md`.

## User decisions and later actions

1. Keep the confirmed `com.aioi.flink` identifier stable from the first development IPA onward. Changing it later may create a different Documents container.
2. Commit and push the 1.0.10 manual-page-fit removal, create the exact source tag `dev-runtime-v1.0.10`, then manually run `build-ios-ipa.yml` with profile `development`. A development-tag push alone does not start a native build. Do not reuse or move an existing development tag.
3. Verify and record the 1.0.10 / API 2 Release metadata, checksum manifest, and Pod lock before requiring a resolved native check. Never move an existing tag to new source.
4. Re-sign/install the 1.0.10 IPA and confirm that the manual `ページ全体` control is absent while opening, navigating, and rotating PDFs retain automatic fitting. Include device model / OS if available.
5. Keep the 1.0.4 and 1.0.5 Release assets as historical evidence. Do not create a production `v*` tag until the repaired development device gate succeeds. Keep Apple certificates, provisioning profiles, account passwords, and App Store Connect keys out of this workflow.
