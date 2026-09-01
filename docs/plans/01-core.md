# Plan 01: `@lena/core`

## Outcome

Portable, native-runtime-free identifiers, errors, results, compatibility rules, and validation
primitives shared by every package.

## Public surface

- Branded `VaultId`, `GenerationId`, `MutationId`, `EffectId`, and model/index identifiers.
- Strict Zod schemas and parsers for random UUID-shaped identifiers and ISO timestamps, with
  schema-inferred public types.
- Structured Lena error codes with safe diagnostic metadata.
- neverthrow `Result`, `ResultAsync`, `ok`, `err`, and combinators for expected boundary failures.
- Schema compatibility comparison.
- Assertions for unreachable state and privacy-safe diagnostics.
- es-toolkit collection/object transforms and date-fns UTC-instant arithmetic where generic
  mechanics are required.

## Invariants

- Identity types are not interchangeable.
- Errors never require raw payloads, coordinates, tokens, keys, or user content.
- Parsers reject implicit coercion.
- Time comparison is deterministic and timezone-independent.

## Tests

- Valid and invalid identifier parsing.
- Identity non-equivalence at compile time.
- Timestamp normalization and invalid date rejection.
- Compatibility boundaries.
- Error serialization excludes causes and unsafe values by default.

## Completion gate

Pure TypeScript implementation, strict typecheck, unit and fast-check property tests, and stable
exports pass without React, Expo, a native module, database engine, provider SDK, or application
schema.
