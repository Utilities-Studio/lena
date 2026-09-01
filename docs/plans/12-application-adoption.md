# Plan 12: Application adoption

## Outcome

Jetseen and Becoming consume stable Lena packages through reversible, evidence-gated vertical slices.

## Jetseen order

1. Add contract-only packages without changing runtime authority.
2. Characterize current SQLCipher, backup, StoreKit, and GPS behavior with fixtures.
3. Introduce the vault registry and new Private Vault beside the existing database.
4. Produce a verified pre-migration generation.
5. Copy, validate, and atomically select the new vault while preserving rollback.
6. Adopt backup core and manual backup.
7. Prove cloud transports on signed devices.
8. Cut payment to StoreKit-only authority without touching data access/recovery.
9. Adopt GPS reducer and offline resolver.
10. Remove legacy account/server paths only after complete migration evidence.

## Becoming order

1. Adopt core and vault contracts.
2. Use Expo SQLite implementation until native dependency policy changes.
3. Add backup and manual export before local AI.
4. Add search, then embeddings as rebuildable derived data.
5. Add cloud transports only after provider acceptance evidence.

## Invariants

- No big-bang destructive migration.
- Existing data stays in place until a new vault and recovery generation validate.
- Application schemas and product rules remain application-owned.
- Local file dependencies are temporary development wiring, not publishing proof.
- Each consuming repository must explicitly approve dependencies and lockfile changes.

## Completion gate

Adoption is complete only after consuming-repository tests, realistic upgrade fixtures, signed-device recovery scenarios, and application documentation match live behavior.
