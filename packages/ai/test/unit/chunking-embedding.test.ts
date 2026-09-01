import { describe, expect, test } from "bun:test";
import {
  chunkText,
  createDerivedEmbeddingRecord,
  isChunkCurrent,
  isDerivedEmbeddingCurrent,
  parseModelManifest,
  validateEmbeddingOutput,
} from "../../src/index";

const MODEL_ID = "018f3f5a-1d2c-7abc-8def-0123456789ab";

function embeddingManifest(version = "1.0.0") {
  const manifest = parseModelManifest({
    artifact: { byteLength: 1_000, sha256: "b".repeat(64) },
    capabilities: ["embedding"],
    embedding: { dimensions: 2, normalized: true },
    formatVersion: 1,
    modelId: MODEL_ID,
    requirements: {
      architectures: ["arm64"],
      minimumAvailableMemoryBytes: 1_000,
      minimumFreeStorageBytes: 2_000,
      minimumOsVersions: { ios: "17" },
      platforms: ["ios"],
    },
    runtime: "executorch",
    version,
  });
  if (manifest.isErr()) throw manifest.error;
  return manifest.value;
}

describe("deterministic chunking", () => {
  test("chunks by Unicode code point with exact overlap", () => {
    const chunks = chunkText({
      maximumCodePoints: 3,
      overlapCodePoints: 1,
      sourceId: "entry-7",
      sourceRevision: "revision-2",
      text: "A😀BCD",
    });
    if (chunks.isErr()) throw chunks.error;

    expect(
      chunks.value.map(({ startCodePoint, endCodePoint, text }) => ({
        endCodePoint,
        startCodePoint,
        text,
      })),
    ).toEqual([
      { endCodePoint: 3, startCodePoint: 0, text: "A😀B" },
      { endCodePoint: 5, startCodePoint: 2, text: "BCD" },
    ]);
    expect(chunks.value[0]?.chunkIdentity).toBe("lena-ai-chunk:v1:entry-7:revision-2:0:0:3");
  });

  test("source revision invalidates chunk identity without changing source text", () => {
    const first = chunkText({
      maximumCodePoints: 10,
      overlapCodePoints: 0,
      sourceId: "entry-7",
      sourceRevision: "revision-1",
      text: "same text",
    });
    const second = chunkText({
      maximumCodePoints: 10,
      overlapCodePoints: 0,
      sourceId: "entry-7",
      sourceRevision: "revision-2",
      text: "same text",
    });
    if (first.isErr() || second.isErr() || !first.value[0] || !second.value[0]) return;
    expect(first.value[0].text).toBe(second.value[0].text);
    expect(first.value[0].chunkIdentity).not.toBe(second.value[0].chunkIdentity);
    expect(isChunkCurrent(first.value[0], "entry-7", "revision-2")).toBe(false);
  });

  test("escapes identity separators so distinct sources cannot collide", () => {
    const left = chunkText({
      maximumCodePoints: 10,
      overlapCodePoints: 0,
      sourceId: "entry:7",
      sourceRevision: "revision",
      text: "text",
    });
    const right = chunkText({
      maximumCodePoints: 10,
      overlapCodePoints: 0,
      sourceId: "entry",
      sourceRevision: "7:revision",
      text: "text",
    });
    if (left.isErr() || right.isErr() || !left.value[0] || !right.value[0]) return;
    expect(left.value[0].chunkIdentity).not.toBe(right.value[0].chunkIdentity);
  });
});

describe("embedding validation", () => {
  test("rejects wrong dimensions, non-finite values, and non-normalized output", () => {
    const specification = { dimensions: 2, normalized: true } as const;
    expect(validateEmbeddingOutput([1, 0], specification).isOk()).toBe(true);
    expect(validateEmbeddingOutput([1], specification).isOk()).toBe(false);
    expect(validateEmbeddingOutput([1, Number.NaN], specification).isOk()).toBe(false);
    expect(validateEmbeddingOutput([1, 1], specification).isOk()).toBe(false);
  });

  test("versions derived records against chunk revision and model integrity", () => {
    const chunks = chunkText({
      maximumCodePoints: 20,
      overlapCodePoints: 0,
      sourceId: "entry-7",
      sourceRevision: "revision-1",
      text: "private canonical text",
    });
    if (chunks.isErr() || !chunks.value[0]) return;
    const record = createDerivedEmbeddingRecord({
      chunk: chunks.value[0],
      embedding: [1, 0],
      manifest: embeddingManifest(),
    });
    if (record.isErr()) throw record.error;

    expect(isDerivedEmbeddingCurrent(record.value, chunks.value[0], embeddingManifest())).toBe(
      true,
    );
    expect(
      isDerivedEmbeddingCurrent(record.value, chunks.value[0], embeddingManifest("2.0.0")),
    ).toBe(false);
  });
});
