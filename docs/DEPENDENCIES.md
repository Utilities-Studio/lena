# Lena dependency decisions

Last reviewed: 2026-09-02.

The library-first foundation, cloud-file bridge, and StoreKit bridge are approved and locked.
Native database drivers, cryptographic/filesystem runtimes, model runtimes, host configuration,
signed-device evidence, and application adoption remain separate approval batches.

## Rule

Lena owns authority, protocol, lifecycle, privacy, and failure behavior. Maintained libraries own
generic validation, composition, transforms, date arithmetic, state matching, typed mappings,
geometry, and property generation. Future native libraries own native bridges, database engines,
cryptographic primitives, provider APIs, StoreKit, and model execution.

Every future batch requires an explicit version decision, source and license review, consuming-app
compatibility check, and owner approval before installation.

## Approved portable foundation

| Library                          | Approved version | Ownership and boundary                                                                                                                                 |
| -------------------------------- | ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `zod`                            | `4.5.4`          | Strict external, persisted, provider, native, and database-row schemas with schema-inferred types. Parsing never mints runtime authority.              |
| `neverthrow`                     | `8.2.0`          | The only shared Result implementation for expected failures.                                                                                           |
| `es-toolkit`                     | `1.52.0`         | Generic collection and object transforms through named, tree-shakeable imports.                                                                        |
| `date-fns`                       | `4.4.0`          | Portable date and canonical UTC-instant arithmetic without implicit device-zone policy.                                                                |
| `ts-pattern`                     | `5.9.0`          | Exhaustive matching for complex discriminated state machines after Zod validation.                                                                     |
| `drizzle-orm`                    | `0.45.2`         | One canonical typed schema mapping in `@lena/vault`, then ordinary adapter queries once runtimes exist. It is not a driver or migration authorization. |
| `drizzle-zod`                    | `0.8.3`          | Derives strict database row contracts from the canonical Drizzle mapping instead of duplicating row shapes.                                            |
| `canonicalize`                   | `4.0.0`          | RFC 8785 canonical JSON for backup-manifest bytes that are hashed or authenticated.                                                                    |
| `@turf/boolean-point-in-polygon` | `7.4.0`          | Point-in-polygon geometry only.                                                                                                                        |
| `@turf/distance`                 | `7.4.0`          | Ephemeral sample distance only.                                                                                                                        |
| `@turf/helpers`                  | `7.4.0`          | GeoJSON primitive construction only.                                                                                                                   |
| `@turf/bbox`                     | `7.4.0`          | Bounds for validated country polygons without handwritten or spread-based extrema scans.                                                               |
| `flatbush`                       | `4.5.0`          | Static per-dataset spatial index that limits Turf checks to candidate country polygons.                                                                |
| `compare-versions`               | `6.1.1`          | Validated model/runtime semantic-version comparison.                                                                                                   |

Each package declares only the subset it imports. No umbrella `@turf/turf`, Lodash, Remeda,
handwritten Result union, or duplicate schema-owned interface is approved.

## Approved development tools

| Tool                     | Approved version | Gate                                                                                                                                    |
| ------------------------ | ---------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `fast-check`             | `4.9.0`          | Property tests for schemas, codecs, reducers, replay, time, GPS, FTS, retention, and restore safety. Named regressions remain required. |
| `knip`                   | `6.34.0`         | Configured in `knip.json` with package entry points and test/source projects. Findings require review before deletion.                  |
| `oxfmt`                  | `0.66.0`         | The only repository formatter.                                                                                                          |
| `oxlint`                 | `1.80.0`         | Type-aware and type-checking lint; warnings fail the gate.                                                                              |
| `oxlint-tsgolint`        | `7.0.2001`       | Pinned type-aware Oxc engine.                                                                                                           |
| `tsdown`                 | `0.22.14`        | The only package build and declaration path; keeps dependencies external.                                                               |
| `typescript`             | `7.0.2`          | Declaration compiler used by tsdown. The exact upstream experimental-API warning is suppressed, not other warnings.                     |
| `lefthook`               | `2.1.12`         | Local hook runner. Installation was script-disabled; hook installation remains an owner-run Git mutation.                               |
| `publint`                | `0.3.24`         | Run only after Lena has a built, packed publishable artifact.                                                                           |
| `@arethetypeswrong/core` | `0.18.5`         | Used by tsdown against each built package artifact.                                                                                     |
| `@changesets/cli`        | `3.0.1`          | Installed, but configuration waits for publication, versioning, registry, and package-access decisions.                                 |

These tools do not run Git, publish, deploy, configure infrastructure, or change a database.

## Consuming-application libraries

React Hook Form with `@hookform/resolvers/zod`, TanStack Query, and `@date-fns/tz` belong in a
consuming React Native application when its form, remote UI state, or jurisdiction-zone behavior
needs them. They are not portable Lena dependencies and never become storage, payment, backup,
restore, or sync authority. `@date-fns/tz` also requires the host's Hermes Intl polyfills to load
before timezone APIs.

`usehooks-ts` is excluded because it is browser-oriented and is not a React Native foundation.

## Batch A: Local encrypted database

`drizzle-orm@0.45.2` and `zod@4.5.4` are already approved for one portable canonical mapping in
`@lena/vault`, consumed by both SQLite adapter packages. They add no native database driver,
SQLCipher build, migration runtime, database connection, or signed-device proof.

