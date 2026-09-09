---
document_id: FLINK-IMPLEMENTATION-STATUS
version: 1.0.0-phase1
updated_at: 2026-09-10
scope: Phase 1
status: phase_1_local_verified_native_unresolved
---

# Flink implementation status

This ledger separates implemented source, local verification, CI verification, and device verification. No macOS native build, GitHub Actions run, IPA, SideStore installation, or physical-device result exists yet.

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
| Code signing | disabled by design | Phase 2 workflow implementation and CI verification NOT_STARTED |

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

## Native runtime state

| Field | Value |
|---|---|
| Native API | 1 |
| Native runtime version | 1.0.0 |
| Algorithm | SHA-256, signature input schema 1 |
| Recorded installed signature | unresolved (`null`) |
| CocoaPods lock | unresolved; first Phase 2 macOS build must supply it |
| Installed build metadata | not provided |

`native:check` returning `unresolved` in Phase 1 is expected and is not a native success result. `--require-resolved` must fail until real Phase 2 build metadata and the resolved Pod lock are present.

## Local evidence recorded so far

| Date | Command / check | Result |
|---|---|---|
| 2026-09-10 | `node scripts/native-signature.mjs --json --manifest` | Passed; deterministic logical manifest generated, Pod lock reported unresolved |
| 2026-09-10 | `node scripts/native-check.mjs --json` | Passed as `unresolved`; no mismatch fabricated |
| 2026-09-10 | `node scripts/native-check.mjs --require-resolved` | Failed as required while the Pod lock and installed runtime metadata are absent |
| 2026-09-10 | `node scripts/ci/validate-workflows.mjs` | Passed for TC-D05 / TC-D06 / TC-D07 static policy |
| 2026-09-10 | build-input validator with `v1.0.0` / production / exact tag ref | Passed |
| 2026-09-10 | `vitest run tests/contracts` | 5 files, 36 tests passed |
| 2026-09-10 | `npm run verify:config` | Passed for production and development public/introspected configs |
| 2026-09-10 | `npm run verify:local` | Passed after the final clean install: typecheck, lint, 8 files / 114 tests, two-profile config, native check, and CI policy |
| 2026-09-10 | `npm ci` | Passed from `package-lock.json`; 872 packages audited |
| 2026-09-10 | `npx expo install --check` | Passed; Expo reports dependencies are up to date |
| 2026-09-10 | `npx expo-doctor` 1.20.4 | Passed all 21 checks |
| 2026-09-10 | small fixture generator + `pdfinfo` | Generator refused overwrites as designed; the normal and mixed-size synthetic fixtures each parsed as PDF 1.7 with 3 pages |

The final aggregate was run after a fresh `npm ci` and all Phase 1 source/review fixes.

`npm audit --omit=dev` reports 14 moderate advisories in the Expo SDK dependency graph and no high or critical advisories. The offered all-fixes path downgrades core Expo packages across incompatible major versions, so it was not applied. Reassess when an SDK 57-compatible upstream fix is available.

## Required development/distribution test status

| Test | Status | Notes |
|---|---|---|
| TC-D05 | LOCAL_VERIFIED | Static workflow validator confirms ordinary push/PR runs Linux checks only; `dev-runtime-v*` push is not a native trigger. CI run NOT_STARTED. |
| TC-D06 | LOCAL_VERIFIED | Static validator rejects artifact upload, EAS commands, signing secrets/files, signing enablement, and provisioning updates. CI run NOT_STARTED. |
| TC-D07 | LOCAL_VERIFIED | Tag/profile/reason validation and explicit `refs/tags/...` checkout policy are covered. Real remote tag existence and CI checkout remain NOT_STARTED. |
| TC-D01–TC-D04, TC-D08–TC-D09 | NOT_STARTED | Require Phase 2 build, CI, and/or devices. |

All file, reader, blink-device, UI-device, performance, and security-device tests from TC-F01 through TC-P06 remain NOT_STARTED unless a separate row is added with actual evidence. Pure unit coverage must not be promoted to a device status.

## CI workflow boundary

`checks.yml` uses only Ubuntu 24.04, exact Node 24.18.0 / npm 11.16.0, and the verified `actions/checkout@v6.0.3` / `actions/setup-node@v7.0.0` tags. `build-ios-ipa.yml` implements Phase 1 input and tag preflight only. It intentionally terminates with a failure marker after local-equivalent checks, so it cannot appear as a successful IPA build. It has no macOS job, release upload, write permission, Apple credential path, EAS command, or Actions artifact upload. Phase 2 must replace this gate only after the native implementation and packaging verification exist.

## Fixtures

Small PDF fixtures are reproducible but ignored by version control. FIX-05 through FIX-09 remain preparation tasks. No user PDF, captured camera image, face mesh, or measured blend-shape time series was added. See `tests/fixtures/README.md`.

## User decisions and later actions

1. Keep the confirmed `com.aioi.flink` identifier stable from the first development IPA onward. Changing it later may create a different Documents container.
2. Do not treat the current iOS workflow as an IPA builder; it is a deliberate fail-closed Phase 1 preflight draft.
3. In Phase 2, create/push the requested existing tag and run GitHub Actions only after the complete Swift module and unsigned device packaging path have been implemented.
4. Keep Apple certificates, provisioning profiles, account passwords, and App Store Connect keys out of this workflow.
5. After Phase 2 produces real assets, provide the CI log, `native-build-info.json`, and `Podfile.lock` so this ledger and native signature can move beyond `unresolved`.
