# Lena decisions

## D-001: Product and package identity

Decision: use Lena and the `@lena/*` package family. The npm scope must be reserved before publication.

## D-002: Private Vault first

Decision: design both Private Vault and Hosted Sync, ship Private Vault first, and keep sync runtime disabled until a separate milestone.

## D-003: Local encrypted authority

Decision: one explicitly selected SQLCipher vault is canonical. Remote systems and indexes are secondary.

## D-004: Separate identities

Decision: payment, `vault_id`, backup provider, and hosted identity are unrelated identifiers with no implicit conversion.

## D-005: Owned backup protocol

Decision: Lena owns immutable generations, envelope/manifest validation, durable retry state, verification, retention, staging restore, and rollback. Cloud libraries are transports only.

## D-006: Database engines

Decision: support Expo SQLite and OP-SQLite behind one vault contract. Jetseen targets OP-SQLite only after it wins signed-device performance and recovery gates. Becoming stays Expo-compatible unless its native policy changes.

## D-007: No hand-written cryptography

Decision: Lena owns cryptographic protocol metadata and lifecycle, but uses audited platform/library primitives after exact dependency approval.

## D-008: Search and AI are derived

Decision: FTS5 and `sqlite-vec` provide local hybrid search. Local AI is optional. All indexes, embeddings, and summaries are rebuildable.

## D-009: StoreKit-only payment boundary

Decision: Private Vault payment authority uses an exact allowlisted StoreKit catalog. It may combine non-consumable lifetime and auto-renewable subscription products, but terminal facts affect only their own product. StoreKit facts, not localized prices or paywall copy, grant access. Payment has no vault mutation capability.

## D-010: Review-first GPS

Decision: coordinates are transient, country resolution is local, persisted observations omit coordinates, and transitions remain proposals until application approval.

## D-011: Authority is checked where the operation acts

Decision: parsed or persisted data is a claim, never standalone authorization. A destructive or
authority-changing operation validates its strict input, then rechecks the canonical ledger and
the real native/runtime resource inside the same service and transaction that acts. Module-local
WeakSet membership is not durable authority and is not used to simulate database, provider,
StoreKit, backup, restore, or payment verification. WeakMap is limited to genuine transient object
bindings and non-authorizing caches, such as binding a GPS resolution to the exact coordinate
sample that produced it. After restart, persisted claims are revalidated against their owning
runtime boundary.

## D-012: Library-first portable mechanics

Decision: use Zod for structural boundaries and schema-inferred types, neverthrow for expected
fallible composition, es-toolkit for generic collection and object transforms, date-fns for
portable date and UTC-instant arithmetic, ts-pattern for complex exhaustive reducers, Drizzle for
typed SQLite mappings and ordinary queries, modular Turf for geometric primitives, and fast-check
for generative invariant tests. Lena continues to own authority, privacy, lifecycle, interruption,
recovery, and product-neutral safety rules. A custom generic mechanism requires a documented gap in
the directly relevant library API.

## D-013: Portable, native, and application dependency boundaries

Decision: package each portable dependency only where imported. The canonical Drizzle mapping lives
in `@lena/vault` so both SQLite adapters consume one schema; it does not prove a native database
driver, SQLCipher, or migration path. React Hook Form with its Zod resolver,
TanStack Query, and `@date-fns/tz` stay in consuming applications. `usehooks-ts` is excluded from
the React Native foundation. Native SQLite, crypto, filesystem, provider, StoreKit, model, and
location bridges remain independently approved and signed-device-gated.

## D-014: Release tooling does not imply publication readiness

Decision: `tsdown` is the only package build path. Every package exports `dist` artifacts, and each
build runs Publint and Are the Types Wrong against those artifacts. Knip is configured for workspace
static analysis. Changesets configuration waits for explicit publication, versioning, registry,
and access decisions. Installing or running these tools does not authorize Git, publishing,
deployment, infrastructure, or database work.

## D-015: Maintained mechanics added at their narrow owners

Decision: `drizzle-zod` derives database row contracts from the canonical Drizzle mapping;
`canonicalize` owns RFC 8785 backup-manifest bytes; Flatbush narrows GPS polygon candidates before
modular Turf geometry; `compare-versions` owns model-version comparison; `expo-iap` is the StoreKit
2 bridge; and `react-native-cloud-storage` is the iCloud and Google Drive file bridge. Native
packages are host peer dependencies. Their source integration does not prove native configuration,
signed-device behavior, or runtime readiness.