### Jetseen candidate

- `@op-engineering/op-sqlite`
- SQLCipher enabled.
- FTS5 enabled.
- `sqlite-vec` enabled if compatible with the SQLCipher build.
- libSQL and Turso disabled.

The upstream main branch reports a placeholder `0.0.0`, so Lena must resolve and review the latest stable registry release at approval time instead of copying the main-branch version. OP-SQLite is accepted only after the benchmark and recovery gates in [Plan 03](./plans/03-database-engines.md).

Official source: <https://github.com/OP-Engineering/op-sqlite>

### Expo-compatible candidate

- `expo-sqlite` matching the consuming Expo SDK.
- Jetseen currently uses Expo `55.0.4` and Expo SQLite `55.0.10`.
- Becoming currently uses Expo `56.0.9` and Expo SQLite `56.0.4`.
- SQLCipher and `sqlite-vec` require explicit native configuration and new binaries.

Official source: <https://docs.expo.dev/versions/latest/sdk/sqlite/>

## Batch B: Key storage and backup encryption

- `expo-secure-store` matching the consuming Expo SDK for device-bound secrets.
- `expo-crypto` matching the consuming Expo SDK for audited random/AES primitives if its streaming and memory behavior passes the backup benchmark.
- React Native Quick Crypto only as a benchmarked fallback if the Expo path cannot process large backup payloads safely.

The recovery-code KDF, key wrapping, rotation, and cross-device flow require a separate cryptographic design review. No custom cipher or KDF will be written in Lena.

Official sources:

- <https://docs.expo.dev/versions/latest/sdk/securestore/>
- <https://docs.expo.dev/versions/latest/sdk/crypto/>
- <https://github.com/margelo/react-native-quick-crypto>

## Batch C: Manual files

- `expo-file-system` matching the host SDK.
- `expo-document-picker` for explicit import.
- `expo-sharing` for explicit export where supported.

Becoming needs attachment-byte packaging and URI rewriting because photos live outside its journal database. Jetseen also has managed attachments outside its structured tables.

Official sources:

- <https://docs.expo.dev/versions/latest/sdk/filesystem/>
- <https://docs.expo.dev/versions/latest/sdk/document-picker/>
- <https://docs.expo.dev/versions/latest/sdk/sharing/>

## Batch D: Personal cloud transports

Approved bridge:

- `react-native-cloud-storage@3.1.0`

It is a host peer dependency used only for exact encrypted file operations in app-private storage.
Lena still owns immutable generations, encryption, checksums, retry state, verification, retention,
selection, staging restore, and rollback. Source integration is not signed-device or configuration
proof.

Second experimental bake-off:

- `react-native-cloud-sync`

Its mutable sync/mirroring policy cannot become backup authority. It must prove binary codec behavior and process-interruption safety before consideration.

Official sources:

- <https://github.com/kuatsu/react-native-cloud-storage>
- <https://github.com/kesha-antonov/react-native-cloud-sync>

## Batch E: StoreKit

Approved bridge:

- `expo-iap`, currently `5.4.1` in the OpenIAP monorepo.

It is a host peer dependency backed by OpenIAP and StoreKit 2. Lena uses exact-product, locally
StoreKit-verified current entitlement and explicit restore. Hosted validation, dashboards, and
entitlement services are not part of Private Vault.

The package must be checked against Jetseen's Expo 55/RN 0.83 binary before adoption. Becoming does not need payment in its first Lena slice.

Official source: <https://github.com/hyodotdev/openiap/tree/main/libraries/expo-iap>

## Batch F: Search and local AI

Search:

- FTS5 from the selected SQLite build.
- `sqlite-vec` compiled into the selected native database build.

Local AI first candidate:

- `react-native-executorch@0.10.0`.
- Its matching Expo resource fetcher and host-compatible Expo file/asset packages.

React Native ExecuTorch requires New Architecture, iOS 17, and Android 13. It is therefore optional and cannot define Lena's minimum application OS. `llama.rn` remains the LLM-specific alternative.

Official sources:

- <https://github.com/asg017/sqlite-vec>
- <https://github.com/software-mansion/react-native-executorch>
- <https://github.com/mybigday/llama.rn>

## Batch G: Offline country boundaries

Use an audited, simplified, versioned country-boundary asset with a compatible redistribution license. Natural Earth is the leading data source. The generated spatial index must be reproducible from the pinned source and checked for antimeridian, disputed-boundary, polygon-hole, size, latency, and memory behavior.

Approved modular Turf packages own point-in-polygon, distance, and GeoJSON helper mechanics. Lena
continues to own input limits, antimeridian normalization, overlap priority, runtime opacity,
privacy minimization, and review-first policy. Dataset ingestion and generation do not run until
the source, version, license, and generated-file process are approved.

Official source: <https://www.naturalearthdata.com/>

## Rejected as core authority

- RxDB: document model, premium production React Native storage, field-level rather than whole-database encryption, and no required staged mobile restore contract.
- `@loonylabs/react-native-offline-sync`: insufficient adoption and no encryption/backup/restore proof.
- Realm Sync: deprecated synchronized path.
- WatermelonDB: no documented first-class SQLCipher path for this contract.
- PowerSync: future Hosted Sync candidate only, not Private Vault backup authority.
