# Plan 00: Repository foundation

## Outcome

A strict Bun and TypeScript monorepo whose packages can be tested independently, consumed from
sibling applications before publication, and released through one guarded npm workflow.

## Deliverables

- Root workspace manifest and strict TypeScript configuration.
- One package directory per public `@lena-inc/*` module.
- Named source exports and package export maps.
- Repository policy, architecture, security, testing, and status documents.
- Pinned Oxfmt, type-aware/type-checking Oxc, tsdown, declaration, artifact, test, and Knip gates.
- Approved package-scoped portable dependencies for validation, Result composition, transforms,
  date arithmetic, exhaustive state matching, typed SQLite mappings, and modular geometry.
- Root property-testing and static package-audit tools with Publint and Are the Types Wrong running
  against each built artifact.
- Public package metadata, Lerna-Lite versioning, owner-run bootstrap instructions, and a protected
  tokenless npm trusted-publishing workflow.

## Acceptance

- All source packages resolve through the root TypeScript path map and every consumer export points
  to generated `dist` JavaScript and declarations.
- A single check command format-checks, builds, validates artifacts, runs type-aware/type-checking
  lint, runs unit/property tests, and audits unused code.
- Package manifests contain no package-local publish or deployment script. The private root owns one
  explicit Lerna-Lite publication command, consumed by Infra's shared workflow without overrides.
- Hosted Sync is visibly excluded from the Private Vault runtime.
- Repository status distinguishes implemented contracts from native proof.
- Portable dependencies and configured publishing never imply a native driver, provider bridge,
  device proof, application adoption, completed publication, deployment, or database execution.
