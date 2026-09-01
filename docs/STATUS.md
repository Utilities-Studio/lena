# Lena implementation status

Last verified: 2026-09-01.

## Status language

- `planned`: the outcome and gates are documented.
- `contract complete`: the portable public contract, approved library foundation, and adversarial
  unit tests pass.
- `runtime complete`: approved native/runtime code and integration tests pass.
- `device proven`: owner-run signed-device acceptance evidence passes.
- `adopted`: a released consuming application uses the package.

## Current status

| Package or slice      | Current status                   | Remaining evidence                                             |
| --------------------- | -------------------------------- | -------------------------------------------------------------- |
| Repository foundation | Contract complete                | Type-aware lint tool approval; Knip findings; release gates    |
| `@lena/core`          | Contract complete                | Consumer integration                                           |
| `@lena/vault`         | Contract and schema complete     | Encrypted SQLite adapter, interruption and device proof        |
| `@lena/op-sqlite`     | Readiness contract complete      | Native driver approval, benchmark, recovery and device proof   |
| `@lena/expo-sqlite`   | Readiness contract complete      | Native driver approval, recovery and device proof              |
| `@lena/backup`        | Contract complete                | Crypto/filesystem runtime, interruption and fresh-device proof |
| `@lena/manual-backup` | Contract complete                | Files/document-provider adapter and signed-device proof        |
| `@lena/icloud`        | Transport contract complete      | Native provider adapter and signed iCloud proof                |
| `@lena/google-drive`  | Transport contract complete      | Native provider/auth adapter and signed Drive proof            |
| `@lena/search`        | Contract complete                | FTS5/vector adapter, representative benchmark and device proof |
| `@lena/ai`            | Contract complete                | Runtime choice, model licensing, download and device proof     |
| `@lena/storekit`      | Contract complete                | StoreKit bridge, sandbox/TestFlight and account-change proof   |
| `@lena/gps`           | Contract complete                | Approved dataset, native collection and signed-device proof    |
| `@lena/sync`          | Contract complete, hard-disabled | Separate owner-approved Hosted Sync milestone                  |
| Jetseen Lena adoption | Not started                      | Package consumption, migration design and app integration      |
| Becoming adoption     | Not started                      | Runtime packages, attachment design and app integration        |

`runtimeReady` remains `false` for both database targets. Hosted Sync remains unavailable even if
its consent reducer reaches a consented design state.

## Verified local evidence

`bun run check` passed on 2026-09-01 against the combined library-first implementation:

- `oxfmt --check .`: passed across 133 files.
- `oxlint --deny-warnings -D correctness -D suspicious -D perf packages`: passed.
- `tsc --noEmit -p tsconfig.json`: passed.
- `bun test packages`: 211 tests passed, 0 failed, 4,990 `expect()` calls across 30 files.

Current portable implementation evidence includes:

- strict Zod schemas and schema-inferred boundary types;
- neverthrow as the sole Result implementation;
- es-toolkit collection transforms, date-fns UTC chronology, and ts-pattern state matching;
- one canonical Drizzle SQLite mapping in `@lena/vault`, consumed by both database readiness
  packages without running a database or migration;
- modular Turf geometry while raw coordinates remain runtime-only;
- fast-check properties alongside named adversarial regressions.

The adversarial suites cover structural forgery, object spread, JSON reconstruction, replay,
cross-vault/provider/instance mismatch, stale attempts, time regression, restart loss of runtime
authority, one-shot evidence, rollback uncertainty, payment revocation resurrection, coordinate
privacy, and hard-disabled Hosted Sync.

## Known tooling gap

`bun run lint:type-aware` is configured but cannot run until `oxlint-tsgolint` is approved and
installed. Current output is:

```text
Failed to find tsgolint executable. You may need to add the oxlint-tsgolint package to your project?
```

No dependency or lockfile was changed to hide this gap.

## Advisory dependency audit

`bunx knip --config knip.json --dependencies --reporter compact` completed on 2026-09-01 and
reported three review items:

- `@lena/core` is declared but not directly imported by `@lena/op-sqlite` and
  `@lena/expo-sqlite`;
- the existing root scripts invoke unlisted `oxfmt`, `oxlint`, and `tsc` binaries.

Knip findings are advisory. No dependency was removed or added merely to silence the audit. The
two internal dependency declarations and root tool ownership need an explicit follow-up dependency
decision.

## Explicit non-claims

- No Lena package is published or installed in Jetseen or Becoming.
- No native database, SQLCipher, crypto, filesystem, provider, StoreKit, GPS, or model adapter is
  implemented.
- No simulator, browser, server, provider sandbox, StoreKit sandbox, or signed-device test ran.
- No benchmark, fresh-device restore, process-death integration, or release evidence exists yet.
- Runtime-opaque evidence is process-local. Persisted claims must be reverified after restart, and
  consuming applications must resolve one physical copy of each authority-owning package.
- No deploy, database, migration, Cloudflare, AWS, EAS, Expo publish, App Store, Play Store, or Git
  command ran.

The repository is complete at the portable contract and approved library-foundation layer. Native
runtime work starts only after the exact native dependency batch receives owner approval.
