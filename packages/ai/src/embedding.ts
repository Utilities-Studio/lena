import { err, LenaError, ok, type Result } from "@lena/core";
import { sumBy } from "es-toolkit";
import { z } from "zod";
import type { TextChunk } from "./chunking";
import {
  getModelIntegrityIdentity,
  type ModelEmbeddingManifest,
  type ModelManifest,
} from "./model-manifest";

export const NORMALIZED_VECTOR_TOLERANCE = 0.001;

export interface DerivedEmbeddingRecord {
  readonly chunkIdentity: string;
  readonly dimensions: number;
  readonly embedding: readonly number[];
  readonly modelIdentity: string;
  readonly sourceId: string;
  readonly sourceRevision: string;
}

export interface CreateDerivedEmbeddingInput {
  readonly chunk: TextChunk;
  readonly embedding: unknown;
  readonly manifest: ModelManifest;
}

export function validateEmbeddingOutput(
  value: unknown,
  specification: ModelEmbeddingManifest,
): Result<readonly number[], LenaError> {
  if (!Array.isArray(value) && !(value instanceof Float32Array)) {
    return err(new LenaError("invalid_input", { boundary: "ai_embedding_output" }));
  }
  const parsedEmbedding = z.array(z.number().finite()).safeParse(Array.from(value));
  if (!parsedEmbedding.success) {
    return err(new LenaError("invalid_input", { boundary: "ai_embedding_output" }));
  }
  if (parsedEmbedding.data.length !== specification.dimensions) {
    return err(
      new LenaError("invalid_input", {
        actual: parsedEmbedding.data.length,
        expected: specification.dimensions,
      }),
    );
  }

  const embedding = parsedEmbedding.data;
  if (specification.normalized) {
    const magnitude = Math.sqrt(sumBy(embedding, (component) => component * component));
    if (!Number.isFinite(magnitude) || Math.abs(magnitude - 1) > NORMALIZED_VECTOR_TOLERANCE) {
      return err(new LenaError("integrity_failed", { boundary: "ai_embedding_output" }));
    }
  }

  return ok(Object.freeze(embedding));
}

export function createDerivedEmbeddingRecord(
  input: CreateDerivedEmbeddingInput,
): Result<DerivedEmbeddingRecord, LenaError> {
  if (input.manifest.embedding === null) {
    return err(new LenaError("unsupported", { capability: "embeddings" }));
  }
  const embedding = validateEmbeddingOutput(input.embedding, input.manifest.embedding);
  if (embedding.isErr()) return err(embedding.error);

  return ok(
    Object.freeze({
      chunkIdentity: input.chunk.chunkIdentity,
      dimensions: input.manifest.embedding.dimensions,
      embedding: embedding.value,
      modelIdentity: getModelIntegrityIdentity(input.manifest),
      sourceId: input.chunk.sourceId,
      sourceRevision: input.chunk.sourceRevision,
    }),
  );
}

export function isDerivedEmbeddingCurrent(
  record: DerivedEmbeddingRecord,
  chunk: TextChunk,
  manifest: ModelManifest,
): boolean {
  return (
    record.chunkIdentity === chunk.chunkIdentity &&
    record.sourceId === chunk.sourceId &&
    record.sourceRevision === chunk.sourceRevision &&
    record.modelIdentity === getModelIntegrityIdentity(manifest) &&
    manifest.embedding !== null &&
    record.dimensions === manifest.embedding.dimensions
  );
}
