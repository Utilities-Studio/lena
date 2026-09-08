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

| Package or slice          | Current status                                                              | Remaining evidence                                                                                                 |
| ------------------------- | --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| Repository foundation     | Local source lint, test, and audit gates pass                               | Provider artifact refresh, aggregate formatting, and publication/versioning workflow                               |
| `@lena/core`              | Contract complete                                                           | Consuming-application integration                                                                                  |
| `@lena/vault`             | Portable schema, transaction, and restore-classification contract complete  | Host migration artifacts, closed encrypted SQLite runtime, native pointer lifecycle, interruption and device proof |
| `@lena/op-sqlite`         | Readiness contract complete                                                 | Approved native driver, SQLCipher runtime, benchmarks, recovery and device proof                                   |
| `@lena/expo-sqlite`       | Readiness contract complete                                                 | Native adapter, SQLCipher runtime, recovery and device proof                                                       |
| `@lena/backup`            | Portable protocol and ledger-backed completion complete                     | Crypto/filesystem runtime, provider execution, interruption and fresh-device proof                                 |
| `@lena/manual-backup`     | Contract complete                                                           | File/document-provider runtime and signed-device proof                                                             |
| `@lena/icloud`            | Static read-only SDK seam source-integrated                                 | Immutable write/delete runtime, entitlements, account-change recovery and signed-device proof                      |
| `@lena/google-drive`      | Static read-only SDK seam source-integrated                                 | Immutable resumable write/delete runtime, authentication recovery and signed-device proof                          |
| `@lena/search`            | Portable FTS grammar, ranking, vector/index, and rebuild contracts complete | Keyed Drizzle FTS5/sqlite-vec executor, real adapter, representative benchmark and device proof                    |
| `@lena/ai`                | Contract complete                                                           | Runtime selection, model licensing, download execution and device proof                                            |
| `@lena/storekit`          | Static `expo-iap` service source-integrated                                 | Version alignment, native configuration, sandbox/TestFlight and account-change proof                               |
| `@lena/gps`               | Portable resolver and indexed geometry contract complete                    | Approved country dataset, native collection and signed-device proof                                                |
| `@lena/sync`              | Contract complete, hard-disabled                                            | Separate owner-approved Hosted Sync milestone                                                                      |
| Local package consumption | Prior core, vault and backup artifact import proven with overrides          | Refresh provider artifacts, then consumer typecheck, final distribution, Metro and native peers                    |
| Jetseen Lena adoption     | Not started                                                                 | Package consumption, unified host Drizzle Kit history and app integration                                          |
| Becoming adoption         | Not started                                                                 | Runtime packages, attachment design and app integration                                                            |

`runtimeReady` remains `false` for both database targets. Hosted Sync remains unavailable. The
cloud-provider capability objects and StoreKit capability object also keep native/device readiness
false.

## Verified local evidence

Current native-boundary and Search correction evidence on 2026-09-02:

- focused StoreKit, Search, iCloud, and Google Drive tests passed: 79 tests, 0 failed, with 663
  assertions across 12 files;
- full type-aware lint passed;
- full tests passed: 236 tests, 0 failed, with 4,268 assertions across 33 files;
- Knip completed with no findings;
- tsdown rebuilt all 13 packages after the StoreKit and Search correction, with Are the Types Wrong
  plus Publint clean. The later iCloud and Google Drive static-import correction changed those two
  sources. A second artifact build was prohibited, so their current `dist` files remain stale;
- every Oxfmt-supported source, test, and documentation file touched by the correction passes a
  path-scoped format check; and
- the aggregate `bun run check` is not green because `format:check` still finds 105 untouched files
  that do not match the current repository format configuration. Those files were not rewritten as
  part of this bounded slice.

Focused evidence also includes:

- 49 vault and atomic backup-completion tests after replacing the process-local completion token
  path with one Drizzle transaction and a verified-generation ledger;
- 29 iCloud, Google Drive, and manual transport tests, including exact AppData constructor and
  read-operation arguments, provider-result mapping, safe native failure mapping, and token
  non-retention;
- 40 StoreKit tests, including listener-before-initialization ordering, connection-time event
  capture, failed-initialization cleanup, fail-closed refresh, local verification, finish-once
  behavior, restore, expiration, replay, refund, and revocation;
- a clean Bun 1.4.0 consumer importing built `@lena/core`, `@lena/vault`, and `@lena/backup`
  artifacts through explicit local file overrides.

Current portable implementation evidence includes:

- strict Zod schemas and schema-inferred types, including Drizzle-derived database row contracts;
- neverthrow as the sole Result implementation;
- es-toolkit, date-fns, ts-pattern, canonical RFC 8785 JSON, Flatbush, compare-versions, modular
  Turf, and fast-check in their bounded ownership areas;
- one canonical Drizzle SQLite mapping with commit watermarks, an outbox, verified backup
  generations, adapter-owned exclusive transactions, and restore discovery that distinguishes
  current, older, and future schemas without treating an older schema as proven compatible;
- validated FTS5 MATCH compilation, vector-shape checks, deterministic ranking, and rebuild-state
  contracts; no executable SQLite search query exists;
- `expo-iap` current-entitlement reconciliation and read-only `react-native-cloud-storage` seams.

No database or migration command ran. Drizzle Kit is installed as an approved development tool, but
no host migration history or generated migration artifact exists. No adapter `migrate()` call,
keyed-staging migration, target-metadata verification, native integration, or signed-device
migration evidence exists.

## Known limitations

- The installed Drizzle 0.45.2 OP-SQLite transaction implementation does not await its async
  boundary operations. OP-SQLite migration execution remains blocked on an upstream fix plus real
  native ordering and rollback evidence. Expo SQLite source behavior does not prove OP-SQLite.
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
- `@lena/storekit` currently declares `expo-iap@5.4.1` as its exact host peer while its development
  and test installation resolves `5.5.0`. The source and artifact gates therefore prove 5.5.0 only.
  Align the exact peer, development dependency, and approved documentation before application
  adoption, then prove the selected version in Jetseen's Expo 55 and React Native 0.83 binary.

## Explicit non-claims

- No Lena package is published or installed in Jetseen or Becoming.
- No native SQLite driver, SQLCipher runtime, backup crypto runtime, filesystem staging runtime,
  generated host migration artifact, adapter migration executor, immutable cloud write/delete
  executor, or local-model executor is implemented.
- No simulator, browser, server, provider sandbox, StoreKit sandbox, database, or signed-device
  test ran.
- No benchmark, fresh-device restore, process-death native integration, TestFlight, or release
  evidence exists.
- Source tests do not prove iCloud entitlements, Google authentication, StoreKit configuration,
  native linking, operating-system background behavior, or real-device data recovery.
- No deploy, database, migration, Cloudflare, AWS, EAS, Expo publish, App Store, Play Store, or Git
  command ran.
