# Plan 09: `@lena/storekit`

## Outcome

StoreKit 2 authority for an exact lifetime and subscription catalog that controls paid features but
has no data-ownership capability.

## Public surface

- An `expo-iap@5.4.1` StoreKit 2 service that queries an exact allowlisted product and checks local
  StoreKit transaction verification before reducing paid access.
- Strict schema-inferred transaction, complete-snapshot, unavailable-event, and catalog-state data.
- Exact allowlisted entitlement catalog for non-consumable lifetime and auto-renewable subscription products.
- Monotonic adapter sequence for launch snapshots, transaction updates, unavailable states,
  restore, refund, revocation, expiration, and account change.
- Catalog-bound pure entitlement reducer with explicit as-of evaluation.
- Explicit purchase and restore operation states.
- Startup cache metadata that never acts as stronger proof than verified StoreKit state.

## Invariants

- Accept only verified transactions for exact configured product identifiers.
- A terminal annual-subscription fact cannot revoke a separately active lifetime product.
- An older launch snapshot cannot erase a newer transaction fact.
- Auto-renewable access ends at its verified expiration even without a new terminal event.
- Parsed facts and cached state never grant access by themselves; the acting StoreKit service
  refreshes current entitlement and local StoreKit verification.
- Caller-supplied sequence or snapshot completeness cannot bypass that StoreKit recheck.
- Store-returned localized price display is never entitlement authority.
- Call platform sync only from explicit Restore Purchases.
- Pending, cancelled, failed, refunded, revoked, or unavailable payment states never mutate vault, backup, export, or restore state.
- App Store identity is never used as `vault_id` or hosted identity.
- No receipt, transaction identifier, or purchaser data enters Lena diagnostics by default.

## Tests

- Verified exact product, wrong product, unverified, pending, cancelled, refunded, revoked, and duplicate events.
- Annual active/expired plus lifetime active combinations and out-of-order cross-product events.
- Deterministic ordering of launch entitlements and live updates under monotonic sequence.
- Stale snapshot, sequence collision, catalog replacement, malformed/serialized facts, and offline
  expiration.
- Active lifetime, later revoke, and attempted stale-fact resurrection through a caller-minted
  newer snapshot or copied reducer state.
- Offline startup cache degradation without data hiding.
- Restore found and restore empty.
- Static package-boundary test proving no vault destructive import.

## Native gate

Host native configuration plus sandbox/TestFlight purchase, cancel, pending, relaunch, reinstall,
explicit restore, refund/revocation, and App Store account-change evidence.
