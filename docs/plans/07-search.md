# Plan 07: `@lena/search`

## Outcome

Local lexical, semantic, and hybrid retrieval whose indexes are always rebuildable from canonical encrypted data.

## Public surface

- Safe FTS5 query construction for terms, phrases, prefixes, and filters.
- Deterministic FTS result normalization.
- Vector metadata and embedding-dimension validation.
- Reciprocal-rank-fusion hybrid ranking.
- Bounded SQL query plans that ask FTS5 and `sqlite-vec` for top candidates before JavaScript
  fusion, never whole-index materialization.
- Index identity derived from schema, source projection, tokenizer, and model version.
- Rebuild state machine with resumable checkpoints.

## Invariants

- Search indexes never become canonical user data.
- A failed or incompatible index is discarded and rebuilt, not restored as authority.
- User query text is data, never raw SQL.
- Deleted canonical content is removed from both lexical and vector indexes.
- Backup may omit derived indexes.
- Every rebuild event is bound to the active `rebuild_id`; late work from an older attempt is rejected.

## Tests

- FTS escaping and operator-injection cases.
- Unicode, punctuation, whitespace, empty, phrase, and prefix queries.
- Hybrid ranking determinism, ties, missing modalities, and weight bounds.
- Vector dimension, finite-number, and model-version checks.
- Interrupted rebuild and canonical deletion.
- Stale batch, completion, failure, resume, and discard events from a previous rebuild.

## Native gate

Real FTS5 and `sqlite-vec` queries on both supported engines, then signed-device latency and memory benchmarks on realistic data volumes.
