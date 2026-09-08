# Lena foundation correction

## Objective

Replace the current protocol-heavy prototype with a reproducible, library-first implementation while preserving every approved feature and the Private Vault ownership model.

## Active slices

- Hermetic tooling, package artifacts, and consumer proof.
- Executable vault, migration, backup, and restore authority.
- Shared provider transport and narrow platform adapters.
- StoreKit, GPS, search, and local-AI library ownership.
- Evidence-backed documentation and status.

## Boundaries

- No deployment, database, migration, server, Cloudflare, AWS, EAS, Expo publish, store, browser, simulator, or Git commands.
- Native and signed-device evidence remains owner-run.
- Dependency changes are approved by the owner in the 2026-09-02 session.

## Verification ledger

- Direct Delivery skill: `/Users/harryy/.codex/plugins/cache/plugins-cli/direct-delivery/0.1.0+codex.20260719062910/skills/direct-delivery/SKILL.md`, mtime `1784493501`, size `10254`.
- Current source audit found non-hermetic tooling, disconnected migration and backup authority, duplicated schemas and transports, and overstated completion claims.

## Implemented

- Replaced the root `tsc` build with one pinned `tsdown` workspace artifact path. Every package now
  exports built ESM and declarations from `dist`; ATTW and Publint run during the build.
- Added type-aware and type-checking Oxc, Oxfmt, Knip, Lefthook configuration, and a scripts-disabled
  frozen CI install. Lefthook was not installed or executed.
- Made Drizzle the one vault schema owner and derived strict database row schemas with
  `drizzle-zod`.
- Added exact v2 to v3 Lena migration source, commit watermarks, the durable backup outbox, verified
  generation ledger, adapter-owned exclusive mutation transactions, and atomic backup completion.
- Removed the duplicate raw vault schema and the process-local backup-completion token path.
- Added canonical RFC 8785 manifest bytes, Flatbush candidate indexing, bounded SQLite FTS5 and
  sqlite-vec plans, compare-versions model compatibility, an `expo-iap` StoreKit service, and
  read-only `react-native-cloud-storage` provider seams.
- StoreKit refresh and purchase updates now fail closed. Pending, unknown, revoked, upgraded, and
  unverified updates never finish or grant; a verified purchase finishes once and rechecks current
  entitlement.
- Proved built core, vault, and backup imports in a clean Bun consumer using exact file overrides.
  This remains a pre-publish workaround and does not prove Metro or native integration.

## Current evidence

- `bun install --ignore-scripts`: passed and refreshed the lockfile without lifecycle scripts.
- `bun run check`: passed on 2026-09-02.
- Oxfmt: 149 files.
- tsdown: 13 ESM/declaration package builds; ATTW and Publint reported no problems.
- Oxc: type-aware lint and TypeScript type checking passed.
- Tests: 236 passed, 0 failed, 4,265 assertions across 35 files.
- Knip: passed with no findings.
- No native, device, database, migration, deployment, server, browser, Git, or release command ran.

## Open runtime boundaries

- No native SQLite/SQLCipher, backup crypto/filesystem, immutable cloud write/delete, or local-model
  runtime exists.
- Provider plan and vault-registry process-local guards cannot support runtime-ready claims. The
  acting native services must recheck the durable ledger and own their real resources.
- Legacy StoreKit reducers are cached projections only; the `expo-iap` service is the paid-access
  boundary.
- Jetseen and Becoming do not consume Lena yet.
