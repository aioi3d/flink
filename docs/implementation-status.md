---
document_id: FLINK-IMPLEMENTATION-STATUS
version: 1.0.4-phase2-ci
updated_at: 2026-09-10
scope: Phase 1 and Phase 2
status: phase_2_development_ipa_ci_verified_device_unverified
---

# Flink implementation status

This ledger separates implemented source, local verification, CI verification, and device verification. The `dev-runtime-v1.0.4` workflow completed the Phase 2 development path end to end: it compiled, inspected, packaged, checksum-verified, and published the unsigned IPA and native build inputs. The downloaded Pod lock and build metadata have been verified and recorded locally. No SideStore installation or physical-device result exists yet, so the Phase 2 exit gate is not claimed.

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
| CNG | enabled; generated native directories are not committed | CI_VERIFIED generation in run 6 |
| Deployment target | iOS / iPadOS 18.0 | CI_VERIFIED from packaged app metadata in run 6 |
| Bundle identifier | `com.aioi.flink` | User-selected value; LOCAL_VERIFIED configuration |
| Device families | iPhone + iPad (1 and 2) | CI_VERIFIED from packaged app metadata in run 6; devices pending |

Expo SDK 57's versioned reference records React Native 0.86, React 19.2.3, minimum Node 22.13.x, minimum iOS 16.4, and minimum Xcode 26.4. The selected Node 24.18.0, deployment target 18.0, and Xcode 26.6 satisfy those documented minima. This is a compatibility check, not a native build or device result.

Official references checked on 2026-09-10:

- <https://docs.expo.dev/versions/v57.0.0/>
- <https://docs.expo.dev/versions/v57.0.0/config/app/>
- <https://docs.expo.dev/versions/v57.0.0/sdk/dev-client/>
- <https://github.com/actions/runner-images/blob/main/images/macos/macos-26-arm64-Readme.md>
- <https://docs.github.com/en/rest/releases/releases?apiVersion=2022-11-28>
- <https://cli.github.com/manual/gh_release_create>

## Selected native toolchain

| Item | Pinned value | Verification boundary |
|---|---|---|
| Runner | `macos-26`, arm64 | CI_VERIFIED in workflow run 6 |
| Xcode | 26.6, `Xcode_26.6.app` | CI_VERIFIED as Xcode 26.6 build 17F113 |
| Node / npm | 24.18.0 / 11.16.0 | LOCAL_VERIFIED |
| Ruby | 3.4.10 | CI_VERIFIED in workflow run 6 |
| CocoaPods | 1.17.0 exact | CI_VERIFIED; resolved lock is recorded locally |
| SDK / destination | `iphoneos` / `generic/platform=iOS` | CI_VERIFIED; packaged metadata reports `iphoneos26.5` and the generic device destination |
| Code signing | disabled by design | CI_VERIFIED; unsigned `.app` and IPA checks passed |

The machine-specific Xcode application directory is recorded for the future workflow but excluded from the runtime signature projection. The signature manifest contains logical relative input IDs only.

## Phase 1 task ledger

