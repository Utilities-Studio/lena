# Plan 06: `@lena/icloud` and `@lena/google-drive`

## Outcome

Narrow transports that store and retrieve exact encrypted backup objects while `@lena/backup` retains all policy authority.

## Shared transport operations

- Upload one immutable local file to one exact remote object path.
- Download one exact remote object into a staging path.
- List and inspect exact generation metadata.
- Delete one exact object only after backup-core produces an approved cleanup plan.
- Surface normalized retryable, authentication, quota, not-found, conflict, and fatal failures.
- Reconcile an immutable-name conflict only when provider metadata proves the exact encrypted
  object already committed before process termination.
- Keep authenticated manifests out of provider metadata.
- Require exact runtime local verification before upload and exact runtime remote verification before
  reconciliation or deletion.
- Bind resumable checkpoints to the upload claim, provider, vault, generation, local URI, remote
  path, checksum, and byte length.

## iCloud

- Target hidden app storage for automatic generations and user-visible Files export only through an explicit action.
- Treat ubiquitous placeholders as unavailable until materialized locally.
- Provider availability checks are advisory; actual operations are authoritative.

## Google Drive

- Use `appDataFolder` with the narrow `drive.appdata` scope for automatic generations.
- Google authorization is backup-provider identity, never Jetseen or Lena login.
- Handle duplicate names by immutable generation identity and exact provider object id.
- Access-token acquisition and refresh remain application/provider-auth responsibilities.

## Candidate dependency

`react-native-cloud-storage` is the first transport spike. `react-native-cloud-sync` remains a second experimental bake-off because its sync policy must not override Lena's immutable backup protocol.

## Tests

- Pure request/result state machines and error normalization.
- Pagination, duplicate names, stale indexes, resumed uploads, token expiry, quota, account change, and retry persistence.
- Process death after provider commit and exact-object conflict reconciliation.
- A failed list or metadata call creates no generation and deletes nothing.
- Parsed receipts, forged evidence, copied capabilities, stale claims, cross-provider objects,
  wrong paths, wrong digests, and replayed delete plans are rejected.

## Native gate

Exact dependency approval, source audit, custom development build, and signed-device 5 MB, 50 MB, and 250 MB interruption tests are required before runtime-complete status.
