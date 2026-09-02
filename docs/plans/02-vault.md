# Plan 02: `@lena/vault`

## Outcome

A database-engine-neutral lifecycle for encrypted vault metadata, active-vault selection, migration compatibility, and durable recovery obligations.

## Public surface

- Vault metadata creation and validation.
- Non-sensitive vault-registry records.
- Explicit active-vault selection state machine.
- One executable, consecutive migration registry from every declared restorable schema to the
  current target.
- Mutation receipt and backup-obligation records.
- Monotonic commit sequence and verified-generation watermark records.
- Processed-effect idempotency records.
- Required Lena-owned table definitions for database adapters.

## Invariants

- `vault_id` is random and never derived from email, payment, provider, hosted identity, or filesystem path.
- `schemaVersion` is the host application's unified vault version. Its source registry composes
  domain changes with required Lena table changes; Lena never claims to migrate unknown app tables.
- Active selection changes only through explicit registry operations.
- A meaningful domain mutation, commit sequence, and backup obligation share one database
  transaction in native implementations.
- Restore creates and validates a new vault before selection changes.
- Payment, provider, StoreKit, and sync packages receive no destructive vault API.
- A persisted selection is a reopen hint, not runtime-active authority.
- Ready, active, and retired transitions require exact one-shot runtime evidence.
- A recovery obligation is satisfied only inside a transaction that finds a verified generation
  covering its exact commit sequence and rechecks the active claim.

## Tests

- Metadata validation and incompatible schema rejection.
- Registry selection, missing vault, duplicate vault, and disabled vault behavior.
- Backup obligation lifecycle, monotonic commit sequencing, verified-watermark coverage, and
  idempotency.
- Migration ordering, execution, rollback ownership, gaps, duplicates, and downgrade rejection.
- No account/payment/provider identity field appears in canonical types.
- Forged, spread, serialized, replayed, cross-vault, wrong-instance, restart, and chronology cases.
- Failed transition preconditions do not consume otherwise valid evidence.

## Native gate

Runtime completion additionally requires real SQLCipher transaction, rollback, wrong-key, disk-full, interruption, and reopen evidence. Pure tests alone produce `contract complete` status.
