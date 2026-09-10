---
document_id: FLINK-IMPLEMENTATION-STATUS
version: 1.0.0-phase2-source
updated_at: 2026-09-10
scope: Phase 1 and Phase 2
status: phase_2_source_implemented_ci_and_device_unverified
---

# Flink implementation status

This ledger separates implemented source, local verification, CI verification, and device verification. Phase 2 source is implemented, but no macOS native build, successful GitHub Actions run, IPA, SideStore installation, or physical-device result exists yet. Consequently, the Phase 2 exit gate is not claimed.

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
| CNG | enabled; generated native directories are not committed | LOCAL_VERIFIED configuration, native generation NOT_STARTED |
| Deployment target | iOS / iPadOS 18.0 | LOCAL_VERIFIED configuration, CI binary inspection NOT_STARTED |
| Bundle identifier | `com.aioi.flink` | User-selected value; LOCAL_VERIFIED configuration |
| Device families | iPhone + iPad (1 and 2) | LOCAL_VERIFIED configuration; CI binary inspection NOT_STARTED |

Expo SDK 57's versioned reference records React Native 0.86, React 19.2.3, minimum Node 22.13.x, minimum iOS 16.4, and minimum Xcode 26.4. The selected Node 24.18.0, deployment target 18.0, and Xcode 26.6 satisfy those documented minima. This is a compatibility check, not a native build or device result.

Official references checked on 2026-09-10:

- <https://docs.expo.dev/versions/v57.0.0/>
- <https://docs.expo.dev/versions/v57.0.0/config/app/>
- <https://docs.expo.dev/versions/v57.0.0/sdk/dev-client/>
- <https://github.com/actions/runner-images/blob/main/images/macos/macos-26-arm64-Readme.md>

## Selected native toolchain

| Item | Pinned value | Verification boundary |
|---|---|---|
| Runner | `macos-26`, arm64 | Runner inventory reviewed; actual job NOT_STARTED |
| Xcode | 26.6, `Xcode_26.6.app` | Runner inventory reviewed; invocation NOT_STARTED |
| Node / npm | 24.18.0 / 11.16.0 | LOCAL_VERIFIED |
| Ruby | 3.4.10 | Runner inventory reviewed; CI invocation NOT_STARTED |
| CocoaPods | 1.17.0 exact | Runner inventory reviewed; install and resolution NOT_STARTED |
| SDK / destination | `iphoneos` / `generic/platform=iOS` | Design fixed; native build NOT_STARTED |
| Code signing | disabled by design | Workflow source IMPLEMENTED_UNVERIFIED; CI invocation NOT_STARTED |

The machine-specific Xcode application directory is recorded for the future workflow but excluded from the runtime signature projection. The signature manifest contains logical relative input IDs only.

## Phase 1 task ledger

| Task | Status | Evidence / remaining work |
|---|---|---|
| P1-01 Existing project inspection | LOCAL_VERIFIED | `package.json`, lockfile, `app.json`, Router entry, TypeScript config, scripts, ignored native folders, and absent prior workflows were confirmed from project files. See the process exception above for the initial read-only Git inspection. |
| P1-02 Version ledger | LOCAL_VERIFIED | Actual dependency versions and SDK 57 documented minima are recorded above. |
| P1-03 Native toolchain | LOCAL_VERIFIED | `config/native-toolchain.json` records exact versions and unresolved CocoaPods boundary. |
| P1-04 App configuration | LOCAL_VERIFIED | `plugins/with-flink-ios.js` enforces identity, tablet/orientations, sharing, camera text, deployment target, profile-scoped LAN, and no arbitrary loads. Both profiles passed public + introspected config checks. |
| P1-05 Dev client and local module scaffold | LOCAL_VERIFIED | SDK-compatible dev client and local-module/autolinking scaffold exist and appear in Expo introspection. Native compile remains Phase 2. |
| P1-06 Typed native API v1 contract | LOCAL_VERIFIED | TypeScript contract, validation, mocks, and explicit unavailable-native behavior passed the aggregate local checks. |
| P1-07 Pure domain tests | LOCAL_VERIFIED | Blink, library, reader, validation, and stale-response unit coverage passed the aggregate local checks. |
| P1-08 Static CI foundation | LOCAL_VERIFIED | Linux checks and fail-closed iOS preflight draft added. Static contract tests passed locally. |
| P1-09 Native signature | LOCAL_VERIFIED | Profile-specific deterministic signatures cover the typed bridge contract, native sources/config, effective iOS assets, actual iOS autolink snapshot, generation tools, and normalized Pod lock. API/runtime/profile drift is rejected. Resolution correctly remains `unresolved`; no generated metadata, Git state, or absolute manifest path is hashed. |
| P1-10 Fixture plan and ledger | LOCAL_VERIFIED | Small non-overwriting generator, artificial blink JSON, and preparation notes added. Large/encrypted/realistic inputs remain ungenerated. |