| Task | Status | Evidence / remaining work |
|---|---|---|
| P1-01 Existing project inspection | LOCAL_VERIFIED | `package.json`, lockfile, `app.json`, Router entry, TypeScript config, scripts, ignored native folders, and absent prior workflows were confirmed from project files. See the process exception above for the initial read-only Git inspection. |
| P1-02 Version ledger | LOCAL_VERIFIED | Actual dependency versions and SDK 57 documented minima are recorded above. |
| P1-03 Native toolchain | CI_VERIFIED | `config/native-toolchain.json` records exact versions; run 6 verified the pinned macOS/Xcode/Ruby/CocoaPods toolchain and supplied the resolved Pod lock. |
| P1-04 App configuration | LOCAL_VERIFIED | `plugins/with-flink-ios.js` enforces identity, tablet/orientations, sharing, camera text, deployment target, profile-scoped LAN, and no arbitrary loads. Both profiles passed public + introspected config checks. |
| P1-05 Dev client and local module scaffold | LOCAL_VERIFIED | SDK-compatible dev client and local-module/autolinking scaffold exist and appear in Expo introspection. Native compile remains Phase 2. |
| P1-06 Typed native API v1 contract | LOCAL_VERIFIED | TypeScript contract, validation, mocks, and explicit unavailable-native behavior passed the aggregate local checks. |
| P1-07 Pure domain tests | LOCAL_VERIFIED | Blink, library, reader, validation, and stale-response unit coverage passed the aggregate local checks. |
| P1-08 Static CI foundation | LOCAL_VERIFIED | Linux checks and fail-closed iOS preflight draft added. Static contract tests passed locally. |
| P1-09 Native signature | CI_VERIFIED | Profile-specific deterministic signatures cover the typed bridge contract, native sources/config, effective iOS assets, actual iOS autolink snapshot, generation tools, and normalized Pod lock. The development signature is resolved and matches run 6 metadata; no generated metadata, Git state, or absolute manifest path is hashed. Production remains intentionally unrecorded. |
| P1-10 Fixture plan and ledger | LOCAL_VERIFIED | Small non-overwriting generator, artificial blink JSON, and preparation notes added. Large/encrypted/realistic inputs remain ungenerated. |

## Phase 2 task ledger

The native framework and unsigned IPA boundaries are verified by CI. Runtime behavior remains subject to the two physical-device gates.

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
| P2-09 Context and runtime metadata | IMPLEMENTED_UNVERIFIED | Process-local ContextBroker rejects stale/suspended reader, generation, epoch, and sample-time combinations. Run 6 verified the embedded API/runtime/profile/signature/source metadata; broker behavior still requires devices. |
| P2-10 Native smoke screen | IMPLEMENTED_UNVERIFIED | Minimal iOS screen exercises init/scan/import/cancel/rename/delete/thumbnail, PDF open/navigation/fit, capabilities/permission/start/stop/reset/drain, numeric coefficients, debug face, and runtime metadata. TypeScript/lint checks pass; native interaction requires the development IPA. |
| P2-11 CI and first IPA | CI_VERIFIED | Workflow run 6 for `dev-runtime-v1.0.4` / source `124d7d5d8593728d04f9b06fdbb098981a9fed60` completed Linux preflight, pinned macOS build, app/IPA inspection, checksum verification, and GitHub Release publication. The resolved development signature is `a04edf0d25d4a23db15348a3c8494b0bde37593b0d6eaa3a0bb762042bb4b4aa`. Same-tag rerun behavior remains tracked separately by TC-D08. |

## Native runtime state

| Field | Value |
|---|---|
| Native API | 1 |
| Native runtime version | 1.0.4 |
| Algorithm | SHA-256, signature input schema 1 |
| Recorded installed signature | development: `a04edf0d25d4a23db15348a3c8494b0bde37593b0d6eaa3a0bb762042bb4b4aa`; production: unrecorded |
| CocoaPods lock | resolved at `native-locks/ios/Podfile.lock`; SHA-256 `42765a460401c3c0803aeb5e32e1f296a270c75f23a209f49c97f57c8e99ad49` |
| Installed build metadata | `config/installed-native-build-info.json`; run 6 / attempt 1 / development |

`native:check` infers the installed development profile when no explicit CLI or environment profile is supplied. It returns `compatible`, and `--require-resolved` passes, for the recorded development runtime. Production remains unrecorded and must be checked explicitly when a production runtime is built.

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
| 2026-09-10 | `expo-modules-autolinking resolve --platform apple --json` | Passed; `flink-native` resolves `FlinkNativeModule` and the `FlinkNative` pod |
| 2026-09-10 | one-shot `expo export --platform ios` | Passed; the Phase 2 smoke route bundled 1,506 modules without starting a persistent development server |
| 2026-09-10 | `npm ci` | Passed from `package-lock.json`; 872 packages audited |
| 2026-09-10 | `npx expo install --check` | Passed; Expo reports dependencies are up to date |
| 2026-09-10 | `npx expo-doctor` 1.20.4 | Passed all 21 checks |
| 2026-09-10 | small fixture generator + `pdfinfo` | Generator refused overwrites as designed; the normal and mixed-size synthetic fixtures each parsed as PDF 1.7 with 3 pages |

