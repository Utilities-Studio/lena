# Lena test strategy

## Test levels

### Unit

Pure validators, reducers, selectors, parsers, planners, rankings, and deterministic state transitions. These run without native modules or a database.

### Contract

The same behavior suite runs against each implementation of a real runtime boundary, such as Expo SQLite and OP-SQLite. Contract suites assert externally visible results, not SDK call order.

Migration contract suites use the consuming application's generated Drizzle history and the real
adapter-specific `migrate()` inside a keyed test service. A handwritten planner, statement
executor, or fake transaction handle is not migration evidence.

### Integration

Real local filesystem, cryptography, SQLite, provider sandbox, native module, or StoreKit configuration. Tests use controlled test containers and never production infrastructure.

### Signed-device acceptance

Owner-run scenarios on supported iOS and Android hardware, where in scope. These prove keychain, SQLCipher, background interruption, Files/provider behavior, StoreKit, GPS, model resources, and build configuration.

## Failure injection

Failure injection occurs at real package-owned boundaries or through genuine caller-selected test strategies. Production APIs never accept a generic dependency bag for test convenience.

State-machine unit tests enumerate every durable state and event. Native integration tests terminate the process at each externally visible checkpoint and then reopen from persisted state.

Every authority-bearing operation has adversarial tests for malformed data, JSON round trips,
replay, exact-identity mismatch, cross-vault use, cross-provider use, stale attempts, timestamp
regression, restart behavior, and transaction rollback. Tests prove that structural data alone
cannot skip the canonical ledger or native/runtime recheck at the operation boundary. WeakMap
identity tests are reserved for genuine ephemeral bindings such as a GPS sample and its resolution.

Test setup never exits early. Expected Results are unwrapped, expected schemas are parsed, and a
missing state throws an assertion failure so a broken fixture cannot produce a vacuous pass.

## Required matrices

### Vault and database

- New encrypted vault.
- Existing supported schemas.
- Wrong and missing key.
- Current, older, and future backup-schema classification. Older means staging is required, not
  that compatibility is already proven.
- Missing, skipped, reordered, and failed generated migration artifacts through real adapter
  fixtures, including target-metadata and post-migration integrity failure.
- Transaction rollback and concurrent read/write.
- Disk full, interrupted write, close/reopen, and integrity failure.

### Backup and restore

- 5 MB, 50 MB, and 250 MB payloads.
- Offline, token expiry, quota, corruption, truncation, duplicate object, and account change.
- Process death at every durable stage.
- Wrong key, wrong vault, incompatible schema, insufficient space, and attachment mismatch.
- Active-vault rollback after every pointer boundary.
- Deterministic authenticated-manifest serialization and separate content/object checksum binding.
- Provider-commit interruption followed by exact immutable-object conflict reconciliation.
- Parsed verification claims cannot authorize retention, export, restore, reconciliation, or delete.
- Local and remote evidence is bound to the exact ciphertext URI, object path, digest, length,
  generation, claim, provider, vault, and attempt.
- Backup and restore lifecycle timestamps never move backward.

### Search and AI

- Unicode and hostile FTS query input.
- 10k and 100k representative records.
- Model/index upgrade, partial rebuild, deletion, and eviction.
- Unsupported device, low memory, interrupted download, thermal throttling, and repeated inference lifecycle.
- Stale events from an earlier search `rebuild_id` or model `install_id` are rejected.

### StoreKit

- Exact verified product, unverified, wrong product, pending, cancel, duplicate, refund, revocation,
  relaunch, reinstall, restore, and purchaser change.
- Out-of-order launch snapshots and live facts under a monotonic adapter sequence.
- Lifetime plus annual combinations, offline subscription expiry, catalog replacement, and
  product-type mismatch.
- Forged, spread, and serialized event/state rejection, including active, revoke, then attempted
  stale-fact resurrection through a caller-minted newer snapshot.
- Static proof that payment packages cannot import destructive vault functions.

### GPS

- Border bounce, antimeridian, polygon holes, stale/out-of-order readings, low accuracy, dwell, repeated effects, manual correction, background restart, and battery.
- Static proof that persistable types and serializers contain no coordinate fields.
- Forged, serialized, cross-sample, and cross-dataset resolution evidence is rejected.

## Verification command

The repository `check` command runs formatting verification, a `tsdown` build with declaration
generation plus Publint and Are the Types Wrong, type-aware and type-checking Oxc lint, portable
unit/property tests, and Knip. Native and signed-device evidence is tracked separately in
`docs/STATUS.md`.
