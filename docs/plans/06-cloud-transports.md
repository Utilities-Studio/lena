# Plan 06: `@lena/icloud` and `@lena/google-drive`

## Outcome

Narrow transports that store and retrieve exact encrypted backup objects while `@lena/backup` retains all policy authority.

## Shared transport operations

- Upload one immutable local file to one exact remote object path.
- Download one exact remote object into a staging path.
- List and inspect exact generation metadata.
- Delete one exact object only inside a runtime service that rechecks the current retention ledger;
  a parsed cleanup plan alone never authorizes I/O.
- Surface normalized retryable, authentication, quota, not-found, conflict, and fatal failures.
- Reconcile an immutable-name conflict only when provider metadata proves the exact encrypted
  object already committed before process termination.
- Keep authenticated manifests out of provider metadata.
- Require exact runtime local verification before upload and exact runtime remote verification plus
  a current ledger check before reconciliation or deletion.
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

## Approved bridge

`react-native-cloud-storage@3.1.0` is the host peer for iCloud and Google Drive file operations.
Its mutable write/delete API stays behind Lena's immutable path, verification, and retention rules.
`react-native-cloud-sync` remains a later experimental bake-off because its sync policy must not
override Lena's immutable backup protocol.

## Tests

- Pure request/result state machines and error normalization.
- Pagination, duplicate names, stale indexes, resumed uploads, token expiry, quota, account change, and retry persistence.
- Process death after provider commit and exact-object conflict reconciliation.
- A failed list or metadata call creates no generation and deletes nothing.
- Malformed receipts, stale claims, cross-provider objects, wrong paths, wrong digests, and replayed
  delete plans cannot bypass the runtime ledger recheck.

## Native gate

Exact dependency approval, source audit, custom development build, and signed-device 5 MB, 50 MB, and 250 MB interruption tests are required before runtime-complete status.
