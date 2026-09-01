# Plan 05: `@lena/manual-backup`

## Outcome

A portable encrypted export and import path that works without an account or provider SDK.

## Public surface

- Stable `.lena` generation filename and media-type rules.
- Export descriptor generated from a verified backup generation.
- Import preflight for extension, size, envelope, manifest, version, and vault identity.
- Explicit distinction between encrypted Lena backup and application-owned plaintext export.

## Invariants

- Manual export never decrypts canonical data for convenience.
- Import writes only to staging.
- File picker metadata is untrusted.
- Duplicate filenames do not imply duplicate generation identity.
- Cancelling share or import changes no vault or backup state.
- Export requires runtime verification bound to the exact ciphertext URI being shared.
- Import and restore validation claims cannot be reconstructed from parsed metadata.

## Tests

- Filename normalization and traversal rejection.
- Content type and envelope mismatch.
- Maximum byte and manifest limits.
- Duplicate generation and wrong-vault behavior.
- Cancel, partial copy, and interrupted import state.
- Forged, copied, serialized, wrong-generation, and wrong-URI verification evidence.

## Native gate

Signed-device import/export round trips through iOS Files and Android document providers, including low-space and provider-placeholder behavior.
