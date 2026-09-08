import { err, LenaError, ok, type Result } from "@lena/core";
import { z } from "zod";

export const MAX_CHUNK_CODE_POINTS = 65_536;
export const MAX_SOURCE_CODE_POINTS = 10_000_000;

const SOURCE_IDENTITY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,255}$/;
export const sourceIdentitySchema = z
  .string()
  .transform((value) => value.normalize("NFC").trim())
  .pipe(z.string().regex(SOURCE_IDENTITY_PATTERN));

export const chunkTextInputSchema = z
  .strictObject({
    maximumCodePoints: z.number().int().safe().min(1).max(MAX_CHUNK_CODE_POINTS),
    overlapCodePoints: z.number().int().safe().nonnegative(),
    sourceId: sourceIdentitySchema,
    sourceRevision: sourceIdentitySchema,
    text: z.string(),
  })
  .superRefine((input, context) => {
    if (input.overlapCodePoints >= input.maximumCodePoints) {
      context.addIssue({
        code: "custom",
        message: "overlap_must_be_smaller_than_chunk",
        path: ["overlapCodePoints"],
      });
    }
  })
  .readonly();

export const textChunkSchema = z
  .strictObject({
    chunkIdentity: z.string().min(1).max(1_024),
    endCodePoint: z.number().int().safe().nonnegative(),
    index: z.number().int().safe().nonnegative(),
    sourceId: sourceIdentitySchema,
    sourceRevision: sourceIdentitySchema,
    startCodePoint: z.number().int().safe().nonnegative(),
    text: z.string(),
  })
  .readonly();

export type ChunkTextInput = z.input<typeof chunkTextInputSchema>;
export type TextChunk = z.output<typeof textChunkSchema>;

export function chunkText(input: unknown): Result<readonly TextChunk[], LenaError> {
  const parsedInput = chunkTextInputSchema.safeParse(input);
  if (!parsedInput.success) {
    return err(new LenaError("invalid_input"));
  }

  const { maximumCodePoints, overlapCodePoints, sourceId, sourceRevision, text } = parsedInput.data;
  const codePoints = Array.from(text);
  if (codePoints.length > MAX_SOURCE_CODE_POINTS) {
    return err(new LenaError("limit_exceeded", { maximum: MAX_SOURCE_CODE_POINTS }));
  }
  if (codePoints.length === 0) return ok(Object.freeze([]));

  const chunks: TextChunk[] = [];
  let startCodePoint = 0;
  while (startCodePoint < codePoints.length) {
    const endCodePoint = Math.min(startCodePoint + maximumCodePoints, codePoints.length);
    const index = chunks.length;
    chunks.push(
      Object.freeze({
        chunkIdentity: [
          "lena-ai-chunk",
          "v1",
          encodeURIComponent(sourceId),
          encodeURIComponent(sourceRevision),
          index,
          startCodePoint,
          endCodePoint,
        ].join(":"),
        endCodePoint,
        index,
        sourceId,
        sourceRevision,
        startCodePoint,
        text: codePoints.slice(startCodePoint, endCodePoint).join(""),
      }),
    );
    if (endCodePoint === codePoints.length) break;
    startCodePoint = endCodePoint - overlapCodePoints;
  }

  return ok(Object.freeze(chunks));
}

export function isChunkCurrent(
  chunk: TextChunk,
  sourceId: string,
  sourceRevision: string,
): boolean {
  return chunk.sourceId === sourceId && chunk.sourceRevision === sourceRevision;
}