## Phase 2 task ledger

These rows describe source completion only. Swift compilation, framework linking, the unsigned device build, and all runtime behavior remain subject to the first macOS CI run and the two physical-device gates.

| Task | Status | Evidence / remaining work |
|---|---|---|
| P2-01 Storage | IMPLEMENTED_UNVERIFIED | `Documents/library`, private Application Support staging, bounded cache roots, owned-partial cleanup, blocked-path handling, and component/symlink root checks are implemented. Files-app visibility and deletion/recreation require a device. |
| P2-02 Files service | IMPLEMENTED_UNVERIFIED | Recursive metadata-only PDF scan, process-local opaque IDs, revisions, stable scan coalescing, partial warnings, and typed errors are implemented without opening PDFs during scan. External-provider behavior requires devices. |
| P2-03 Import coordinator | IMPLEMENTED_UNVERIFIED | Multi-select native picker, security scope, coordinated reads, 1 MiB streaming copy, capacity checks, cancellation, owned partial cleanup, atomic no-replace commit, collision suffixes, and partial success are implemented. Provider, 3 GiB, ENOSPC, and race cases require CI/device execution. |
| P2-04 Mutations and presenters | IMPLEMENTED_UNVERIFIED | Revision-checked coordinated rename/delete, basename validation, case-only handling, library and active-document presenters, debounced invalidation, and writer relinquish are implemented. Deadlock/race behavior requires native execution. |
| P2-05 PDF view | IMPLEMENTED_UNVERIFIED | URL-backed serialized PDFKit loading, lock/invalid/empty checks, single-page rendering, open supersession, reader sessions, deduplicated navigation, boundaries, page events, fit, lifecycle suspension, and safe teardown are implemented. PDFKit behavior requires CI/device execution. |
| P2-06 Thumbnails | IMPLEMENTED_UNVERIFIED | Serial bounded queue, request cancellation/coalescing, page-0 PDFKit rendering, 512 px output, revision cache key, 32 MiB decoded/128 MiB disk limits, reader priority, memory warning, and thermal pause are implemented. Cache and pressure behavior requires devices. |
| P2-07 Face coordinator | IMPLEMENTED_UNVERIFIED | Runtime capability/authorization checks, one explicit shared ARSession, left/right/jaw coefficients, face identity, 128-sample pull buffer, monotonic timestamps, overflow discard, heartbeat watchdog, lifecycle/interruption, and thermal stops are implemented. ARKit values require both devices. |
| P2-08 Face debug | IMPLEMENTED_UNVERIFIED | Release-capable opaque white presentation, dark face mesh with white openings, shared session, no camera-frame export, covered ARSCNView, and rendering-off behavior are implemented. The no-camera-frame guarantee must still be visually inspected on both devices. |
| P2-09 Context and runtime metadata | IMPLEMENTED_UNVERIFIED | Process-local ContextBroker rejects stale/suspended reader, generation, epoch, and sample-time combinations. API/runtime/profile/signature/source commit are read from embedded metadata. CI must resolve the signature and source commit. |
| P2-10 Native smoke screen | IMPLEMENTED_UNVERIFIED | Minimal iOS screen exercises init/scan/import/cancel/rename/delete/thumbnail, PDF open/navigation/fit, capabilities/permission/start/stop/reset/drain, numeric coefficients, debug face, and runtime metadata. TypeScript/lint checks pass; native interaction requires the development IPA. |
| P2-11 CI and first IPA | IMPLEMENTED_UNVERIFIED | Manual/tag validation, Linux preflight, pinned macOS toolchain, CNG/Pods, native signature, unsigned `.app`, IPA packaging/inspection, checksums/build metadata, and GitHub Release publication are implemented with fail-closed policy checks. No workflow run or Release exists yet. |

## Native runtime state

| Field | Value |
|---|---|
| Native API | 1 |
| Native runtime version | 1.0.0 |
| Algorithm | SHA-256, signature input schema 1 |
| Recorded installed signature | unresolved (`null`) |
| CocoaPods lock | unresolved; first Phase 2 macOS build must supply it |
| Installed build metadata | not provided |

