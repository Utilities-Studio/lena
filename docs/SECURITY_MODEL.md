# Lena security model

## Protected assets

- Canonical application records and attachments.
- Vault database keys.
- Backup recovery keys and recovery material.
- Backup ciphertext integrity and generation history.
- Provider authorization tokens held by consuming applications.
- StoreKit verification facts.
- Location privacy.

## Trust boundaries

| Boundary                   | Trusted for                                               | Never trusted for                                             |
| -------------------------- | --------------------------------------------------------- | ------------------------------------------------------------- |
| Encrypted local vault      | Canonical data after successful open and integrity checks | Payment or provider identity                                  |
| Platform Keychain/Keystore | Device-bound key protection                               | Cross-device recovery by itself                               |
| Recovery code/key          | Decrypting compatible backup envelopes                    | Selecting a user's vault automatically                        |
| iCloud/Google Drive        | Storing ciphertext objects                                | Confidentiality, canonical ordering, or sole generation index |
| StoreKit                   | Verified entitlement for exact products                   | Vault identity or data ownership                              |
| Search/AI index            | Derived retrieval acceleration                            | Canonical content                                             |
| Future hosted service      | Explicitly consented encrypted replication                | Private Vault authority                                       |

## Threats and required controls

### Device or app-container disclosure

- Whole-database SQLCipher encryption.
- Platform key storage for active database keys.
- Authenticated encryption for managed backups and attachments.
- No plaintext managed temporary artifacts after completion.

### Lost device

- The only recovery key cannot exist solely on the lost device.
- User-controlled recovery material must unlock provider/manual generations on a fresh device.
- Provider identity and StoreKit identity remain separate from key recovery.

### Malicious or corrupt remote object

- Treat every decrypted manifest, filename, size, count, and ciphertext byte as untrusted.
- Enforce strict limits before allocation or database import.
- Authenticate the complete envelope and validate the reconstructed staging vault.
- Keep the manifest inside authenticated ciphertext. Provider metadata contains no manifest or
  canonical content metadata.
- Bind remote evidence to the exact provider, opaque object identifier, encrypted-object byte
  length, encrypted-object checksum, logical vault, generation, and active upload claim.
- Never modify the active vault on failure.

### Interrupted write or process death

- Unique temporary paths and atomic publication.
- Durable lifecycle state before external effects.
- Idempotent replay after restart.
- Preserve last-known-good pointers independently from newest attempts.

### Provider compromise or account change

- Providers receive ciphertext only.
- Tokens are not data keys.
- Account change invalidates provider session state but never local data.
- No remote deletion occurs during discovery or account transition.

### Payment failure or purchaser change

- Payment controls features only.
- Canonical data, export, backup, restore, and support remain reachable.
- The `expo-iap` service checks current exact-product entitlement and local StoreKit transaction
  verification before returning paid access.
- Parsed facts, complete snapshots, unavailable events, sequence values, and cached reducer state
  are non-authorizing data outside that service.
- Monotonic adapter sequence prevents an older launch snapshot from erasing newer live facts.
- A caller cannot resurrect an earlier purchase by wrapping a retained fact in a newer snapshot or
  by replacing fields on a copied reducer state.
- Auto-renewable access expires at its verified expiration even while offline.
- Transaction identifiers stay out of default diagnostics.

### Location leakage

- Coordinates exist only in the native callback/resolver memory scope.
- Persistable types contain country, time, coarse accuracy/confidence, detector version, and idempotency identifiers only.
- No coordinates in logs, errors, analytics, backup manifests, tests, or docs.

### Unsafe diagnostics

Default error text is owned by the Lena error code, not supplied by callers. Serialized diagnostics
use an explicit allowlist of bounded non-sensitive fields and reject content-like strings, secrets,
coordinates, provider responses, database rows, receipts, filesystem identifiers, and external SDK
stacks. Internal causes are never included by default.

### Forged authority

- Persisted records, parsed JSON, and planner output are untrusted claims, never runtime
  authorization.
- The operation that acts rechecks the canonical ledger and real native/runtime resource, bound to
  the full attempt, vault, instance, provider, object path, digest, length, and causal time.
- Reconstructed, copied, replayed, stale, or cross-boundary claims cannot skip that check.
- Failed preconditions leave the canonical state unchanged; successful authority changes commit
  their state and effect record atomically.
- Restart requires fresh ledger/native verification before persisted claims can authorize deletion,
  restore, activation, retirement, export, or recovery-obligation completion.

## Cryptographic rules

- Lena does not implement ciphers, hashes, KDFs, or random number generators.
- Use maintained platform or audited libraries.
- Backup encryption must be authenticated, versioned, and domain-separated.
- Nonces must follow the chosen library's uniqueness requirements.
- Key wrapping and recovery-code derivation require an explicit cryptographic design review.
- Algorithms and parameters are stored in versioned envelope metadata without storing secret material.
- Wrong-key and tamper failures are indistinguishable to normal UI and never trigger destructive fallback.

## Explicit non-claims

Repository tests do not prove zero knowledge, signed-device key protection, provider confidentiality, App Store behavior, operating-system background execution, or resistance to a compromised unlocked device. Those require evidence at the corresponding boundary.
