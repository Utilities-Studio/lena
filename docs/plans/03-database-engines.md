# Plan 03: Database engines

## Outcome

`@lena/op-sqlite` and `@lena/expo-sqlite` implement the same vault contract over SQLCipher-capable SQLite engines.

## Shared contract

- Open an explicitly identified vault with a runtime key resource.
- Apply the key before schema inspection, migration, or query execution.
- Enable foreign keys and WAL where supported and safe.
- Execute exclusive transactional mutations.
- Create consistent snapshots without mutating the active database.
- Run integrity and foreign-key checks.
- Close deterministically before pointer swaps.
- Define one typed SQLite mapping with Drizzle in `@lena/vault`; both adapters consume it and derive
  strict Zod row and write contracts rather than duplicating database shapes.
- Keep direct SQL for SQLCipher key-before-inspection, PRAGMAs, FTS5, `sqlite-vec`, integrity
  checks, exact recovery transactions, and constraints or migration behavior Drizzle cannot
  represent safely.

## `@lena/op-sqlite`

- Target for Jetseen after signed-device benchmark and recovery gates.
- Proposed external dependency: `@op-engineering/op-sqlite` with SQLCipher enabled.
- No libSQL/Turso mode in Private Vault because remote coupling and SQLCipher capability conflict with the target.

## `@lena/expo-sqlite`

- Compatibility target for Becoming and Expo-managed applications.
- Proposed external dependency: `expo-sqlite` with SQLCipher configuration.
- Must prove key-before-migration behavior and bundled schema upgrades.

## Acceptance

- Identical contract tests run against both real engines.
- Real SQLite migration fixtures cover every supported schema.
- Wrong key and missing key fail closed without creating a replacement database.
- Snapshot plus concurrent mutation cannot produce a partially committed generation.
- OP-SQLite becomes the default only after at least 25 percent p95 improvement or materially lower JS-thread blocking with no recovery/build regression.

## Approval boundary

`drizzle-orm` and Zod are approved mapping dependencies, not native engines. Native implementation
does not begin until the exact OP-SQLite and Expo SQLite packages, versions, SQLCipher
configuration, and host compatibility are approved. Adding a peer dependency remains a separate
dependency decision. Agents never execute database or migration commands.
