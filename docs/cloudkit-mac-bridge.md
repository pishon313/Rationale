# CloudKit macOS bridge feasibility

## Recommended boundary

Use a small Swift framework linked into the Tauri macOS target. TypeScript calls narrow Tauri commands; Rust owns command validation and invokes the Swift C-compatible facade; Swift owns `CKContainer`, `CKSyncEngine`, custom-zone lifecycle, and Apple async APIs. Browser CloudKit JS, web Apple-ID login, private APIs, and ad-hoc Objective-C runtime calls are rejected.

The bridge should accept and return serialized sync envelopes only. It must not access SQLite or domain models. Rust/TypeScript retain candidate validation and transactional local persistence.

## Build and lifecycle

Build the Swift framework as an Xcode build phase or reproducible pre-build artifact, link it through the Tauri macOS bundle, and expose a minimal C ABI. A long-lived Swift owner retains `CKSyncEngine`; async operations complete through checked callbacks/continuations and map errors to stable non-sensitive codes. Tauri commands must never block the UI thread.

Tests use the TypeScript mock transport for contract/ledger behavior, Swift unit tests for envelope-to-CKRecord mapping and engine state callbacks, and a development-container integration test for the signed app. CloudKit development and production schemas require separate verification and explicit deployment before release.

## Configuration gate

The repository currently has placeholder bundle identifier `com.tradejournal.local`, no CloudKit entitlement file, no Apple team/signing configuration, and no explicit macOS minimum. Real bridge activation must wait for:

- final macOS bundle ID
- future iOS bundle ID
- shared `iCloud.<identifier>` container
- Apple Team/App IDs with iCloud + CloudKit capability
- development signing/provisioning
- agreed minimum macOS version compatible with the chosen `CKSyncEngine` API

Once supplied, add only `com.apple.developer.icloud-container-identifiers`, CloudKit services, and the required ubiquity container environment through Tauri's supported entitlement configuration. Do not silently raise the deployment target.
