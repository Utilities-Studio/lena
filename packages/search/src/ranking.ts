import { err, LenaError, ok, type Result } from "@lena/core";
import { orderBy, uniq } from "es-toolkit";
import { z } from "zod";

export const MAX_RANKING_RESULTS = 100_000;

const documentIdSchema = z
  .string()
  .transform((value) => value.normalize("NFC").trim())
  .pipe(z.string().min(1).max(512));
const rankedDocumentSchema = z.strictObject({ documentId: documentIdSchema }).readonly();
const lexicalResultSchema = z
  .strictObject({ documentId: documentIdSchema, score: z.number().finite() })
  .readonly();

export type LexicalResultInput = z.input<typeof lexicalResultSchema>;
export type RankedDocument = z.output<typeof rankedDocumentSchema>;
export type NormalizedLexicalResult = Readonly<{
  documentId: string;
  normalizedScore: number;
  rank: number;
  rawScore: number;
}>;
export type HybridRankingInput = Readonly<{
  lexical: readonly RankedDocument[];
  lexicalWeight?: number;
  limit?: number;
  rankConstant?: number;
  semantic: readonly RankedDocument[];
  semanticWeight?: number;
}>;
export type HybridResult = Readonly<{
  documentId: string;
  lexicalRank: number | null;
  score: number;
  semanticRank: number | null;
}>;

export function normalizeFtsResults(
  value: unknown,
): Result<readonly NormalizedLexicalResult[], LenaError> {
  const resultArray = z.array(lexicalResultSchema).max(MAX_RANKING_RESULTS).safeParse(value);
  if (!resultArray.success) {
    return err(new LenaError("invalid_input", { maximum: MAX_RANKING_RESULTS }));
  }

  const bestByDocument = new Map<string, number>();
  for (const candidate of resultArray.data) {
    const previous = bestByDocument.get(candidate.documentId);
    if (previous === undefined || candidate.score < previous) {
      bestByDocument.set(candidate.documentId, candidate.score);
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

/** Pure reference implementation for tests and small previews. Runtime search uses the SQLite plan. */
export function fuseHybridResults(
  input: HybridRankingInput,
): Result<readonly HybridResult[], LenaError> {
  const lexicalWeight = input.lexicalWeight ?? 1;
  const semanticWeight = input.semanticWeight ?? 1;
  const rankConstant = input.rankConstant ?? 60;

  if (!isWeight(lexicalWeight) || !isWeight(semanticWeight)) {
    return err(new LenaError("invalid_input"));
  }
  if (lexicalWeight === 0 && semanticWeight === 0) {
    return err(new LenaError("invalid_input"));
  }
  if (!Number.isSafeInteger(rankConstant) || rankConstant < 1) {
    return err(new LenaError("invalid_input"));
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
    return err(new LenaError("invalid_input", { maximum: MAX_RANKING_RESULTS }));
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

  const ordered = orderBy(
    fused,
    [
      ({ score }) => score,
      ({ lexicalRank, semanticRank }) =>
        Math.min(lexicalRank ?? Number.POSITIVE_INFINITY, semanticRank ?? Number.POSITIVE_INFINITY),
      ({ documentId }) => documentId,
    ],
    ["desc", "asc", "asc"],
  );

  return ok(Object.freeze(ordered.slice(0, limit)));
}

function createRankMap(
  values: readonly RankedDocument[],
  modality: string,
): Result<ReadonlyMap<string, number>, LenaError> {
  if (!Array.isArray(values) || values.length > MAX_RANKING_RESULTS) {
    return err(
      new LenaError("limit_exceeded", {
        maximum: MAX_RANKING_RESULTS,
        modality,
      }),
    );
  }

  const ranks = new Map<string, number>();
  for (let index = 0; index < values.length; index += 1) {
    const parsed = rankedDocumentSchema.safeParse(values[index]);
    if (!parsed.success) return err(new LenaError("invalid_identifier"));
    if (!ranks.has(parsed.data.documentId)) {
      ranks.set(parsed.data.documentId, ranks.size + 1);
    }
  }
  return ok(ranks);
}

function isWeight(value: number): boolean {
  return Number.isFinite(value) && value >= 0 && value <= 1;
}
