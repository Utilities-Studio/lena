import { err, LenaError, ok, type Result } from "@lena/core";
import { orderBy, uniq } from "es-toolkit";
import { z } from "zod";

export const MAX_RANKING_RESULTS = 100_000;

export interface LexicalResultInput {
  readonly documentId: string;
  /** FTS5 rank or BM25 value. Lower values rank first. */
  readonly score: number;
}

export interface NormalizedLexicalResult {
  readonly documentId: string;
  readonly normalizedScore: number;
  readonly rank: number;
  readonly rawScore: number;
}

export interface RankedDocument {
  readonly documentId: string;
}

export interface HybridRankingInput {
  readonly lexical: readonly RankedDocument[];
  readonly lexicalWeight?: number;
  readonly limit?: number;
  readonly rankConstant?: number;
  readonly semantic: readonly RankedDocument[];
  readonly semanticWeight?: number;
}

export interface HybridResult {
  readonly documentId: string;
  readonly lexicalRank: number | null;
  readonly score: number;
  readonly semanticRank: number | null;
}

export function normalizeFtsResults(
  value: unknown,
): Result<readonly NormalizedLexicalResult[], LenaError> {
  const resultArray = z.array(z.unknown()).safeParse(value);
  if (!resultArray.success) {
    return err(new LenaError("invalid_input", "FTS results must be an array"));
  }
  if (resultArray.data.length > MAX_RANKING_RESULTS) {
    return err(
      new LenaError("limit_exceeded", "Too many FTS results", {
        maximum: MAX_RANKING_RESULTS,
      }),
    );
  }

  const bestByDocument = new Map<string, number>();
  const resultShapeSchema = z.strictObject({ documentId: z.unknown(), score: z.unknown() });
  for (const candidate of resultArray.data) {
    const parsedCandidate = resultShapeSchema.safeParse(candidate);
    if (!parsedCandidate.success) {
      return err(new LenaError("invalid_input", "Invalid FTS result"));
    }
    const documentId = normalizeDocumentId(parsedCandidate.data.documentId);
    if (documentId.isErr()) {
      return err(documentId.error);
    }
    const score = parsedCandidate.data.score;
    if (typeof score !== "number" || !Number.isFinite(score)) {
      return err(new LenaError("invalid_input", "FTS score must be finite"));
    }

    const previous = bestByDocument.get(documentId.value);
    if (previous === undefined || score < previous) {
      bestByDocument.set(documentId.value, score);
    }
  }

  const sorted = orderBy(
    [...bestByDocument.entries()],
    [([, score]) => score, ([documentId]) => documentId],
    ["asc", "asc"],
  );
  if (sorted.length === 0) {
    return ok(Object.freeze([]));
  }

  const minimum = sorted[0]?.[1] ?? 0;
  const maximum = sorted[sorted.length - 1]?.[1] ?? minimum;
  const range = maximum - minimum;
  return ok(
    Object.freeze(
      sorted.map(([documentId, rawScore], index) =>
        Object.freeze({
          documentId,
          normalizedScore: range === 0 ? 1 : (maximum - rawScore) / range,
          rank: index + 1,
          rawScore,
        }),
      ),
    ),
  );
}

export function fuseHybridResults(
  input: HybridRankingInput,
): Result<readonly HybridResult[], LenaError> {
  const lexicalWeight = input.lexicalWeight ?? 1;
  const semanticWeight = input.semanticWeight ?? 1;
  const rankConstant = input.rankConstant ?? 60;

  if (!isWeight(lexicalWeight) || !isWeight(semanticWeight)) {
    return err(new LenaError("invalid_input", "Hybrid weights must be between zero and one"));
  }
  if (lexicalWeight === 0 && semanticWeight === 0) {
    return err(new LenaError("invalid_input", "At least one hybrid weight must be positive"));
  }
  if (!Number.isSafeInteger(rankConstant) || rankConstant < 1) {
    return err(new LenaError("invalid_input", "Rank constant must be a positive safe integer"));
  }

  const lexical = createRankMap(input.lexical, "lexical");
  if (lexical.isErr()) {
    return err(lexical.error);
  }
  const semantic = createRankMap(input.semantic, "semantic");
  if (semantic.isErr()) {
    return err(semantic.error);
  }

  const maximumLimit = lexical.value.size + semantic.value.size;
  const limit = input.limit ?? maximumLimit;
  if (!Number.isSafeInteger(limit) || limit < 0 || limit > MAX_RANKING_RESULTS) {
    return err(
      new LenaError("invalid_input", "Hybrid limit is invalid", {
        maximum: MAX_RANKING_RESULTS,
      }),
    );
  }

  const documentIds = uniq([...lexical.value.keys(), ...semantic.value.keys()]);
  const fused = documentIds.map((documentId) => {
    const lexicalRank = lexical.value.get(documentId) ?? null;
    const semanticRank = semantic.value.get(documentId) ?? null;
    const score =
      (lexicalRank === null ? 0 : lexicalWeight / (rankConstant + lexicalRank)) +
      (semanticRank === null ? 0 : semanticWeight / (rankConstant + semanticRank));

    return Object.freeze({ documentId, lexicalRank, score, semanticRank });
  });

  const ordered = fused.toSorted((left, right) => {
    const scoreOrder = right.score - left.score;
    if (scoreOrder !== 0) return scoreOrder;
    const leftBest = Math.min(
      left.lexicalRank ?? Number.POSITIVE_INFINITY,
      left.semanticRank ?? Number.POSITIVE_INFINITY,
    );
    const rightBest = Math.min(
      right.lexicalRank ?? Number.POSITIVE_INFINITY,
      right.semanticRank ?? Number.POSITIVE_INFINITY,
    );
    return leftBest - rightBest || compareText(left.documentId, right.documentId);
  });

  return ok(Object.freeze(ordered.slice(0, limit)));
}

function createRankMap(
  values: readonly RankedDocument[],
  modality: string,
): Result<ReadonlyMap<string, number>, LenaError> {
  if (!Array.isArray(values) || values.length > MAX_RANKING_RESULTS) {
    return err(
      new LenaError("limit_exceeded", "Invalid ranked result count", {
        maximum: MAX_RANKING_RESULTS,
        modality,
      }),
    );
  }

  const ranks = new Map<string, number>();
  for (let index = 0; index < values.length; index += 1) {
    const parsed = normalizeDocumentId(values[index]?.documentId);
    if (parsed.isErr()) {
      return err(parsed.error);
    }
    if (!ranks.has(parsed.value)) {
      ranks.set(parsed.value, ranks.size + 1);
    }
  }
  return ok(ranks);
}

function normalizeDocumentId(value: unknown): Result<string, LenaError> {
  if (typeof value !== "string") {
    return err(new LenaError("invalid_identifier", "Document id must be a string"));
  }
  const normalized = value.normalize("NFC").trim();
  if (normalized.length === 0 || normalized.length > 512) {
    return err(new LenaError("invalid_identifier", "Document id is invalid"));
  }
  return ok(normalized);
}

function isWeight(value: number): boolean {
  return Number.isFinite(value) && value >= 0 && value <= 1;
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
