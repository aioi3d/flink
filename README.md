# Flink

Flink is an Expo SDK 57 iOS/iPadOS PDF reader. Phase 2 provides the native
foundation for Files integration, PDFKit, ARKit face coefficients, the neutral
face debug view, runtime compatibility metadata, and unsigned IPA packaging.

The current route is a **Phase 2 native smoke screen**, not the finished
library/reader UI. The reference UI is implemented in later phases.

## Requirements

- Node.js 24.18.0
- npm 11.16.0
- An iOS development build containing the local `FlinkNative` Expo Module
- iOS/iPadOS 18.0 or newer

Expo Go cannot run the Phase 2 native APIs. Native compilation is performed by
the pinned GitHub Actions macOS job; the Windows checkout does not require
Xcode.

## Local verification

```bash
npm ci
npm run verify:local
```

`native:check` intentionally reports `unresolved` until the first successful
macOS build supplies a real `Podfile.lock` and `native-build-info.json`.

## First development IPA

1. Commit and push the reviewed Phase 2 source.
2. Create and push an existing-commit tag such as `dev-runtime-v1.0.0`.
3. Manually run the **iOS unsigned IPA** workflow with that tag,
   `profile=development`, and a short reason.
4. Download the unsigned IPA, `SHA256SUMS.txt`, `native-build-info.json`, and
   `Podfile.lock` from the tag's GitHub Release. Preserve the latter two as
   `config/installed-native-build-info.json` and
   `native-locks/ios/Podfile.lock` for the follow-up signature update.
5. Re-sign/install the IPA with SideStore or an equivalent tool, then run the
   smoke checklist on both iPhone and iPad and retain the workflow/device log.

Pushing a `dev-runtime-v*` tag alone does not start a native build. Production
`v*` tags do trigger the production path, so do not create one until the
development gate passes. The workflow never requests Apple
certificates, provisioning profiles, or App Store Connect credentials, and it
does not use GitHub Actions artifacts.

See [implementation status](docs/implementation-status.md) and the
[implementation plan](docs/03_implementation_plan.md) for the verification
boundary and device checklist.
