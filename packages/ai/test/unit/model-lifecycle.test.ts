import { describe, expect, test } from "bun:test";
import { ok } from "@lena/core";
import {
  ABSENT_MODEL,
  getModelAvailability,
  parseModelManifest,
  transitionModelLifecycle,
} from "../../src/index";

const MODEL_ID = "11111111-1111-4111-8111-111111111111";
const INSTALL_ID = "22222222-2222-4222-8222-222222222222";
const OLD_INSTALL_ID = "33333333-3333-4333-8333-333333333333";
const NEW_INSTALL_ID = "44444444-4444-4444-8444-444444444444";
const HASH = "c".repeat(64);

function manifest() {
  const parsed = parseModelManifest({
    artifact: { byteLength: 100, sha256: HASH },
    capabilities: ["embedding"],
    embedding: { dimensions: 2, normalized: false },
    formatVersion: 1,
    modelId: MODEL_ID,
    requirements: {
      architectures: ["arm64"],
      minimumAvailableMemoryBytes: 100,
      minimumFreeStorageBytes: 200,
      minimumOsVersions: { ios: "17" },
      platforms: ["ios"],
    },
    runtime: "executorch",
    version: "1.0.0",
  });
  if (parsed.isErr()) throw parsed.error;
  return parsed.value;
}

describe("model lifecycle", () => {
  test("resumes an interrupted download from its durable checkpoint", () => {
    const installing = transitionModelLifecycle(ABSENT_MODEL, {
      installId: INSTALL_ID,
      manifest: manifest(),
      type: "install_requested",
    });
    if (installing.isErr()) throw installing.error;
    const progressed = transitionModelLifecycle(installing.value, {
      downloadedBytes: 40,
      installId: INSTALL_ID,
      type: "download_progressed",
    });
    if (progressed.isErr()) throw progressed.error;
    const failed = transitionModelLifecycle(progressed.value, {
      installId: INSTALL_ID,
      reasonCode: "temporarily_unavailable",
      type: "operation_failed",
    });
    if (failed.isErr()) throw failed.error;
    const resumed = transitionModelLifecycle(failed.value, {
      installId: INSTALL_ID,
      type: "retry_requested",
    });

    expect(resumed.isOk() && resumed.value).toMatchObject({
      downloadedBytes: 40,
      status: "downloading",
    });
  });

  test("requires exact artifact length and hash before ready", () => {
    const installing = transitionModelLifecycle(ABSENT_MODEL, {
      installId: INSTALL_ID,
      manifest: manifest(),
      type: "install_requested",
    });
    if (installing.isErr()) throw installing.error;
    const progressed = transitionModelLifecycle(installing.value, {
      downloadedBytes: 100,
      installId: INSTALL_ID,
      type: "download_progressed",
    });
    if (progressed.isErr()) throw progressed.error;
    const verifying = transitionModelLifecycle(progressed.value, {
      installId: INSTALL_ID,
      type: "download_completed",
    });
    if (verifying.isErr()) throw verifying.error;
    const rejected = transitionModelLifecycle(verifying.value, {
      actualByteLength: 100,
      actualSha256: "d".repeat(64),
      installId: INSTALL_ID,
      type: "verification_completed",
    });

    expect(rejected.isOk() && rejected.value).toMatchObject({
      artifactDisposition: "discard_required",
      downloadedBytes: 0,
      reasonCode: "integrity_failed",
      retryFrom: "download",
      status: "failed",
    });
    if (rejected.isErr()) throw rejected.error;
    expect(
      transitionModelLifecycle(rejected.value, {
        installId: INSTALL_ID,
        type: "retry_requested",
      }).isOk(),
    ).toBe(false);
    expect(
      transitionModelLifecycle(rejected.value, {
        installId: INSTALL_ID,
        type: "artifact_discarded",
      }),
    ).toEqual(ok(ABSENT_MODEL));
  });

  test("becomes available only after verification and never selects cloud fallback", () => {
    const installing = transitionModelLifecycle(ABSENT_MODEL, {
      installId: INSTALL_ID,
      manifest: manifest(),
      type: "install_requested",
    });
    if (installing.isErr()) throw installing.error;
    expect(getModelAvailability(installing.value, "embedding")).toEqual({
      available: false,
      cloudFallback: false,
      reason: "model_not_ready",
    });
    const progressed = transitionModelLifecycle(installing.value, {
      downloadedBytes: 100,
      installId: INSTALL_ID,
      type: "download_progressed",
    });
    if (progressed.isErr()) throw progressed.error;
    const verifying = transitionModelLifecycle(progressed.value, {
      installId: INSTALL_ID,
      type: "download_completed",
    });
    if (verifying.isErr()) throw verifying.error;
    const ready = transitionModelLifecycle(verifying.value, {
      actualByteLength: 100,
      actualSha256: HASH,
      installId: INSTALL_ID,
      type: "verification_completed",
    });
    if (ready.isErr()) throw ready.error;
    expect(getModelAvailability(ready.value, "embedding")).toEqual({
      available: true,
      cloudFallback: false,
      reason: "available",
    });
    expect(getModelAvailability(ready.value, "summarization")).toEqual({
      available: false,
      cloudFallback: false,
      reason: "capability_missing",
    });

    const evicting = transitionModelLifecycle(ready.value, {
      installId: INSTALL_ID,
      type: "eviction_requested",
    });
    if (evicting.isErr()) throw evicting.error;
    const evicted = transitionModelLifecycle(evicting.value, {
      installId: INSTALL_ID,
      type: "eviction_completed",
    });
    expect(evicted).toEqual(ok(ABSENT_MODEL));
  });

  test("rejects impossible lifecycle transitions", () => {
    const invalid = transitionModelLifecycle(ABSENT_MODEL, {
      installId: INSTALL_ID,
      type: "download_completed",
    });
    expect(invalid.isOk()).toBe(false);
    if (invalid.isErr()) expect(invalid.error.code).toBe("invalid_state_transition");
  });

  test("rejects late events from an earlier installation", () => {
    const first = transitionModelLifecycle(ABSENT_MODEL, {
      installId: OLD_INSTALL_ID,
      manifest: manifest(),
      type: "install_requested",
    });
    if (first.isErr()) throw first.error;
    const failed = transitionModelLifecycle(first.value, {
      installId: OLD_INSTALL_ID,
      reasonCode: "integrity_failed",
      type: "operation_failed",
    });
    if (failed.isErr()) throw failed.error;
    const absent = transitionModelLifecycle(failed.value, {
      installId: OLD_INSTALL_ID,
      type: "artifact_discarded",
    });
    if (absent.isErr()) throw absent.error;
    const replacement = transitionModelLifecycle(absent.value, {
      installId: NEW_INSTALL_ID,
      manifest: manifest(),
      type: "install_requested",
    });
    if (replacement.isErr()) throw replacement.error;

    expect(
      transitionModelLifecycle(replacement.value, {
        downloadedBytes: 100,
        installId: OLD_INSTALL_ID,
        type: "download_progressed",
      }).isOk(),
    ).toBe(false);
  });
});
