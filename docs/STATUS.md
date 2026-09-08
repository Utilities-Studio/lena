# Lena implementation status

Last verified: 2026-09-08.

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
| Repository foundation     | Package identity and release configuration complete; full local gate passes | Owner-run npm bootstrap, license decision, trusted-publisher setup, and first workflow evidence                    |
| `@lena-inc/core`          | Contract complete                                                           | Consuming-application integration                                                                                  |
| `@lena-inc/vault`         | Portable schema, transaction, and restore-classification contract complete  | Host migration artifacts, closed encrypted SQLite runtime, native pointer lifecycle, interruption and device proof |
| `@lena-inc/op-sqlite`     | Readiness contract complete                                                 | Approved native driver, SQLCipher runtime, benchmarks, recovery and device proof                                   |
| `@lena-inc/expo-sqlite`   | Readiness contract complete                                                 | Native adapter, SQLCipher runtime, recovery and device proof                                                       |
| `@lena-inc/backup`        | Portable protocol and ledger-backed completion complete                     | Crypto/filesystem runtime, provider execution, interruption and fresh-device proof                                 |
| `@lena-inc/manual-backup` | Contract complete                                                           | File/document-provider runtime and signed-device proof                                                             |
| `@lena-inc/icloud`        | Static read-only SDK seam source-integrated                                 | Immutable write/delete runtime, entitlements, account-change recovery and signed-device proof                      |
| `@lena-inc/google-drive`  | Static read-only SDK seam source-integrated                                 | Immutable resumable write/delete runtime, authentication recovery and signed-device proof                          |
| `@lena-inc/search`        | Portable FTS grammar, ranking, vector/index, and rebuild contracts complete | Keyed Drizzle FTS5/sqlite-vec executor, real adapter, representative benchmark and device proof                    |
| `@lena-inc/ai`            | Contract complete                                                           | Runtime selection, model licensing, download execution and device proof                                            |
| `@lena-inc/storekit`      | Static `expo-iap` service source-integrated                                 | Native configuration, sandbox/TestFlight and account-change proof                                                  |
| `@lena-inc/gps`           | Portable resolver and indexed geometry contract complete                    | Approved country dataset, native collection and signed-device proof                                                |
| `@lena-inc/sync`          | Contract complete, hard-disabled                                            | Separate owner-approved Hosted Sync milestone                                                                      |
| Local package consumption | All 13 packed artifacts install with pre-publish overrides                  | Published-registry install, consumer typecheck, Metro resolution, and native peers                                 |
| Jetseen Lena adoption     | Not started                                                                 | Package consumption, unified host Drizzle Kit history and app integration                                          |
| Becoming adoption         | Not started                                                                 | Runtime packages, attachment design and app integration                                                            |

`runtimeReady` remains `false` for both database targets. Hosted Sync remains unavailable. The
cloud-provider capability objects and StoreKit capability object also keep native/device readiness
false.

## Verified local evidence

Current package and release evidence on 2026-09-08:

- `bun run check` passes: all 161 supported files match Oxfmt, tsdown rebuilt all 13 packages,
  Are the Types Wrong and Publint found no package artifact problems, type-aware/type-checking Oxc
  passed, all 236 tests passed with 4,268 assertions across 33 files, and Knip completed without a
  finding;
- Bun 1.4.2 `bun outdated --recursive` reports no outdated external dependency. The exact
  `expo-iap@5.5.1` development dependency, host peer, lockfile resolution, and packed StoreKit
  manifest agree;
- all 13 package manifests and generated artifacts use `@lena-inc/*`, version `0.1.0`, exact
  internal release versions, public npm access, `UNLICENSED`, and the exact
  `utilities-studio/lena` repository identity;
- local `npm pack` produced all 13 publish-shaped tarballs. Every archive contains its package
  README and built JavaScript/declarations, contains no former package scope or `workspace:*`
  dependency, and passed strict manifest checks;
- a clean temporary Bun consumer installed all 13 tarballs with explicit pre-publication overrides,
  imported the 10 portable packages, and resolved the three native-boundary packages; and
- Changesets, the protected manual GitHub workflow, and npm trusted-publisher metadata are
  configured but have not been used to publish.

Focused evidence also includes:

- 49 vault and atomic backup-completion tests after replacing the process-local completion token
  path with one Drizzle transaction and a verified-generation ledger;
- 29 iCloud, Google Drive, and manual transport tests, including exact AppData constructor and
  read-operation arguments, provider-result mapping, safe native failure mapping, and token
  non-retention;
- 40 StoreKit tests, including listener-before-initialization ordering, connection-time event
  capture, failed-initialization cleanup, fail-closed refresh, local verification, finish-once
  behavior, restore, expiration, replay, refund, and revocation;
- a clean Bun 1.4.2 consumer installing all 13 archives through explicit local overrides, importing
  the 10 portable packages, and resolving the three native-boundary packages.

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
- Lena is unpublished. A tarball's exact internal `@lena-inc/*` dependency cannot resolve from npm
  before bootstrap publication. The proven pre-publish workaround requires direct tarballs and
  overrides for every selected and transitive Lena package. Registry installation remains unproven
  until the owner publishes the package family.
- Provider upload/delete plans still use process-local anti-forgery markers, but every plan states
  `executionAuthorized: false` and no destructive provider executor exists. A future executor must
  recheck the durable ledger and live provider resource inside the operation that acts.
- Vault validation/activation/retirement tokens remain source-contract guards. A runtime-ready
  claim requires a closed native vault service that owns integrity checks, pointer mutation,
  reopen verification, rollback, and retirement.
- Legacy StoreKit fact/catalog reducers remain cached process-local projections. Only the new
  `expo-iap` runtime service may gate paid access.
- `@lena-inc/storekit` declares `expo-iap@5.5.1` as both its exact host peer and development/test
  version. Source and artifact checks still do not prove it inside Jetseen's Expo 55 and React
  Native 0.83 binary.

## Explicit non-claims

- No Lena package is published or installed in Jetseen or Becoming. The GitHub publication workflow
  and npm trusted-publisher handshake have not run.
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
