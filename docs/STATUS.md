# Lena implementation status

Last verified: 2026-09-02.

## Status language

- `planned`: the outcome and gates are documented.
- `contract complete`: portable schemas, reducers, plans, and adversarial tests pass.
- `source-integrated`: the approved SDK is called through a checked source boundary, but native
  configuration and signed-device behavior remain unproven.
- `runtime complete`: the native/runtime implementation and integration tests pass.
- `device proven`: owner-run signed-device acceptance evidence passes.
- `adopted`: a released consuming application uses the package.

## Current status

| Package or slice          | Current status                                                | Remaining evidence                                                                            |
| ------------------------- | ------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| Repository foundation     | Local gate complete                                           | Publication/versioning workflow and CI execution                                              |
| `@lena/core`              | Contract complete                                             | Consuming-application integration                                                             |
| `@lena/vault`             | Portable schema, transaction, and migration contract complete | Closed encrypted SQLite runtime, native pointer lifecycle, interruption and device proof      |
| `@lena/op-sqlite`         | Readiness contract complete                                   | Approved native driver, SQLCipher runtime, benchmarks, recovery and device proof              |
| `@lena/expo-sqlite`       | Readiness contract complete                                   | Native adapter, SQLCipher runtime, recovery and device proof                                  |
| `@lena/backup`            | Portable protocol and ledger-backed completion complete       | Crypto/filesystem runtime, provider execution, interruption and fresh-device proof            |
| `@lena/manual-backup`     | Contract complete                                             | File/document-provider runtime and signed-device proof                                        |
| `@lena/icloud`            | Read-only SDK seam source-integrated                          | Immutable write/delete runtime, entitlements, account-change recovery and signed-device proof |
| `@lena/google-drive`      | Read-only SDK seam source-integrated                          | Immutable resumable write/delete runtime, authentication recovery and signed-device proof     |
| `@lena/search`            | Contract and bounded SQLite query plans complete              | FTS5/vector adapter, representative benchmark and device proof                                |
| `@lena/ai`                | Contract complete                                             | Runtime selection, model licensing, download execution and device proof                       |
| `@lena/storekit`          | `expo-iap` service source-integrated                          | Native configuration, sandbox/TestFlight and account-change proof                             |
| `@lena/gps`               | Portable resolver and indexed geometry contract complete      | Approved country dataset, native collection and signed-device proof                           |
| `@lena/sync`              | Contract complete, hard-disabled                              | Separate owner-approved Hosted Sync milestone                                                 |
| Local package consumption | Core, vault and backup artifact import proven with overrides  | Final registry or workspace distribution, consumer typecheck, Metro and native peers          |
| Jetseen Lena adoption     | Not started                                                   | Package consumption, host migration registry and app integration                              |
| Becoming adoption         | Not started                                                   | Runtime packages, attachment design and app integration                                       |

`runtimeReady` remains `false` for both database targets. Hosted Sync remains unavailable. The
cloud-provider capability objects and StoreKit capability object also keep native/device readiness
false.

## Verified local evidence

`bun run check` passed on 2026-09-02:

- Oxfmt checked 149 files.
- tsdown built ESM and declarations for all 13 packages.
- Are the Types Wrong and Publint reported no artifact problems for every package.
- Oxc type-aware lint and TypeScript type checking passed across package source and tests.
- 236 tests passed, 0 failed, with 4,265 assertions across 35 files.
- Knip completed with no findings.

Focused evidence also includes:

- 49 vault and atomic backup-completion tests after replacing the process-local completion token
  path with one Drizzle transaction and a verified-generation ledger;
- 25 iCloud, Google Drive, and manual transport tests;
- 37 StoreKit tests, including fail-closed refresh, pending/revoked/upgraded updates, local
  verification, finish-once behavior, restore, expiration, replay, refund, and revocation;
- a clean Bun 1.4.0 consumer importing built `@lena/core`, `@lena/vault`, and `@lena/backup`
  artifacts through explicit local file overrides.

Current portable implementation evidence includes:

- strict Zod schemas and schema-inferred types, including Drizzle-derived database row contracts;
- neverthrow as the sole Result implementation;
- es-toolkit, date-fns, ts-pattern, canonical RFC 8785 JSON, Flatbush, compare-versions, modular
  Turf, and fast-check in their bounded ownership areas;
- one canonical Drizzle SQLite mapping with commit watermarks, an outbox, verified backup
  generations, exact executable migration steps, and adapter-owned exclusive transactions;
- bounded FTS5 and sqlite-vec query plans that keep text and vectors bound rather than interpolated;
- `expo-iap` current-entitlement reconciliation and read-only `react-native-cloud-storage` seams.

No database or migration command ran. Migration evidence is source validation and transaction-handle
unit coverage only.

## Known limitations

- Lena is unpublished. Bun cannot resolve nested `workspace:*` dependencies from sibling `file:`
  packages by itself. The proven pre-publish workaround requires exact direct dependencies and
  overrides for every selected/transitive `@lena/*` package.
- Provider upload/delete plans still use process-local anti-forgery markers, but every plan states
  `executionAuthorized: false` and no destructive provider executor exists. A future executor must
  recheck the durable ledger and live provider resource inside the operation that acts.
- Vault validation/activation/retirement tokens remain source-contract guards. A runtime-ready
  claim requires a closed native vault service that owns integrity checks, pointer mutation,
  reopen verification, rollback, and retirement.
- Legacy StoreKit fact/catalog reducers remain cached process-local projections. Only the new
  `expo-iap` runtime service may gate paid access.

## Explicit non-claims

- No Lena package is published or installed in Jetseen or Becoming.
- No native SQLite driver, SQLCipher runtime, backup crypto runtime, filesystem staging runtime,
  immutable cloud write/delete executor, or local-model executor is implemented.
- No simulator, browser, server, provider sandbox, StoreKit sandbox, database, or signed-device
  test ran.
- No benchmark, fresh-device restore, process-death native integration, TestFlight, or release
  evidence exists.
- Source tests do not prove iCloud entitlements, Google authentication, StoreKit configuration,
  native linking, operating-system background behavior, or real-device data recovery.
- No deploy, database, migration, Cloudflare, AWS, EAS, Expo publish, App Store, Play Store, or Git
  command ran.