The 8-file / 114-test aggregate above is the retained Phase 1 baseline. The current aggregate is 11 files / 148 tests after Release input integration and fail-closed profile-inference coverage. Workflow run 6 supplies the macOS build/package/publication evidence; device behavior remains unverified.

`npm audit --omit=dev` reports 14 moderate advisories in the Expo SDK dependency graph and no high or critical advisories. The offered all-fixes path downgrades core Expo packages across incompatible major versions, so it was not applied. Reassess when an SDK 57-compatible upstream fix is available.

## Required development/distribution test status

| Test | Status | Notes |
|---|---|---|
| TC-D02 | CI_VERIFIED | Run 6 completed the unsigned device build, implementation-dylib/framework inspection, IPA structure, minimum OS/device-family, checksum, metadata, and Release publication checks. |
| TC-D05 | LOCAL_VERIFIED | Static workflow validator confirms ordinary push/PR runs Linux checks only; `dev-runtime-v*` push is not a native trigger. Trigger-isolation behavior has not been separately recorded as a CI observation. |
| TC-D06 | LOCAL_VERIFIED | Static validator rejects artifact upload, EAS commands, signing secrets/files, signing enablement, and provisioning updates. Run 6 used the intended workflow, but this remains a source-policy assertion rather than a device result. |
| TC-D07 | CI_VERIFIED | Run 6 verified the existing development tag at both checkouts, transferred the exact source SHA, and revalidated the remote tag before publication. Invalid inputs remain contract-tested locally. |
| TC-D08 | CI_PARTIAL | Run 6 verified the new Draft → upload → remote checksum → publish path. Existing-Release mutable replacement and immutable byte-identical no-op/difference rejection remain contract-tested only until one deliberate same-tag rerun is observed. |
| TC-D01, TC-D03–TC-D04, TC-D09 | NOT_STARTED | Require the development/production builds, Release assets, and/or physical devices. |

All file, reader, blink-device, UI-device, performance, and security-device tests from TC-F01 through TC-P06 remain NOT_STARTED unless a separate row is added with actual evidence. Pure unit coverage must not be promoted to a device status.

## CI workflow boundary

`checks.yml` keeps ordinary push, pull-request, and manual checks on Ubuntu 24.04 with exact Node 24.18.0 / npm 11.16.0. `build-ios-ipa.yml` implements the Phase 2 path: trusted input validation, exact existing-tag checkout, Linux preflight, an arm64 `macos-26` / Xcode 26.6 job, CNG and locked Pods, resolved native metadata, unsigned device `.app` inspection, IPA packaging, and verified GitHub Release publication. Only the Release job receives `contents: write`; no Apple credential, EAS, or Actions Artifact path exists. Run 6 completed this path for `dev-runtime-v1.0.4`; same-tag rerun behavior remains a separate TC-D08 check.

## Fixtures

Small PDF fixtures are reproducible but ignored by version control. FIX-05 through FIX-09 remain preparation tasks. No user PDF, captured camera image, face mesh, or measured blend-shape time series was added. See `tests/fixtures/README.md`.

## User decisions and later actions

1. Keep the confirmed `com.aioi.flink` identifier stable from the first development IPA onward. Changing it later may create a different Documents container.
2. Verify the user's downloaded `Flink-dev-runtime-1.0.4-unsigned.ipa` against SHA-256 `8ad49b3fc2dddfed5f37b3c1feb232b99aa6b0d1304850fcdfc1b09ffa71b5f8` before installation.
3. Re-sign/install that development IPA and execute the Phase 2 smoke gate separately on both target devices. Provide the device observations and any exact `E_…` error codes before this ledger is promoted to device verified.
4. After preserving the original run 6 assets, deliberately rerun the same tag once if TC-D08's real existing-Release path is to be promoted from CI_PARTIAL. Do not move the tag or replace it with another commit.
5. Do not create a production `v*` tag yet. Reserve it until the development CI and device gate succeeds. Keep Apple certificates, provisioning profiles, account passwords, and App Store Connect keys out of this workflow.
