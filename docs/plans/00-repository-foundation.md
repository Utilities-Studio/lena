# Plan 00: Repository foundation

## Outcome

A strict Bun and TypeScript monorepo whose packages can be tested independently and consumed from sibling applications without publishing.

## Deliverables

- Root workspace manifest and strict TypeScript configuration.
- One package directory per public `@lena/*` module.
- Named source exports and package export maps.
- Repository policy, architecture, security, testing, and status documents.
- Formatting, linting, typechecking, and test commands.
- Approved package-scoped portable dependencies for validation, Result composition, transforms,
  date arithmetic, exhaustive state matching, typed SQLite mappings, and modular geometry.
- Root property-testing and static package-audit tools with publication tools held behind their
  artifact and release-decision gates.

## Acceptance

- All source packages resolve through the root TypeScript path map.
- A single check command formats-checks, lints, typechecks, and runs unit tests.
- Package manifests contain no accidental publish or deployment script.
- Hosted Sync is visibly excluded from the Private Vault runtime.
- Repository status distinguishes implemented contracts from native proof.
- Portable dependencies never imply a native driver, provider bridge, device proof, application
  adoption, publishing, deployment, or database execution.
