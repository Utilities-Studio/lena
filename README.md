# lena

Contracts for local, encrypted, native application infrastructure.

Lena is a reusable local-first foundation for applications that must remain useful without a company server and must never lose the user's data.

Its implemented contract layer defines the shared infrastructure intended for products such as
Jetseen and Becoming:

- encrypted local databases;
- immutable backup generations;
- safe staged restore;
- user-controlled iCloud, Google Drive, and manual backups;
- full-text and semantic search;
- optional on-device AI;
- independent StoreKit payment authority;
- privacy-preserving GPS primitives;
- an optional future hosted-sync boundary.

The portable contract layer uses maintained, native-runtime-free libraries for validation,
fallible composition, collection transforms, date arithmetic, state matching, typed SQLite
mappings, geospatial primitives, and property testing. Native database drivers, SQLCipher,
cryptography, files, cloud providers, StoreKit, country data, and local model execution remain
separately gated and unproven.

Lena owns infrastructure. Applications continue to own their domain schema, calculations, product rules, user experience, and copy.

## Why Lena exists

Offline-first applications repeatedly need the same difficult infrastructure:

- opening and migrating an encrypted database;
- surviving process termination during writes;
- creating consistent snapshots without corrupting the active database;
- encrypting and verifying backups;
- restoring without deleting the current working vault first;
- handling cloud-provider expiry, quota, interruption, and account changes;
- rebuilding local search and AI indexes;
- keeping payment, backup, and data identities independent.

These systems are easy to implement almost correctly. Almost correct is unacceptable when the result can be a lost travel history or journal.

Lena defines and hardens these protocols once so applications can reuse the same failure behavior.
Native engines and provider bridges are added only after their dependency, integration, and
signed-device gates pass.

## Core promise

```text
The local vault is authoritative.
The user owns every recovery path.
No payment, account, provider, sync, or AI failure can delete the vault.
```

## Architecture

```text
Application domain
  Jetseen                         Becoming
  trips, visas, GPS               journals, moods, photos
       |                                  |
       +---------------+------------------+
                       |
                    Lena APIs
                       |
       +---------------+-------------------------------+
       |               |               |               |
   Encrypted        Backup and      Search and      Independent
   local vault      safe restore    local AI        platform APIs
       |               |               |               |
   OP-SQLite        iCloud          FTS5            StoreKit
   Expo SQLite      Google Drive    sqlite-vec       GPS
   SQLCipher        manual file     local models     future sync
```

Lena is modular. An application installs only the packages it needs.

## Package namespace

Lena uses its own package scope:

```text
@lena/core
@lena/vault
@lena/op-sqlite
@lena/expo-sqlite
@lena/backup
@lena/icloud
@lena/google-drive
@lena/manual-backup
@lena/search
@lena/ai
@lena/storekit
@lena/gps
@lena/sync
```

`@lena/*` communicates that Lena is a reusable platform with its own identity. `@utilities-studio/lena-*` would make the package family look like an internal application utility.

The `@lena` registry scope must be reserved before public packages are published. During local development, applications consume the packages from this sibling workspace.

## Package responsibilities

### `@lena/core`

Domain-neutral identifiers, data contracts, errors, compatibility rules, and invariants shared by all Lena packages.

It contains no React components, database engine, cloud provider, payment SDK, or application schema.

### `@lena/vault`

Vault lifecycle, schema-version classification, transactional mutation obligations, integrity checks, and active-vault selection.

It never derives a vault identity from an email, payment, provider account, or installation path.
The consuming application owns one unified vault schema version and one Drizzle Kit history generated
from its domain schema plus Lena's exported table definitions. Lena does not ship a handwritten
migration registry, planner, or statement executor. Backup discovery classifies a candidate schema
as current, older, or future. A future schema is rejected. An older schema may enter staging, but it
is not proven compatible until the keyed adapter applies the host migration bundle and target
metadata plus integrity validation pass without changing the active-vault pointer.

### `@lena/op-sqlite`

The readiness contract for the high-performance React Native target using OP-SQLite and
SQLCipher. The native implementation remains dependency-gated.

Target capabilities:

