# Plan 11: `@lena/sync`

## Outcome

A design-only, opt-in Hosted Sync contract that cannot enter the Private Vault runtime by accident.

## Public surface

- Explicit mode and consent state machine.
- Versioned change, checkpoint, tombstone, conflict, and replica identities.
- Conflict outcome types that preserve both user-authored versions when automatic merge is unsafe.
- Capability descriptor reporting `disabled` in the initial release.

## Invariants

- Private Vault requires no hosted package at runtime.
- Purchase, previous login, app update, backup authorization, or provider identity never implies sync consent.
- Opt-in never replaces the local encrypted vault as the offline authority.
- Sign-out preserves local vaults.
- No implementation or hosted infrastructure ships without a separate owner-approved milestone.
- Consent requests maintain a monotonic high-water mark and cannot reuse an identifier with
  different content.

## Tests

- Consent cannot be inferred from unrelated identities or events.
- Disabled capability rejects upload planning.
- Deterministic checkpoint and conflict type validation.
- Static dependency check proving initial Private Vault packages do not import `@lena/sync`.
- Older replacement requests, replay, forged parsed events, and identifier-content conflicts.

## Future gate

Separate product, privacy, retention, encryption, conflict, deletion, account-switch, cross-account isolation, offline queue, schema-upgrade, and infrastructure approval is mandatory before runtime work.
