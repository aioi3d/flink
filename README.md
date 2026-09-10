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

The source and recorded installed build now target development runtime
`1.0.5`. Its Release metadata reproduces the local development signature, so
`npm run native:check -- --require-resolved` must report `compatible` and infer
the `development` profile. The production signature remains intentionally
unrecorded; use `--profile production` only when preparing that runtime.

## Development IPA status

`dev-runtime-v1.0.4` was the first successfully built IPA, but physical-device
testing exposed two blockers: coordinated rename rejected an equivalent iOS
sandbox URL as outside the library, and the first PDF open raced Fabric native
view registration. Both repairs were compiled and published in development
runtime `1.0.5`; its downloaded metadata and Pod lock are now recorded locally.
Re-sign/install the `1.0.5` unsigned IPA, then repeat rename and reader
navigation on both iPhone and iPad. Keep the `1.0.4` Release evidence as
historical input rather than treating it as the current installed runtime.

Pushing a `dev-runtime-v*` tag alone does not start a native build. Production
`v*` tags do trigger the production path, so do not create one until the
development gate passes. The workflow never requests Apple
certificates, provisioning profiles, or App Store Connect credentials, and it
does not use GitHub Actions artifacts.

See [implementation status](docs/implementation-status.md) and the
[implementation plan](docs/03_implementation_plan.md) for the verification
boundary and device checklist.