- whole-database encryption;
- WAL and foreign-key enforcement;
- exclusive transactions;
- consistent encrypted snapshots;
- FTS5;
- `sqlite-vec`;
- failure-safe close, reopen, and recovery behavior.

Jetseen targets this implementation after its native-build and recovery gates pass.

### `@lena/expo-sqlite`

The readiness contract for applications that prioritize Expo-managed SQLite compatibility or
cannot yet accept another native database dependency. The native implementation remains
dependency-gated.

Becoming can target this implementation until its native-library policy is explicitly changed.
Both database targets must expose the same Lena data contracts without passing module-owned
functions through dependency bags.

### `@lena/backup`

The provider-independent backup protocol:

- immutable generation identifiers;
- authenticated encryption envelopes;
- manifests and checksums;
- durable pending-work state;
- last-known-good retention;
- non-mutating discovery;
- staged validation;
- atomic activation;
- rollback to the previous vault.

Transport packages never decide which generation is valid and never mutate the active database.
Persisted verification records and plans are non-authorizing claims. Export, restore, retention,
upload, reconciliation, and deletion must recheck the canonical ledger and the real runtime
resource inside the operation that acts.

### `@lena/icloud`, `@lena/google-drive`, and `@lena/manual-backup`

Narrow transport protocols for uploading, downloading, listing, inspecting, and deleting exact
encrypted objects through the approved `react-native-cloud-storage` host peer. Provider plans do
not authorize I/O; the acting runtime must recheck Lena's ledger and current state.

They do not own backup policy, encryption keys, retention, or restore selection. Host entitlements,
provider authentication, interruption behavior, and signed-device operation remain unproven.

### `@lena/search`

Portable local-search contracts:

- safe FTS5 MATCH grammar for exact words, phrases, prefixes, and filters;
- vector metadata and embedding-shape validation for future `sqlite-vec` execution;
- hybrid ranking across lexical and semantic results;
- rebuildable index versions tied to the source content and embedding model.

Search indexes are derived data. Losing or rebuilding an index never loses a journal entry or trip.
No executable SQLite search query exists yet. The real keyed adapter will build and run the bounded
FTS5 and `sqlite-vec` query through Drizzle instead of exposing a standalone SQL string plan.

### `@lena/ai`

Optional on-device model contracts such as embeddings, reranking, summarization, and structured
generation. Model execution remains dependency-gated.

AI is never required to open, search, back up, restore, or export the canonical vault. Cloud inference is not an automatic fallback.

### `@lena/storekit`

Portable contracts plus the narrow `expo-iap` StoreKit 2 boundary for exact-product, locally
verified current entitlement, isolated from local data ownership. Cached facts and reduced catalog
state are never stronger than a fresh StoreKit check. Native configuration and signed-device proof
remain gated.

Production uses normal static named `expo-iap` imports. Bun's test preload owns the SDK mock; test
loading does not shape the production module boundary.

Payment can control paid features. It cannot select, encrypt, hide, clear, or restore a vault.

### `@lena/gps`

Pure location-transition and country-observation primitives.

Raw coordinates remain transient. Applications persist only the minimum derived observation required by their product, and domain applications decide whether a proposed event becomes canonical data.

### `@lena/sync`

A future opt-in hosted-sync boundary. It is not part of Private Vault operation and is not required by the initial Lena release.

## Canonical and derived data

Lena separates irreplaceable user data from rebuildable acceleration data.

```text
Canonical encrypted vault
  entries, trips, visas, settings, relationships
                    |
                    +--> FTS5 index
                    +--> vector embeddings
                    +--> local summaries
                    +--> cached search ranking

Canonical data is backed up.
Derived data can be rebuilt after restore.
```

If a complete database snapshot contains derived indexes, restore may discard and rebuild them when the index or model version changes.

## Identity boundaries

Lena treats these as separate identifiers:

| Identity         | Purpose                                            |
| ---------------- | -------------------------------------------------- |
| `vault_id`       | Identifies one local encrypted data vault          |
| Payment identity | StoreKit purchase authority                        |
| Backup identity  | The user's selected iCloud or Google Drive account |
| Hosted identity  | Future opt-in hosted sync access                   |