`native:check` returning `unresolved` after the Phase 2 source implementation is expected and is not a native success result. `--require-resolved` must fail until a real Phase 2 macOS build supplies the resolved Pod lock, its signatures are recorded, and matching installed-build metadata is present.

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
| 2026-09-10 | final Phase 2 `npm run verify:local` | Passed: typecheck, lint, 11 files / 136 tests, two-profile config, native check with zero mismatches, and TC-D02 / TC-D05–TC-D08 static CI policy |
| 2026-09-10 | `expo-modules-autolinking resolve --platform apple --json` | Passed; `flink-native` resolves `FlinkNativeModule` and the `FlinkNative` pod |
| 2026-09-10 | one-shot `expo export --platform ios` | Passed; the Phase 2 smoke route bundled 1,506 modules without starting a persistent development server |
| 2026-09-10 | `npm ci` | Passed from `package-lock.json`; 872 packages audited |
| 2026-09-10 | `npx expo install --check` | Passed; Expo reports dependencies are up to date |
| 2026-09-10 | `npx expo-doctor` 1.20.4 | Passed all 21 checks |
| 2026-09-10 | small fixture generator + `pdfinfo` | Generator refused overwrites as designed; the normal and mixed-size synthetic fixtures each parsed as PDF 1.7 with 3 pages |

The 8-file / 114-test aggregate above is the retained Phase 1 baseline. The 11-file / 136-test aggregate is the final Phase 2 source verification on Windows; it is not a Swift compile or device result.

`npm audit --omit=dev` reports 14 moderate advisories in the Expo SDK dependency graph and no high or critical advisories. The offered all-fixes path downgrades core Expo packages across incompatible major versions, so it was not applied. Reassess when an SDK 57-compatible upstream fix is available.

## Required development/distribution test status

| Test | Status | Notes |
|---|---|---|
| TC-D02 | NOT_STARTED | Local validators implement the required device-SDK, signing-off, `.app`, IPA, device-family, and minimum-OS assertions. The macOS build that constitutes this CI test has not run. |
| TC-D05 | LOCAL_VERIFIED | Static workflow validator confirms ordinary push/PR runs Linux checks only; `dev-runtime-v*` push is not a native trigger. CI run NOT_STARTED. |
| TC-D06 | LOCAL_VERIFIED | Static validator rejects artifact upload, EAS commands, signing secrets/files, signing enablement, and provisioning updates. CI run NOT_STARTED. |
| TC-D07 | LOCAL_VERIFIED | Tag/profile/reason validation and explicit `refs/tags/...` checkout policy are covered. Real remote tag existence and CI checkout remain NOT_STARTED. |
| TC-D08 | NOT_STARTED | Local contracts verify the intended mutable/immutable rerun policy, provenance, and checksums. A real Release upload/rerun has not occurred. |
| TC-D01, TC-D03–TC-D04, TC-D09 | NOT_STARTED | Require the development/production builds, Release assets, and/or physical devices. |

All file, reader, blink-device, UI-device, performance, and security-device tests from TC-F01 through TC-P06 remain NOT_STARTED unless a separate row is added with actual evidence. Pure unit coverage must not be promoted to a device status.

## CI workflow boundary

`checks.yml` keeps ordinary push, pull-request, and manual checks on Ubuntu 24.04 with exact Node 24.18.0 / npm 11.16.0. `build-ios-ipa.yml` now implements the Phase 2 path: trusted input validation, exact existing-tag checkout, Linux preflight, an arm64 `macos-26` / Xcode 26.6 job, CNG and locked Pods, resolved native metadata, unsigned device `.app` inspection, IPA packaging, and verified GitHub Release publication. Only the Release job receives `contents: write`; no Apple credential, EAS, or Actions Artifact path exists. This is implemented source, not evidence of a successful workflow run.

## Fixtures

Small PDF fixtures are reproducible but ignored by version control. FIX-05 through FIX-09 remain preparation tasks. No user PDF, captured camera image, face mesh, or measured blend-shape time series was added. See `tests/fixtures/README.md`.

## User decisions and later actions

1. Keep the confirmed `com.aioi.flink` identifier stable from the first development IPA onward. Changing it later may create a different Documents container.
2. Review, commit, and push the Phase 2 source using the user's own Git workflow.
3. Make an existing Phase 2 commit the target of a development tag such as `dev-runtime-v1.0.0`, push that tag, and manually run **iOS unsigned IPA** with that tag, `profile=development`, and a short Phase 2 smoke-test reason. A development tag push alone intentionally does not start the native job.
4. Do not create a production `v*` tag yet. Reserve it until the development CI and device gate succeeds. Keep Apple certificates, provisioning profiles, account passwords, and App Store Connect keys out of this workflow.
5. On success, download the IPA, `SHA256SUMS.txt`, `native-build-info.json`, and `Podfile.lock` from the tag's GitHub Release. Preserve the lock as `native-locks/ios/Podfile.lock` and the build metadata as `config/installed-native-build-info.json`; the recorded signatures still need to be updated from verified output before `native:check --require-resolved` can pass.
6. Re-sign/install the development IPA and execute the Phase 2 smoke gate on both target devices. Provide the workflow log and device observations—or the complete failed-job log—before this ledger is promoted to CI/device verified.
