<h1 style="color:#ff0000;font-size:96px;font-weight:900;letter-spacing:0.04em;text-transform:uppercase;margin:0">ABSOLUTE PROHIBITION</h1>

<p style="color:#ff0000;font-size:42px;font-weight:900;margin:0.25em 0 0.75em">NO DEPLOY. NO DATABASE. NO MIGRATION. NO CLOUDFLARE. NEVER.</p>

**PERMANENT. DO NOT DELETE, WEAKEN, MOVE BELOW OTHER RULES, OR REVERT THIS BLOCK** when updating this file or any generated agent instruction.

Agents never run deployment, server, database, migration, Cloudflare, AWS, EAS, Expo publish/update, App Store, or Google Play commands. The user alone runs those. Agents write local files, print owner-run commands when needed, and wait for supplied evidence.

# Lena agent instructions

Lena is reusable local-first infrastructure for Utilities Studio applications. It is not an application and it never owns product-domain data or product decisions.

Read before material work:

1. `README.md`
2. `docs/ARCHITECTURE.md`
3. `docs/SECURITY_MODEL.md`
4. `docs/TEST_STRATEGY.md`
5. `docs/plans/README.md`
6. the directly relevant subsystem plan

## Locked product contract

- Private Vault ships first.
- Hosted Sync stays design-only until a separately approved milestone.
- The encrypted local vault is authoritative.
- Payment identity, local `vault_id`, backup-provider identity, and hosted identity are independent.
- Payment, auth, provider, search, sync, and AI failures never delete, hide, select, encrypt, or restore a vault.
- Backups are immutable encrypted generations.
- Restore validates in staging before changing the active-vault pointer.
- Raw GPS coordinates remain transient and never enter persistent records, backups, exports, logs, analytics, diagnostics, or documentation.
- Canonical data must remain usable without Lena-hosted infrastructure.

## Execution boundaries

- Never read, search, print, edit, create, or load `.env*` or `.dev.vars`.
- Never run Git unless the current user message explicitly requests the exact Git action.
- Never start a server, simulator, emulator, Metro, browser, or long-running process.
- Never add, remove, upgrade, or downgrade an external dependency or lockfile without exact current-turn approval.
- Never hand-edit generated files.
- Preserve user-owned changes.
- Use Bun for this repository unless an existing package requires otherwise.
- Use `oxfmt`, type-aware `oxlint`, and `lefthook` when their exact dependency/tooling setup is approved. Do not introduce Prettier, ESLint, or Husky.

## Code rules

- TypeScript is strict. Public inputs are validated at runtime when they cross storage, provider, native, import, or restore boundaries.
- Prefer named exports and lowercase kebab-case filenames.
- No default React import or `import * as React`.
- Production functions never accept dependency bags containing module-owned or globally importable functions. Import canonical functions directly.
- A real database connection, native handle, cryptographic key, file handle, or caller-selected strategy may cross a boundary only because it is a runtime resource, not for test injection.
- Tests exercise public boundaries or mock the owning module.
- Domain-neutral packages never import Jetseen or Becoming code.
- Transport packages never choose backup policy or mutate the active vault.
- Derived search and AI state never becomes the only copy of user data.

## Mandatory library-first standard

Before writing a generic parser, validator, result type, collection helper, date calculation,
reducer dispatcher, database mapper, property generator, or geospatial algorithm, use the approved
library that owns that capability. A custom implementation is allowed only when the directly
relevant installed API was inspected and the exact missing contract is recorded in code or the
owning architecture document. Never wrap a dependency merely to rename its API, reproduce its
types, pass it through a dependency bag, or create a test seam.

Existing handwritten generic machinery is active migration work. When a package is touched, replace
overlapping handwritten machinery with the canonical dependency in the same slice. Preserve only
Lena-specific security, lifecycle, privacy, failure, and authority policy that the dependency does
not own. Never keep parallel old and new implementations.

### Portable runtime dependencies