Changing any one identity must not delete, reassign, or silently upload another identity's data.
StoreKit observes entitlement for the device's current App Store account. Lena never receives or
stores the user's Apple ID or email address.

## Encryption and recovery

Encryption is always on for private user data.

```text
Platform Keychain or Keystore
            |
        vault key
            |
     SQLCipher database

Vault recovery key
            |
  encrypted backup envelope
            |
 iCloud, Drive, or manual file
```

Lena's protocol owns key lifecycle and recovery mechanics. The future SQLite runtimes perform
active database encryption, and the future backup crypto runtime performs provider-independent
authenticated encryption. Neither runtime is implemented or device-proven yet.

Encryption must not create a new data-loss path. The only recovery key cannot exist solely on the original device.

## Backup invariants

Every Lena backup implementation must preserve these rules:

1. A new generation never overwrites the last known-good generation.
2. Backup inspection never creates, replaces, or deletes a generation.
3. Upload failure leaves durable pending work.
4. Restore never clears the active vault before complete staging validation.
5. Corruption, a wrong key, incompatible schema, or insufficient disk space leaves the current vault untouched.
6. Provider expiry, account switching, quota errors, and payment changes never delete local data.
7. Destructive cleanup runs only after a newer verified recovery point exists.

## Application adoption

### Jetseen

Target package set:

```text
@lena/core
@lena/vault
@lena/op-sqlite
@lena/backup
@lena/icloud
@lena/google-drive
@lena/manual-backup
@lena/search
@lena/storekit
@lena/gps
```

Jetseen continues to own travel rules, country calculations, trips, visas, review proposals, screens, and product behavior.

### Becoming

Initial compatible package set:

```text
@lena/core
@lena/vault
@lena/expo-sqlite
@lena/backup
@lena/icloud
@lena/google-drive
@lena/manual-backup
@lena/search
@lena/ai
```

Becoming continues to own journal entries, prompts, moods, photos, insights, themes, and its editor experience.

## Local workspace consumption

Every package exports built ESM and declarations from `dist`. Build Lena before using a sibling
checkout:

```sh
bun install --ignore-scripts
bun run build
```

Unpublished multi-package consumption currently needs direct file dependencies plus exact
overrides for every selected and transitive Lena package. For example, a consumer beside `lena`
that uses backup and vault declares:

```json
{
	"dependencies": {
		"@lena/backup": "file:../lena/packages/backup",
		"@lena/core": "file:../lena/packages/core",
		"@lena/vault": "file:../lena/packages/vault"
	},
	"overrides": {
		"@lena/backup": "file:../lena/packages/backup",
		"@lena/core": "file:../lena/packages/core",
		"@lena/vault": "file:../lena/packages/vault"
	}
}
```

This exact core, vault, and backup shape installed offline in a clean Bun 1.4.0 consumer. Direct
`file:` dependencies without overrides fail because Bun cannot resolve a nested `workspace:*`
package outside Lena. Packed and peer-dependency variants also attempted to fetch the unpublished
`@lena` scope. The override shape is therefore a pre-publish development workaround, not the final
distribution contract and not proof of Metro or native integration.

Bun snapshots local file dependencies during install. After rebuilding Lena, an already-installed
consumer refreshes those artifacts with `bun install --force --ignore-scripts --offline`.

Jetseen and Becoming adoption must still prove their package manager, consumer typecheck, Metro
resolution, one physical copy of Lena runtime-capability modules, native configuration, and
signed-device behavior before Lena is described as plug-and-play.

Each consuming repository keeps its own package manager, lockfile, native configuration, and
release process. Lena never deploys an application.

Public or private registry publishing is a later decision. No package should be described as published until the registry scope, versioning, license, provenance, and release process are explicitly approved.

## Delivery order

Lena is being built in independently verifiable vertical slices:

1. Core contracts and invariants.
2. Vault contracts, followed by OP-SQLite plus SQLCipher runtime implementation.
3. Immutable local backup generations and staged restore.
4. Manual encrypted import and export.
5. iCloud and Google Drive transports.
6. FTS5 and `sqlite-vec` search.
7. On-device embeddings and optional local AI.
8. StoreKit payment authority.
9. GPS transition primitives.
10. Optional hosted sync under a separate milestone.

