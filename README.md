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

The development runtime is pinned to the CI-verified `dev-runtime-v1.0.4`
inputs. A plain `npm run native:check` now infers the installed development
profile and must report `compatible`; use `--profile production` only when
preparing a production runtime.

## Development IPA status

The `dev-runtime-v1.0.4` workflow completed successfully. Its resolved
`Podfile.lock`, build metadata, and development signature are recorded in this
checkout. Next, re-sign/install `Flink-dev-runtime-1.0.4-unsigned.ipa` with
SideStore or an equivalent tool, then run the smoke checklist on both iPhone
and iPad and retain the workflow/device log.

Pushing a `dev-runtime-v*` tag alone does not start a native build. Production
`v*` tags do trigger the production path, so do not create one until the
development gate passes. The workflow never requests Apple
certificates, provisioning profiles, or App Store Connect credentials, and it
does not use GitHub Actions artifacts.

See [implementation status](docs/implementation-status.md) and the
[implementation plan](docs/03_implementation_plan.md) for the verification
boundary and device checklist.
