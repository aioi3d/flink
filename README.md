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

The source now targets development runtime `1.0.10`. Its signature and
installed-build metadata are intentionally unresolved until the replacement
IPA is built and its Release inputs are recorded. During this transition,
`npm run native:check -- --profile development` must report `unresolved` with
no mismatches. The production signature remains intentionally unrecorded.

## Development IPA status

Runtime `1.0.6` retained the `isEqual(_:)` identity repair, but device testing
still rejected rename with `E_PATH_OUTSIDE_LIBRARY`. The remaining coordinator
path used ordinary resource-value APIs inside a `.forMoving` accessor and
reconstructed containment from an accessor URL whose spelling is not stable.
Runtime `1.0.7` uses Foundation's promised-item resource values and coordinated
source, parent, and library-root intents. Runtime `1.0.8` added a path-free,
allowlisted diagnostic ID to rejected rename/delete path checks. Runtime `1.0.9`
rebuilds each operational source, parent, and rename destination from the
validated relative path below the current app-owned library root, rather than
from an opaque enumerator URL spelling. It retains the symbolic-link,
fingerprint, coordinator, and physical-identity checks; device testing then
confirmed rename succeeds. Runtime `1.0.10` removes the manual `ページ全体`
zoom-reset control and its native bridge, while keeping automatic fitting when
a document opens, a page changes, or the layout changes. This breaks the native
view contract intentionally, so it raises the native API to 2. Build and install
`dev-runtime-v1.0.10` to pick up the removal. Keep the earlier Release evidence
as historical input.

Pushing a `dev-runtime-v*` tag alone does not start a native build. Production
`v*` tags do trigger the production path, so do not create one until the
development gate passes. The workflow never requests Apple
certificates, provisioning profiles, or App Store Connect credentials, and it
does not use GitHub Actions artifacts.

See [implementation status](docs/implementation-status.md) and the
[implementation plan](docs/03_implementation_plan.md) for the verification
boundary and device checklist.
