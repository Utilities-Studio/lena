# Plan 08: `@lena/ai`

## Outcome

Optional on-device embeddings, reranking, summarization, and structured generation that never gate canonical app behavior.

## Public surface

- Model manifest validation, integrity identity, capability, and device requirements.
- Deterministic text chunking with source revision identities.
- Embedding validation and rebuildable derived-record metadata.
- Runtime eligibility and resource-budget decisions.
- Download, verify, ready, evict, and failed model lifecycle.

## Invariants

- AI is optional and offline core behavior works without a model.
- No silent cloud inference fallback.
- Model output never overwrites canonical user content without explicit application action.
- Embeddings and summaries are derived and versioned against source revisions.
- Model files are integrity checked and may be evicted without data loss.
- Every model lifecycle event is bound to the active `install_id`.

## Candidate runtimes

- React Native ExecuTorch for broad embeddings and local model capability.
- `llama.rn` when GGUF flexibility or LLM-specific features justify its larger runtime surface.
- Runtime selection follows signed-device evidence, supported OS floors, model licensing, thermal behavior, and memory limits.

## Tests

- Model manifest, hash, version, capability, and resource validation.
- Chunk stability and source-revision invalidation.
- Embedding dimension and non-finite rejection.
- Model lifecycle interruption and safe eviction.
- Explicit offline/no-model behavior.
- Stale download, verification, retry, eviction, and discard events from an earlier installation.

## Native gate

Exact dependency approval and representative-device benchmarks for cold load, first token or embedding latency, throughput, peak RSS, thermal throttling, battery, interrupted downloads, and repeated lifecycle crashes.