Each slice must prove interruption, corruption, rollback, and compatibility behavior before an application depends on it.

## What Lena is not

Lena is not:

- a hosted database;
- a required account system;
- a cloud backup provider;
- a payment service;
- a UI component library;
- a travel or journal domain framework;
- an excuse to upload private data;
- a single package containing every dependency.

## Library ownership

Lena uses one canonical library for each generic mechanism and keeps Lena-specific authority,
privacy, lifecycle, and failure policy in Lena:

- Zod owns strict structural boundaries and schema-inferred types.
- neverthrow owns expected fallible composition and the shared Result API.
- es-toolkit owns generic collection and object transforms.
- date-fns owns portable date and UTC-instant arithmetic.
- ts-pattern owns exhaustive matching for complex state reducers.
- Drizzle owns the canonical typed SQLite mapping in `@lena/vault`, host-generated migration
  history, and driver-specific runtime migration execution; `drizzle-zod` derives strict row
  contracts. Each application generates one Lena plus domain history with Drizzle Kit. A future
  adapter calls the official `migrate()` only inside its keyed open or staging service. Direct SQL
  remains valid for key-before-inspection, PRAGMAs, FTS5, `sqlite-vec`, integrity checks, exact
  recovery transactions, and custom migration backfills or constraints Drizzle cannot represent.
  Such migration SQL remains a checked-in Drizzle artifact, never a second TypeScript migration
  engine.
- The owner-run `bun run schema:export` command prints the current Lena table DDL for inspection.
  It does not create a host migration history, apply a migration, or prove backup compatibility.
- `canonicalize` owns RFC 8785 backup-manifest bytes that are hashed or authenticated.
- Modular `@turf/*` packages own geometric primitives. Lena still owns privacy minimization,
  antimeridian policy, overlap priority, and review-first behavior. Flatbush owns the static
  per-dataset candidate index.
- `compare-versions` owns model/runtime version validation and ordering.
- fast-check owns generative invariant coverage alongside named adversarial regressions.

`expo-iap` and `react-native-cloud-storage` are narrow host peer dependencies for StoreKit 2 and
personal cloud files. They do not provide a native SQLite driver, SQLCipher, backup crypto,
filesystem staging, model runtime, host configuration, or signed-device evidence.

Production native boundaries use static named imports. Bun preloads test-owned SDK mocks before
unit modules evaluate; production loading is never changed to accommodate a test runner.

React Hook Form with its Zod resolver, TanStack Query, and `@date-fns/tz` are consuming-application
tools. They do not belong in Lena's portable packages. `usehooks-ts` is excluded because Lena's
consumers are React Native applications, not browser applications.

Oxfmt, type-aware/type-checking Oxc, tsdown, declaration generation, Publint, Are the Types Wrong,
tests, and Knip form one pinned local gate. Changesets configuration waits for publication,
versioning, and registry decisions. None of these tools publishes or deploys.

## Status

The portable contract layer is implemented across core, vault,
backup, manual backup, cloud transport protocols, search, AI, StoreKit, GPS, and the hard-disabled
Hosted Sync boundary. Its approved library-first foundation is package-scoped rather than bundled
into core. `@lena/vault` exposes one canonical typed Drizzle mapping; OP-SQLite and Expo SQLite
currently expose honest readiness contracts that consume it.

No native OP-SQLite or Expo SQLite driver, SQLCipher runtime, backup-cryptography runtime,
filesystem staging runtime, audited country dataset, or local-model runtime is implemented. The
`expo-iap` StoreKit service and read-only `react-native-cloud-storage` provider seams are
source-integrated, but native configuration and signed-device behavior remain unproven. Immutable
cloud write/delete execution is not implemented. No host migration history or generated migration
artifact exists, and no adapter migration runtime has executed. No Lena package is published,
installed in an application, runtime-complete, or proven on a signed device.

See [implementation status](./docs/STATUS.md), [ordered plans](./docs/plans/README.md), and
[dependency approval batches](./docs/DEPENDENCIES.md).
