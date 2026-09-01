# Lena architecture

## Purpose

Lena is reusable local-first infrastructure. It provides durable mechanisms while each application owns its schema, domain rules, UX, copy, analytics choices, and release process.

## Authority model

```text
Canonical application data
        |
        v
Encrypted local vault -----------------------+
        |                                     |
        +--> immutable encrypted backups      +--> derived search and AI
        |       local, iCloud, Drive, file          rebuildable at any time
        |
        +--> optional future Hosted Sync
             explicit consent only

Independent boundaries:
StoreKit | vault_id | backup provider | hosted identity
```

The local vault is authoritative in both Private Vault and future Hosted Sync modes. A remote system may replicate data but never becomes a prerequisite for opening the local vault.

## Package graph

```text
@lena/core
  |
  +-- @lena/vault
  |     +-- @lena/op-sqlite
  |     +-- @lena/expo-sqlite
  |
  +-- @lena/backup
  |     +-- @lena/manual-backup
  |     +-- @lena/icloud
  |     +-- @lena/google-drive
  |
  +-- @lena/search
  +-- @lena/ai
  +-- @lena/storekit
  +-- @lena/gps
  +-- @lena/sync       design-only
```

`@lena/core` contains domain-neutral primitives only. Packages may depend downward in this graph. Application code depends on public packages; Lena never imports application code.

## Canonical versus derived data

Canonical data includes application records, relationships, canonical attachments, vault metadata, and durable recovery obligations. It is encrypted and backed up.

Derived data includes FTS indexes, embeddings, cached rankings, generated summaries, temporary previews, and model files. It is versioned against canonical source data and may be deleted or rebuilt without losing user work.

## Vault lifecycle

```text
create -> initialize -> ready -> close
                         |
                         +-> snapshot
                         +-> migrate beside active vault
                         +-> restore into staging

staging -> validate -> select active pointer -> reopen -> verify
                 failure -> preserve old pointer and staging evidence
```

The non-sensitive registry stores only the minimum required to locate encrypted vault files. It never contains travel records, journal content, provider tokens, StoreKit identifiers, or encryption keys.

`vault_id` identifies one logical user vault. `vault_instance_id` identifies one physical active,
staging, migrated, or restored copy. The registry selects an exact physical instance, so staging
and rollback never alias the currently active file.

A persisted selected pointer is only a reopen hint. It does not grant runtime authority after a
process restart. Validation, activation, retirement, backup coverage, remote verification, and
destructive cleanup use module-local opaque evidence that cannot survive JSON, object spread, or
another physical copy of the package. A consuming application must load one physical copy of each
authority-owning Lena module and must revalidate persisted claims at the real native boundary.

## Mutation and recovery obligation

A native database implementation must commit a meaningful application mutation and its `backup_outbox` obligation in one SQLite transaction. The application may report the mutation as saved after local commit. Remote upload remains eventual and visible when pending.

This is the precise meaning of automatic backup: durable obligation, local recovery generation at the next safe checkpoint, and persistent retry at future runtime opportunities. It does not claim background execution while the operating system suspends the app.

An obligation may be satisfied only by opaque coverage evidence bound to the exact logical vault,
physical instance, mutation, obligation, backup attempt, verified generation, and covered commit
time. Persisted coverage claims must be verified again after restart before they regain authority.

## Backup generation

```text
canonical snapshot
    -> serialize
    -> place the manifest inside authenticated plaintext
    -> encrypt and authenticate the payload plus manifest
    -> write unique temporary object
    -> flush
    -> validate local envelope, manifest, and encrypted object digest
    -> atomically publish immutable generation
    -> upload exact ciphertext object
    -> verify exact remote object bytes
```

The manifest's content checksum covers the canonical decrypted application payload. A separate
object checksum covers the final encrypted `.lena` bytes and is stored outside the object to avoid
a self-hash cycle. Providers receive only opaque ciphertext, an opaque object identifier, byte
length, and encrypted-object digest. They never receive the manifest as metadata.

Upload completion and backup verification are different facts. Remote verification is scoped to
the exact provider, provider object identifier, generation, logical vault, byte length, checksum,
and active upload claim. Provider indexes are acceleration data and never the only recovery record.

Persisted verification records are claims, not capabilities. Runtime verification evidence is
minted only after hashing the exact local or remote ciphertext at its adapter boundary. Retention,
manual export, restore activation, conflict reconciliation, and deletion reject parsed, copied,
forged, stale, cross-provider, and cross-generation evidence.

## Restore

```text
discover without mutation
    -> select explicitly
    -> download/copy to staging
    -> decrypt and authenticate
    -> validate manifest and limits
    -> build staging vault and attachments
    -> integrity and application checks
    -> close active vault
    -> atomically switch registry pointer
    -> reopen and verify
    -> roll back pointer on any failure
```

The prior vault and source generation remain available after success until a later approved retention decision.

## Database implementations

Jetseen targets OP-SQLite plus SQLCipher only if its signed-device performance and recovery evidence beats Expo SQLite materially. Becoming remains on Expo SQLite unless its explicit managed-Expo native-dependency policy changes. The current packages expose capability/readiness contracts with `runtimeReady: false`; no native database implementation is claimed yet. Both targets must expose the same Lena lifecycle and transactional obligations.

SQLCipher provides whole-database encryption. FTS5 and `sqlite-vec` remain inside the same encrypted database where supported. Database keys are applied before schema inspection, migration, or query execution.

## Search and AI

FTS5 provides lexical retrieval. `sqlite-vec` provides nearest-neighbour retrieval over derived embeddings. Lena fuses normalized result lists deterministically. An index identity includes its canonical source projection, schema, tokenizer, embedding model, and dimensions.

Every search rebuild carries a unique `rebuild_id`. Batches, completion, failure, resume, and
discard events must match the active attempt, so late work from a prior rebuild cannot mutate the
current index state.

Local AI is optional. Model absence, eviction, download failure, unsupported hardware, or inference failure cannot prevent canonical CRUD, backup, restore, export, or lexical search.
Every model installation carries an `install_id`; stale download, verification, retry, eviction,
and discard events from an older attempt are rejected.

## StoreKit

StoreKit integration accepts only bridge-created, verified exact-product facts and adapter-issued
runtime-opaque events from an allowlisted catalog. Snapshot completeness, live updates, unavailable
states, sequence advancement, and reduced catalog state cannot be reconstructed through public
objects, JSON, or object spread. Adapter sequence establishes a monotonic causal order.
Subscription facts carry a validated expiration and are evaluated as of a supplied time; lifetime
and subscription facts affect only their own products. StoreKit produces paid-feature authority and
nothing else. No StoreKit package imports a destructive vault operation. Explicit Restore
Purchases is a payment action, never data restore.

## GPS

The native collection boundary receives coordinates and resolves them locally against an audited country dataset. Only a country observation without latitude or longitude crosses into the persistable reducer. A transition creates a review proposal; the application decides whether it becomes canonical.

Coordinate samples, boundary datasets, resolutions, and persistable observations are runtime
opaque values. Resolution is bound to the exact sample and dataset used, and serialized or
structurally forged observations cannot enter transition reduction.

## Hosted Sync

`@lena/sync` exposes design contracts and a disabled capability in the Private Vault milestone. It does not ship a backend, network client, database table migration, or silent upload path. Runtime implementation requires a separate owner decision.
Consent requests maintain a monotonic high-water mark and reject older replacement requests or a
reused request identifier with different content. These contracts do not weaken the hard-disabled
runtime capability.
