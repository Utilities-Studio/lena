# Plan 04: `@lena/backup`

## Outcome

A provider-independent protocol for immutable encrypted generations, durable upload obligations, verified discovery, staged restore, rollback, and safe retention.

## Public surface

- Versioned generation manifest parser and RFC 8785 canonical serializer.
- Canonical generation path and immutable object identity.
- Backup-attempt lifecycle reducer.
- Provider-neutral discovery and deterministic candidate ordering.
- Verification records distinct from upload completion.
- Staged-restore lifecycle reducer with explicit rollback.
- Retention planner that never deletes the only verified recovery point.
- Encryption-envelope metadata contract without a hand-written cipher.

## Invariants

- New generations never overwrite the last known-good generation.
- Inspection is read-only.
- Upload failure leaves durable pending work.
- Uploaded is not verified.
- Restore never clears or edits the active vault.
- Wrong key, corruption, incompatibility, provider failure, or insufficient disk leaves the active vault untouched.
- Cleanup requires a newer verified generation and preserves pinned generations.
- Manifests contain no email, StoreKit identity, provider token, hosted identity, raw coordinates, or user content.
- Manifests remain inside authenticated ciphertext and never become provider metadata.
- Manifest content integrity and final encrypted-object integrity use separate checksums.
- Persisted verification data and provider plans are untrusted claims, never authorization
  capabilities.
- The operation that acts rechecks the exact ciphertext, claim, provider, object, generation,
  vault, digest, length, attempt, verified watermark, and causal time at its owned runtime and
  transaction boundary.
- Backup and restore event time is monotonic.

## Crypto boundary

- Use an audited authenticated-encryption implementation such as AES-256-GCM.
- Separate the vault database key from the backup recovery key.
- Never store an unwrapped key beside ciphertext.
- Do not implement cryptographic primitives in Lena.
- Exact Expo/native crypto and secure-key dependencies require separate approval and signed-device proof.

## Tests

- State transition tables for every backup and restore stage.
- Duplicate, stale, corrupt, truncated, incompatible, wrong-vault, and wrong-key metadata.
- Process restart from every durable state.
- Candidate ordering across local, iCloud, and Drive without implicit mutation.
- Retention under daily/monthly overlap, pins, failed attempts, and a single last-known-good generation.
- Manifest limits and untrusted input rejection.
- Deterministic manifest serialization and exact round trips.
- Provider-scoped verification bound to the active claim and exact encrypted object.
- Malformed and reconstructed claims, JSON round trips, replay, stale attempts, mismatched URIs,
  cross-provider evidence, timestamp regression, transaction rollback, and restart re-verification.

## Native gate

Runtime completion requires encrypted byte round trips, no plaintext temporary artifacts, peak-memory limits, atomic file behavior, process-death injection, and fresh-device restore on signed targets.
