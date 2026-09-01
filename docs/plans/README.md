# Lena implementation plans

This directory owns the executable plan for every Lena subsystem.

The plans are ordered by dependency, not product importance:

1. [Repository foundation](./00-repository-foundation.md)
2. [Core](./01-core.md)
3. [Vault](./02-vault.md)
4. [Database engines](./03-database-engines.md)
5. [Backup and restore](./04-backup-restore.md)
6. [Manual backup](./05-manual-backup.md)
7. [iCloud and Google Drive](./06-cloud-transports.md)
8. [Search](./07-search.md)
9. [Local AI](./08-local-ai.md)
10. [StoreKit](./09-storekit.md)
11. [GPS](./10-gps.md)
12. [Hosted Sync](./11-hosted-sync.md)
13. [Application adoption](./12-application-adoption.md)

Each plan separates repository-complete evidence from native, signed-device, provider, store, and release evidence. No native integration is called complete from TypeScript tests alone.

## Execution rule

A phase may expose stable pure contracts before its native implementation exists. In that case its status is `contract complete`, not `runtime complete`.