- **Zod is the baseline for every structural boundary.** Use `zod` for persisted records, manifests,
  provider/native DTOs, database row shapes, configuration, events, and local-AI structured output.
  Export schemas with their inferred `z.input`, `z.output`, or `z.infer` types instead of duplicating
  interfaces. Prefer strict objects, discriminated unions, versioned schemas, explicit migrations,
  codecs for wire/runtime transformations, and `z.toJSONSchema` when a schema artifact is needed.
  Do not use `z.any`, permissive passthrough, coercion, `.catch()`, or silent defaults on vault,
  payment, backup, restore, encryption, or destructive-operation data. Convert validation failure to
  a code-owned `LenaError`; never expose raw `ZodError` input or paths in diagnostics. A successful
  parse validates a claim. It never recreates runtime authority or mints WeakSet/WeakMap evidence.
- **neverthrow is the only Result implementation.** Import or re-export its `Result`, `ResultAsync`,
  `ok`, `err`, and combinators directly. Do not create a handwritten result union, mirrored wrapper,
  boolean success envelope, or duplicate map/flat-map helpers. Use Result for expected boundary and
  provider failures; reserve thrown exceptions for programmer defects and impossible states.
- **es-toolkit owns generic collection and object transforms.** Use named tree-shakeable utilities
  for grouping, deduplication, chunking, sorting, picking, omitting, and related mechanics. Do not add
  Lodash or Remeda. Equality and cloning never replace capability identity, cryptographic checks, or
  database constraints.
- **date-fns owns portable date and UTC-instant arithmetic.** Lena core stores canonical UTC
  instants. `@date-fns/tz` and jurisdiction/calendar-zone decisions stay in consuming applications,
  where the required Hermes Intl polyfills must load first. Never use ad hoc milliseconds-per-day
  arithmetic or an implicit device timezone for residency behavior.
- **ts-pattern owns complex discriminated-union reducers.** Use exhaustive matching for vault,
  backup, restore, provider, StoreKit, GPS, search, AI, and sync state machines when more than a
  simple branch exists. Parse external events with Zod first. Keep ordinary conditionals for simple
  predicates.
- **Drizzle owns typed SQLite schema mappings and ordinary adapter queries.** Keep one canonical
  `drizzle-orm` schema in `@lena/vault` so both SQLite adapters consume identical table and index
  definitions. Derive Zod row/insert/update contracts from that mapping. Adapter packages use
  Drizzle for ordinary queries only when their native runtimes exist.
  Direct SQL remains appropriate for SQLCipher key-before-inspection, PRAGMAs, FTS5, `sqlite-vec`,
  integrity checks, exact recovery transactions, and constraints or migration behavior Drizzle
  cannot represent safely. Agents never run Drizzle, database, or migration commands.
- **Modular Turf owns geospatial primitives.** Use only the approved `@turf/*` modules and never the
  `@turf/turf` umbrella. Lena still owns input limits, antimeridian normalization, overlap priority,
  runtime opacity, privacy minimization, and review-first transition policy. Coordinates never cross
  into persistent types.

### Native, application, and development boundaries

- Expo Crypto owns secure randomness and Expo persistent UUID creation. SecureStore owns only small
  device-bound secrets. FileSystem owns staged/file operations. Native modules belong in explicit
  adapter packages or as host-compatible peer dependencies, never in `@lena/core`.
- React Hook Form plus `@hookform/resolvers/zod` owns consuming-application form state. TanStack
  Query owns consuming-application remote async UI state only. Neither belongs in Lena portable
  packages or becomes storage, backup, payment, or sync authority.
- `fast-check` is mandatory for generative invariant coverage of codecs, schemas, reducers, replay,
  ordering, time, GPS geometry, FTS input, retention, and restore safety. Keep explicit adversarial
  regression tests as well.
- Knip audits unused dependencies, files, and exports. Publint and Are the Types Wrong validate only
  built, packed publishable artifacts. Changesets is release metadata tooling only. None of these
  tools deploys, publishes, runs Git, mutates a database, or becomes an automatic check until its
  exact configuration and workflow receive separate approval.
- `usehooks-ts` is prohibited because Lena targets React Native and portable non-browser packages.
- Every package declares only the dependencies it imports. Never place every approved dependency in
  `@lena/core`, and never make a consuming application install an unrelated native peer.

## Evidence

- TypeScript tests do not prove native, provider, signed-device, StoreKit, SQLCipher, background execution, or release behavior.
- Every status claim names its evidence boundary.
- Native packages stay marked unproven until owner-run signed-device acceptance evidence exists.
- Run the local `check` script before calling repository-only work complete. If a tool or dependency is unavailable, name the exact gap.
