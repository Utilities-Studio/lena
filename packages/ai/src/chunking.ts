import { err, LenaError, ok, type Result } from "@lena/core";
import { z } from "zod";

export const MAX_CHUNK_CODE_POINTS = 65_536;
export const MAX_SOURCE_CODE_POINTS = 10_000_000;

export interface ChunkTextInput {
  readonly maximumCodePoints: number;
  readonly overlapCodePoints: number;
  readonly sourceId: string;
  readonly sourceRevision: string;
  readonly text: string;
}

export interface TextChunk {
  readonly chunkIdentity: string;
  readonly endCodePoint: number;
  readonly index: number;
  readonly sourceId: string;
  readonly sourceRevision: string;
  readonly startCodePoint: number;
  readonly text: string;
}

const SOURCE_IDENTITY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,255}$/;
const chunkTextInputShapeSchema = z.strictObject({
  maximumCodePoints: z.unknown(),
  overlapCodePoints: z.unknown(),
  sourceId: z.unknown(),
  sourceRevision: z.unknown(),
  text: z.unknown(),
});
const sourceIdentitySchema = z
  .string()
  .transform((value) => value.normalize("NFC").trim())
  .pipe(z.string().regex(SOURCE_IDENTITY_PATTERN));

export function chunkText(input: ChunkTextInput): Result<readonly TextChunk[], LenaError> {
  const parsedInput = chunkTextInputShapeSchema.safeParse(input);
  if (!parsedInput.success) {
    return err(new LenaError("invalid_input", "Chunk input shape is invalid"));
  }
  const sourceId = parseSourceIdentity(parsedInput.data.sourceId, "Source id");
  if (sourceId.isErr()) return err(sourceId.error);
  const sourceRevision = parseSourceIdentity(parsedInput.data.sourceRevision, "Source revision");
  if (sourceRevision.isErr()) return err(sourceRevision.error);
  if (typeof parsedInput.data.text !== "string") {
    return err(new LenaError("invalid_input", "Chunk source text must be a string"));
  }
  if (
    !Number.isSafeInteger(parsedInput.data.maximumCodePoints) ||
    (parsedInput.data.maximumCodePoints as number) < 1 ||
    (parsedInput.data.maximumCodePoints as number) > MAX_CHUNK_CODE_POINTS
  ) {
    return err(
      new LenaError("invalid_input", "Maximum chunk size is invalid", {
        maximum: MAX_CHUNK_CODE_POINTS,
      }),
    );
  }
  if (
    !Number.isSafeInteger(parsedInput.data.overlapCodePoints) ||
    (parsedInput.data.overlapCodePoints as number) < 0 ||
    (parsedInput.data.overlapCodePoints as number) >= (parsedInput.data.maximumCodePoints as number)
  ) {
    return err(new LenaError("invalid_input", "Chunk overlap is invalid"));
  }

  const maximumCodePoints = parsedInput.data.maximumCodePoints as number;
  const overlapCodePoints = parsedInput.data.overlapCodePoints as number;
  const codePoints = Array.from(parsedInput.data.text);
  if (codePoints.length > MAX_SOURCE_CODE_POINTS) {
    return err(
      new LenaError("limit_exceeded", "Chunk source text is too large", {
        maximum: MAX_SOURCE_CODE_POINTS,
      }),
    );
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
          encodeURIComponent(sourceId.value),
          encodeURIComponent(sourceRevision.value),
          index,
          startCodePoint,
          endCodePoint,
        ].join(":"),
        endCodePoint,
        index,
        sourceId: sourceId.value,
        sourceRevision: sourceRevision.value,
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

function parseSourceIdentity(value: unknown, name: string): Result<string, LenaError> {
  const parsed = sourceIdentitySchema.safeParse(value);
  if (!parsed.success) {
    return err(new LenaError("invalid_identifier", `${name} is invalid`));
  }
  return ok(parsed.data);
}
