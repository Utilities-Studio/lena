import { describe, expect, test } from "bun:test";
import { ok } from "@lena/core";
import {
  evaluateModelEligibility,
  getModelIntegrityIdentity,
  parseModelManifest,
} from "../../src/index";

const MODEL_ID = "11111111-1111-4111-8111-111111111111";

function manifestInput() {
  return {
    artifact: { byteLength: 1_000, sha256: "A".repeat(64) },
    capabilities: ["summarization", "embedding"],
    embedding: { dimensions: 3, normalized: true },
    formatVersion: 1,
    modelId: MODEL_ID,
    requirements: {
      architectures: ["arm64"],
      minimumAvailableMemoryBytes: 2_000,
      minimumFreeStorageBytes: 3_000,
      minimumOsVersions: { ios: "17.0" },
      platforms: ["ios"],
    },
    runtime: "executorch",
    version: "1.2.0",
  };
}

describe("model manifest", () => {
  test("validates and canonicalizes integrity-bearing fields", () => {
    const parsed = parseModelManifest(manifestInput());
    expect(parsed.isOk()).toBe(true);
    if (parsed.isErr()) throw parsed.error;
    expect(parsed.value.artifact.sha256).toBe("a".repeat(64));
    expect(parsed.value.capabilities).toEqual(["embedding", "summarization"]);
    expect(getModelIntegrityIdentity(parsed.value)).toBe(
      `lena-model:v1:${MODEL_ID}:1.2.0:1000:sha256:${"a".repeat(64)}`,
    );
  });

  test("rejects a malformed hash and mismatched embedding capability", () => {
    expect(
      parseModelManifest({
        ...manifestInput(),
        artifact: { byteLength: 1_000, sha256: "not-a-hash" },
      }).isOk(),
    ).toBe(false);
    expect(parseModelManifest({ ...manifestInput(), embedding: null }).isOk()).toBe(false);
  });

  test("requires enough declared storage for the artifact", () => {
    const input = manifestInput();
    expect(
      parseModelManifest({
        ...input,
        requirements: { ...input.requirements, minimumFreeStorageBytes: 999 },
      }).isOk(),
    ).toBe(false);
  });
});

describe("runtime eligibility", () => {
  test("allows a supported on-device runtime with sufficient budget", () => {
    const manifest = parseModelManifest(manifestInput());
    if (manifest.isErr()) throw manifest.error;
    const decision = evaluateModelEligibility(manifest.value, {
      architecture: "arm64",
      availableMemoryBytes: 4_000,
      availableRuntimes: ["executorch"],
      freeStorageBytes: 8_000,
      osVersion: "17.4.1",
      platform: "ios",
      thermalState: "nominal",
    });

    expect(decision).toEqual(
      ok({
        decision: "load",
        eligible: true,
        inferenceMode: "on-device-only",
        memoryHeadroomBytes: 2_000,
        reasons: [],
        storageHeadroomBytes: 5_000,
      }),
    );
  });

  test("defers with stable reasons when device gates fail", () => {
    const manifest = parseModelManifest(manifestInput());
    if (manifest.isErr()) throw manifest.error;
    const decision = evaluateModelEligibility(manifest.value, {
      architecture: "x86_64",
      availableMemoryBytes: 1_000,
      availableRuntimes: [],
      freeStorageBytes: 2_000,
      osVersion: "16.9",
      platform: "ios",
      thermalState: "serious",
    });
    if (decision.isErr()) throw decision.error;

    expect(decision.value.decision).toBe("defer");
    expect(decision.value.inferenceMode).toBe("on-device-only");
    expect(decision.value.reasons).toEqual([
      "os_version_unsupported",
      "architecture_unsupported",
      "runtime_unavailable",
      "insufficient_memory",
      "insufficient_storage",
      "thermal_restricted",
    ]);
  });
});
