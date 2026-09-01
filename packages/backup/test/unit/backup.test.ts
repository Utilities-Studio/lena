import { describe, expect, test } from "bun:test";
import fc from "fast-check";
import {
  createSchemaCompatibilityRange,
  parseEffectId,
  parseGenerationId,
  parseIsoTimestamp,
  parseSchemaVersion,
  parseVaultId,
  parseVaultInstanceId,
} from "@lena/core";
import {
  createBackupAttempt,
  createPersistedLocalVerificationClaim,
  createRestoreAttempt,
  getGenerationObjectPath,
  isAuthorizedRetentionPlan,
  isRuntimeRemoteObjectReceipt,
  isRuntimeVerifiedGeneration,
  orderGenerationCandidates,
  parseBackupAttempt,
  parseGenerationManifest,
  parsePersistedRemoteObjectReceiptClaim,
  parseRestoreAttempt,
  parseSha256Checksum,
  parsePersistedGenerationVerificationClaim,
  planGenerationRetention,
  reduceBackupAttempt,
  reduceRestoreAttempt,
  serializeGenerationManifest,
  validateRestoreCandidate,
  validateRetentionPolicy,
  type BackupAttempt,
  type BackupAttemptEvent,
  type GenerationCandidate,
  type GenerationManifest,
  type RemoteObjectReceipt,
  type RestoreAttempt,
  type RestoreEvent,
  type RestoreGenerationBinding,
  type ValidatedRestoreCandidate,
} from "../../src/index";
import {
  createRuntimeLocalVerifiedGeneration,
  createRuntimeRemoteObjectReceipt,
  createRuntimeRemoteVerifiedGeneration,
} from "../../src/runtime-evidence";

const VAULT_UUID = "018f3f5a-1d2c-7abc-8def-0123456789ab";
const OTHER_VAULT_UUID = "018f3f5a-1d2c-7abc-8def-1123456789ab";
const GENERATION_UUID = "018f3f5a-1d2c-7abc-8def-2123456789ab";
const SECOND_GENERATION_UUID = "018f3f5a-1d2c-7abc-8def-3123456789ab";
const THIRD_GENERATION_UUID = "018f3f5a-1d2c-7abc-8def-4123456789ab";
const EFFECT_UUID = "018f3f5a-1d2c-7abc-8def-5123456789ab";
const SECOND_EFFECT_UUID = "018f3f5a-1d2c-7abc-8def-6123456789ab";
const PREVIOUS_INSTANCE_UUID = "018f3f5a-1d2c-7abc-8def-7123456789ab";
const STAGING_INSTANCE_UUID = "018f3f5a-1d2c-7abc-8def-8123456789ab";
const NOW_TEXT = "2026-09-01T08:15:30.000Z";
const LATER_TEXT = "2026-09-01T08:16:30.000Z";
const LATEST_TEXT = "2026-09-02T08:16:30.000Z";
const CONTENT_CHECKSUM_TEXT = `sha256:${"a".repeat(64)}`;
const OBJECT_CHECKSUM_TEXT = `sha256:${"b".repeat(64)}`;
const OTHER_OBJECT_CHECKSUM_TEXT = `sha256:${"c".repeat(64)}`;

function rawManifest(overrides: Record<string, unknown> = {}) {
  return {
    applicationVersion: "1.0.0",
    completedAt: LATER_TEXT,
    compatibleSchema: { maximum: 3, minimum: 1 },
    createdAt: NOW_TEXT,
    encryption: {
      algorithm: "AES-256-GCM",
      envelopeVersion: 1,
      nonceByteLength: 12,
      tagByteLength: 16,
    },
    formatVersion: 1,
    generationId: GENERATION_UUID,
    parentGenerationId: null,
    payload: {
      attachmentByteLength: 40,
      attachmentCount: 2,
      contentByteLength: 100,
      contentChecksum: CONTENT_CHECKSUM_TEXT,
      recordCounts: { entries: 4, settings: 2 },
    },
    reason: "mutation",
    schemaVersion: 2,
    vaultId: VAULT_UUID,
    ...overrides,
  };
}

function manifest(overrides: Record<string, unknown> = {}): GenerationManifest {
  const parsed = parseGenerationManifest(rawManifest(overrides));
  if (parsed.isErr()) throw parsed.error;
  return parsed.value;
}

function fixtures() {
  const vaultId = parseVaultId(VAULT_UUID);
  const otherVaultId = parseVaultId(OTHER_VAULT_UUID);
  const generationId = parseGenerationId(GENERATION_UUID);
  const secondGenerationId = parseGenerationId(SECOND_GENERATION_UUID);
  const thirdGenerationId = parseGenerationId(THIRD_GENERATION_UUID);
  const effectId = parseEffectId(EFFECT_UUID);
  const secondEffectId = parseEffectId(SECOND_EFFECT_UUID);
  const previousInstanceId = parseVaultInstanceId(PREVIOUS_INSTANCE_UUID);
  const stagingInstanceId = parseVaultInstanceId(STAGING_INSTANCE_UUID);
  const now = parseIsoTimestamp(NOW_TEXT);
  const later = parseIsoTimestamp(LATER_TEXT);
  const latest = parseIsoTimestamp(LATEST_TEXT);
  const contentChecksum = parseSha256Checksum(CONTENT_CHECKSUM_TEXT);
  const objectChecksum = parseSha256Checksum(OBJECT_CHECKSUM_TEXT);
  const otherObjectChecksum = parseSha256Checksum(OTHER_OBJECT_CHECKSUM_TEXT);
  const minimum = parseSchemaVersion(1);
  const maximum = parseSchemaVersion(3);
  if (
    vaultId.isErr() ||
    otherVaultId.isErr() ||
    generationId.isErr() ||
    secondGenerationId.isErr() ||
    thirdGenerationId.isErr() ||
    effectId.isErr() ||
    secondEffectId.isErr() ||
    previousInstanceId.isErr() ||
    stagingInstanceId.isErr() ||
    now.isErr() ||
    later.isErr() ||
    latest.isErr() ||
    contentChecksum.isErr() ||
    objectChecksum.isErr() ||
    otherObjectChecksum.isErr() ||
    minimum.isErr() ||
    maximum.isErr()
  ) {
    throw new Error("Invalid test fixture");
  }
  const compatibility = createSchemaCompatibilityRange(minimum.value, maximum.value);
  if (compatibility.isErr()) throw compatibility.error;
  return {
    compatibility: compatibility.value,
    contentChecksum: contentChecksum.value,
    effectId: effectId.value,
    generationId: generationId.value,
    later: later.value,
    latest: latest.value,
    now: now.value,
    objectChecksum: objectChecksum.value,
    otherObjectChecksum: otherObjectChecksum.value,
    otherVaultId: otherVaultId.value,
    previousInstanceId: previousInstanceId.value,
    secondEffectId: secondEffectId.value,
    secondGenerationId: secondGenerationId.value,
    stagingInstanceId: stagingInstanceId.value,
    thirdGenerationId: thirdGenerationId.value,
    vaultId: vaultId.value,
  };
}

function localCandidate(generationManifest = manifest()): GenerationCandidate {
  const { objectChecksum } = fixtures();
  const verification = createRuntimeLocalVerifiedGeneration({
    generationId: generationManifest.generationId,
    localCiphertextUri: `file:///verified/${generationManifest.generationId}.lena`,
    objectByteLength: 240,
    objectChecksum,
    verifiedAt: generationManifest.completedAt,
    vaultId: generationManifest.vaultId,
  });
  if (verification.isErr()) throw verification.error;
  return {
    available: true,
    manifest: generationManifest,
    source: "local",
    verification: verification.value,
  };
}

function restoreAttempt(input: Parameters<typeof createRestoreAttempt>[0]): RestoreAttempt {
  const attempt = createRestoreAttempt(input);
  if (attempt.isErr()) throw attempt.error;
  return attempt.value;
}

function runtimeLocalVerification(generationManifest = manifest()) {
  const { objectChecksum } = fixtures();
  const verification = createRuntimeLocalVerifiedGeneration({
    generationId: generationManifest.generationId,
    localCiphertextUri: `file:///verified/${generationManifest.generationId}.lena`,
    objectByteLength: 240,
    objectChecksum,
    verifiedAt: generationManifest.completedAt,
    vaultId: generationManifest.vaultId,
  });
  if (verification.isErr()) throw verification.error;
  return verification.value;
}

function validatedCandidate(): ValidatedRestoreCandidate {
  const { compatibility, vaultId } = fixtures();
  const candidate = validateRestoreCandidate(localCandidate(), compatibility, vaultId);
  if (candidate.isErr()) throw candidate.error;
  return candidate.value;
}

function binding(candidate = validatedCandidate()): RestoreGenerationBinding {
  return {
    contentByteLength: candidate.manifest.payload.contentByteLength,
    contentChecksum: candidate.manifest.payload.contentChecksum,
    generationId: candidate.manifest.generationId,
    objectByteLength: candidate.verification.objectByteLength,
    objectChecksum: candidate.verification.objectChecksum,
    schemaVersion: candidate.manifest.schemaVersion,
    vaultId: candidate.manifest.vaultId,
  };
}

function applyBackupEvents(
  initial: BackupAttempt,
  events: readonly BackupAttemptEvent[],
): BackupAttempt {
  let attempt = initial;
  for (const event of events) {
    const next = reduceBackupAttempt(attempt, event);
    if (next.isErr()) throw next.error;
    attempt = next.value;
  }
  return attempt;
}

function applyRestoreEvents(
  initial: RestoreAttempt,
  events: readonly RestoreEvent[],
): RestoreAttempt {
  let attempt = initial;
  for (const event of events) {
    const next = reduceRestoreAttempt(attempt, event);
    if (next.isErr()) throw next.error;
    attempt = next.value;
  }
  return attempt;
}

function remoteReceipt(
  overrides: Partial<{
    claimId: ReturnType<typeof fixtures>["effectId"];
    generationId: ReturnType<typeof fixtures>["generationId"];
    objectByteLength: number;
    objectChecksum: ReturnType<typeof fixtures>["objectChecksum"];
    provider: "google-drive" | "icloud";
    providerObjectId: string;
    providerObjectPath: string;
    vaultId: ReturnType<typeof fixtures>["vaultId"];
  }> = {},
): RemoteObjectReceipt {
  const { effectId, generationId, later, objectChecksum, vaultId } = fixtures();
  const receipt = createRuntimeRemoteObjectReceipt({
    claimId: overrides.claimId ?? effectId,
    generationId: overrides.generationId ?? generationId,
    objectByteLength: overrides.objectByteLength ?? 240,
    objectChecksum: overrides.objectChecksum ?? objectChecksum,
    provider: overrides.provider ?? "icloud",
    providerObjectId: overrides.providerObjectId ?? "provider-object-123",
    providerObjectPath:
      overrides.providerObjectPath ?? `vaults/${vaultId}/generations/${generationId}.lena`,
    verifiedAt: later,
    vaultId: overrides.vaultId ?? vaultId,
  });
  if (receipt.isErr()) throw receipt.error;
  return receipt.value;
}

function remoteUploadedAttempt(): BackupAttempt {
  const { effectId, generationId, later, now, objectChecksum, vaultId } = fixtures();
  return applyBackupEvents(createBackupAttempt({ createdAt: now, generationId, vaultId }), [
    { at: now, type: "begin-write" },
    {
      at: now,
      objectByteLength: 240,
      objectChecksum,
      type: "verify-local",
    },
    { at: now, provider: "icloud", type: "queue-upload" },
    { at: now, claimId: effectId, type: "claim-upload" },
    {
      at: later,
      claimId: effectId,
      remoteObjectId: "provider-object-123",
      remoteObjectPath: `vaults/${vaultId}/generations/${generationId}.lena`,
      type: "record-upload",
    },
  ]);
}

describe("generation manifests", () => {
  test("parses bounded versioned metadata", () => {
    const parsed = parseGenerationManifest(rawManifest());
    expect(parsed.isOk()).toBe(true);
    expect(parsed.value.payload.recordCounts).toEqual({ entries: 4, settings: 2 });
    expect(getGenerationObjectPath(parsed.value)).toBe(
      `vaults/${VAULT_UUID}/generations/${GENERATION_UUID}.lena`,
    );
  });

  test("rejects corrupt metadata before payload allocation", () => {
    expect(
      parseGenerationManifest(
        rawManifest({
          payload: {
            ...rawManifest().payload,
            contentByteLength: Number.MAX_SAFE_INTEGER,
          },
        }),
      ).isOk(),
    ).toBe(false);
    expect(
      parseGenerationManifest(rawManifest({ completedAt: NOW_TEXT, createdAt: LATER_TEXT })).isOk(),
    ).toBe(false);
    expect(parseGenerationManifest(rawManifest({ reason: "restore-purchases" })).isOk()).toBe(
      false,
    );
  });

  test("rejects malformed checksums and unsupported encryption", () => {
    expect(
      parseGenerationManifest(
        rawManifest({
          payload: { ...rawManifest().payload, contentChecksum: "fnv32:1234" },
        }),
      ).isOk(),
    ).toBe(false);
    expect(
      parseGenerationManifest(
        rawManifest({
          encryption: {
            algorithm: "AES-CBC",
            envelopeVersion: 1,
            nonceByteLength: 16,
            tagByteLength: 0,
          },
        }),
      ).isOk(),
    ).toBe(false);
  });

  test("rejects unknown metadata instead of accepting identity leakage", () => {
    expect(parseGenerationManifest(rawManifest({ email: "person@example.com" })).isOk()).toBe(
      false,
    );
  });

  test("serializes deterministically before the manifest enters authenticated ciphertext", () => {
    const first = manifest({
      payload: {
        ...rawManifest().payload,
        recordCounts: { settings: 2, entries: 4 },
      },
    });
    const second = manifest({
      payload: {
        ...rawManifest().payload,
        recordCounts: { entries: 4, settings: 2 },
      },
    });
    const firstSerialized = serializeGenerationManifest(first);
    const secondSerialized = serializeGenerationManifest(second);
    expect(firstSerialized).toEqual(secondSerialized);
    if (firstSerialized.isErr()) return;
    expect(parseGenerationManifest(JSON.parse(firstSerialized.value)).isOk()).toBe(true);
  });

  test("property: valid manifests serialize and parse without structural drift", () => {
    fc.assert(
      fc.property(
        fc.record({
          attachmentCount: fc.integer({ min: 0, max: 10_000 }),
          byteLengths: fc
            .tuple(fc.integer({ min: 0, max: 1_000_000 }), fc.integer({ min: 0, max: 1_000_000 }))
            .map(([attachmentByteLength, nonAttachmentByteLength]) => ({
              attachmentByteLength,
              contentByteLength: attachmentByteLength + nonAttachmentByteLength,
            })),
          reason: fc.constantFrom(
            "daily",
            "manual",
            "monthly",
            "mutation",
            "pre-destructive-action",
            "pre-migration",
          ),
          recordCounts: fc.dictionary(
            fc.stringMatching(/^[a-z][a-z0-9_]{0,15}$/),
            fc.integer({ min: 0, max: 1_000_000 }),
            { maxKeys: 32 },
          ),
        }),
        ({ attachmentCount, byteLengths, reason, recordCounts }) => {
          const parsed = parseGenerationManifest(
            rawManifest({
              payload: {
                attachmentByteLength: byteLengths.attachmentByteLength,
                attachmentCount,
                contentByteLength: byteLengths.contentByteLength,
                contentChecksum: CONTENT_CHECKSUM_TEXT,
                recordCounts,
              },
              reason,
            }),
          );
          expect(parsed.isOk()).toBe(true);
          if (parsed.isErr()) return;

          const serialized = serializeGenerationManifest(parsed.value);
          expect(serialized.isOk()).toBe(true);
          if (serialized.isErr()) return;

          const reparsed = parseGenerationManifest(JSON.parse(serialized.value));
          expect(reparsed.isOk()).toBe(true);
          if (reparsed.isErr()) return;
          expect(reparsed.value).toEqual(parsed.value);
          expect(serializeGenerationManifest(reparsed.value)).toEqual(serialized);
        },
      ),
      { numRuns: 100 },
    );
  });
});

describe("verified generation evidence", () => {
  test("round-trips a strict branded remote receipt", () => {
    const receipt = remoteReceipt();
    const parsed = parsePersistedRemoteObjectReceiptClaim(JSON.parse(JSON.stringify(receipt)));
    expect(parsed.isOk()).toBe(true);
    if (parsed.isOk()) expect(isRuntimeRemoteObjectReceipt(parsed.value)).toBe(false);
    expect(
      parsePersistedRemoteObjectReceiptClaim({ ...receipt, email: "person@example.com" }).isOk(),
    ).toBe(false);
  });

  test("binds remote verification to the exact object", () => {
    const { effectId, generationId, objectChecksum, otherObjectChecksum, otherVaultId, vaultId } =
      fixtures();
    const base = {
      activeClaimId: effectId,
      expectedGenerationId: generationId,
      expectedObjectByteLength: 240,
      expectedObjectChecksum: objectChecksum,
      expectedProvider: "icloud" as const,
      expectedProviderObjectId: "provider-object-123",
      expectedProviderObjectPath: getGenerationObjectPath(manifest()),
      expectedVaultId: vaultId,
    };
    expect(
      createRuntimeRemoteVerifiedGeneration({ ...base, receipt: remoteReceipt() }).isOk(),
    ).toBe(true);
    expect(
      createRuntimeRemoteVerifiedGeneration({
        ...base,
        receipt: remoteReceipt({ objectByteLength: 241 }),
      }).isOk(),
    ).toBe(false);
    expect(
      createRuntimeRemoteVerifiedGeneration({
        ...base,
        receipt: remoteReceipt({ objectChecksum: otherObjectChecksum }),
      }).isOk(),
    ).toBe(false);
    expect(
      createRuntimeRemoteVerifiedGeneration({
        ...base,
        receipt: remoteReceipt({ provider: "google-drive" }),
      }).isOk(),
    ).toBe(false);
    expect(
      createRuntimeRemoteVerifiedGeneration({
        ...base,
        receipt: remoteReceipt({ providerObjectId: "another-object" }),
      }).isOk(),
    ).toBe(false);
    expect(
      createRuntimeRemoteVerifiedGeneration({
        ...base,
        receipt: remoteReceipt({ providerObjectPath: "vaults/wrong/generation.lena" }),
      }).isOk(),
    ).toBe(false);
    expect(
      createRuntimeRemoteVerifiedGeneration({
        ...base,
        receipt: remoteReceipt({ vaultId: otherVaultId }),
      }).isOk(),
    ).toBe(false);
  });

  test("rejects forged verification provenance while parsing persistence", () => {
    const local = localCandidate().verification;
    if (local === null) return;
    expect(
      parsePersistedGenerationVerificationClaim(JSON.parse(JSON.stringify(local))).isOk(),
    ).toBe(true);
    expect(
      parsePersistedGenerationVerificationClaim({
        ...local,
        claimId: EFFECT_UUID,
      }).isOk(),
    ).toBe(false);
  });
});

describe("backup lifecycle", () => {
  test("requires the active claim and exact receipt before verification", () => {
    const { effectId, later } = fixtures();
    const verified = reduceBackupAttempt(remoteUploadedAttempt(), {
      at: later,
      claimId: effectId,
      receipt: remoteReceipt(),
      type: "verify-remote",
    });
    expect(verified.isOk()).toBe(true);
    if (verified.isErr() || verified.value.state !== "verified") return;
    expect(verified.value.verification.kind).toBe("remote");
    expect(verified.value.verification.claimId).toBe(effectId);
  });

  test("rejects stale claims at upload recording and verification", () => {
    const { effectId, generationId, later, now, objectChecksum, secondEffectId, vaultId } =
      fixtures();
    const uploading = applyBackupEvents(
      createBackupAttempt({ createdAt: now, generationId, vaultId }),
      [
        { at: now, type: "begin-write" },
        {
          at: now,
          objectByteLength: 240,
          objectChecksum,
          type: "verify-local",
        },
        { at: now, provider: "icloud", type: "queue-upload" },
        { at: now, claimId: effectId, type: "claim-upload" },
      ],
    );
    expect(
      reduceBackupAttempt(uploading, {
        at: later,
        claimId: secondEffectId,
        remoteObjectId: "provider-object-123",
        remoteObjectPath: getGenerationObjectPath(manifest()),
        type: "record-upload",
      }).isOk(),
    ).toBe(false);
    expect(
      reduceBackupAttempt(uploading, {
        at: later,
        claimId: effectId,
        remoteObjectId: "provider-object-123",
        remoteObjectPath: "vaults/wrong/generation.lena",
        type: "record-upload",
      }).isOk(),
    ).toBe(false);
    expect(
      reduceBackupAttempt(remoteUploadedAttempt(), {
        at: later,
        claimId: secondEffectId,
        receipt: remoteReceipt(),
        type: "verify-remote",
      }).isOk(),
    ).toBe(false);

    const persisted = parseBackupAttempt(JSON.parse(JSON.stringify(remoteUploadedAttempt())));
    if (persisted.isErr()) throw persisted.error;
    expect(
      reduceBackupAttempt(persisted.value, {
        at: later,
        claimId: effectId,
        receipt: remoteReceipt(),
        type: "verify-remote",
      }).isOk(),
    ).toBe(false);
  });

  test("rejects a receipt with any mismatched generation field", () => {
    const { effectId, later, otherObjectChecksum, otherVaultId, secondGenerationId } = fixtures();
    for (const receipt of [
      remoteReceipt({ objectByteLength: 239 }),
      remoteReceipt({ objectChecksum: otherObjectChecksum }),
      remoteReceipt({ generationId: secondGenerationId }),
      remoteReceipt({ provider: "google-drive" }),
      remoteReceipt({ providerObjectId: "wrong-object" }),
      remoteReceipt({ vaultId: otherVaultId }),
    ]) {
      expect(
        reduceBackupAttempt(remoteUploadedAttempt(), {
          at: later,
          claimId: effectId,
          receipt,
          type: "verify-remote",
        }).isOk(),
      ).toBe(false);
    }
  });

  test("retry releases stale upload ownership and reacquires a claim", () => {
    const { later } = fixtures();
    const failed = reduceBackupAttempt(remoteUploadedAttempt(), {
      at: later,
      failureCode: "network-unavailable",
      type: "fail",
    });
    if (failed.isErr()) return;
    const retried = reduceBackupAttempt(failed.value, { at: later, type: "retry" });
    expect(retried.isOk()).toBe(true);
    if (retried.isErr()) return;
    expect(retried.value.state).toBe("upload-pending");
    expect("claimId" in retried.value).toBe(false);
  });

  test("rejects skipped local verification and arbitrary failure codes", () => {
    const { generationId, now, vaultId } = fixtures();
    const attempt = createBackupAttempt({ createdAt: now, generationId, vaultId });
    expect(
      reduceBackupAttempt(attempt, { at: now, provider: "icloud", type: "queue-upload" }).isOk(),
    ).toBe(false);
    expect(
      reduceBackupAttempt(attempt, {
        at: now,
        failureCode: "raw-provider-message",
        type: "fail",
      } as unknown as BackupAttemptEvent).isOk(),
    ).toBe(false);
  });

  test("strictly parses durable states and rejects cross-generation verification", () => {
    const { effectId, later, secondGenerationId } = fixtures();
    const verified = reduceBackupAttempt(remoteUploadedAttempt(), {
      at: later,
      claimId: effectId,
      receipt: remoteReceipt(),
      type: "verify-remote",
    });
    if (verified.isErr()) return;
    expect(parseBackupAttempt(JSON.parse(JSON.stringify(verified.value))).isOk()).toBe(true);
    expect(
      parseBackupAttempt({
        ...verified.value,
        generationId: secondGenerationId,
      }).isOk(),
    ).toBe(false);
    expect(parseBackupAttempt({ ...verified.value, rawError: "secret" }).isOk()).toBe(false);
  });

  test("rejects events older than the durable backup checkpoint", () => {
    const { generationId, later, now, vaultId } = fixtures();
    const result = reduceBackupAttempt(
      createBackupAttempt({ createdAt: later, generationId, vaultId }),
      { at: now, type: "begin-write" },
    );
    expect(result.isOk()).toBe(false);
    if (result.isErr()) expect(result.error.code).toBe("invalid_timestamp");
  });

  test("property: checkpoint time is monotonic and stale events never mutate state", () => {
    const { generationId, now, vaultId } = fixtures();
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 86_400_000 }), (millisecondsEarlier) => {
        const earlier = parseIsoTimestamp(
          new Date(Date.parse(now) - millisecondsEarlier).toISOString(),
        );
        expect(earlier.isOk()).toBe(true);
        if (earlier.isErr()) return;

        const attempt = createBackupAttempt({ createdAt: now, generationId, vaultId });
        const before = JSON.stringify(attempt);
        const result = reduceBackupAttempt(attempt, {
          at: earlier.value,
          type: "begin-write",
        });

        expect(result.isErr()).toBe(true);
        if (result.isOk()) return;
        expect(result.error.code).toBe("invalid_timestamp");
        expect(JSON.stringify(attempt)).toBe(before);
        expect(attempt.state).toBe("prepared");
      }),
      { numRuns: 100 },
    );
  });
});

describe("discovery", () => {
  test("orders by generation time, not local existence", () => {
    const older = manifest({ completedAt: NOW_TEXT });
    const newer = manifest({
      completedAt: LATER_TEXT,
      generationId: SECOND_GENERATION_UUID,
    });
    const candidates: GenerationCandidate[] = [
      localCandidate(older),
      { ...localCandidate(newer), source: "icloud" },
    ];
    expect(orderGenerationCandidates(candidates)[0]?.source).toBe("icloud");
  });

  test("requires exact branded verification and schema compatibility", () => {
    const { compatibility, objectChecksum, vaultId } = fixtures();
    const candidate = localCandidate();
    expect(validateRestoreCandidate(candidate, compatibility, vaultId).isOk()).toBe(true);
    expect(
      validateRestoreCandidate({ ...candidate, verification: null }, compatibility, vaultId).isOk(),
    ).toBe(false);
    const wrongVerification = localCandidate(
      manifest({ generationId: SECOND_GENERATION_UUID }),
    ).verification;
    expect(
      validateRestoreCandidate(
        { ...candidate, verification: wrongVerification },
        compatibility,
        vaultId,
      ).isOk(),
    ).toBe(false);
    expect(candidate.manifest.payload.contentChecksum).not.toBe(
      candidate.verification?.objectChecksum,
    );

    const persisted = createPersistedLocalVerificationClaim({
      generationId: candidate.manifest.generationId,
      objectByteLength: 240,
      objectChecksum,
      verifiedAt: candidate.manifest.completedAt,
      vaultId: candidate.manifest.vaultId,
    });
    if (persisted.isErr()) throw persisted.error;
    expect(
      validateRestoreCandidate(
        {
          ...candidate,
          verification: persisted.value as unknown as GenerationCandidate["verification"],
        },
        compatibility,
        vaultId,
      ).isOk(),
    ).toBe(false);
  });

  test("scopes remote verification to its provider", () => {
    const { compatibility, effectId, later, vaultId } = fixtures();
    const verified = reduceBackupAttempt(remoteUploadedAttempt(), {
      at: later,
      claimId: effectId,
      receipt: remoteReceipt(),
      type: "verify-remote",
    });
    if (verified.isErr() || verified.value.state !== "verified") return;
    const remoteCandidate: GenerationCandidate = {
      available: true,
      manifest: manifest(),
      source: "icloud",
      verification: verified.value.verification,
    };
    expect(validateRestoreCandidate(remoteCandidate, compatibility, vaultId).isOk()).toBe(true);
    expect(
      validateRestoreCandidate(
        { ...remoteCandidate, source: "google-drive" },
        compatibility,
        vaultId,
      ).isOk(),
    ).toBe(false);
  });

  test("rejects restore into a different logical vault", () => {
    const { compatibility, otherVaultId } = fixtures();
    const result = validateRestoreCandidate(localCandidate(), compatibility, otherVaultId);
    expect(result.isOk()).toBe(false);
    if (result.isErr()) expect(result.error.code).toBe("conflict");
  });
});

describe("staged restore", () => {
  test("supports fresh-device restore with no previous physical pointer", () => {
    const { later, now, stagingInstanceId } = fixtures();
    const candidate = validatedCandidate();
    const generationBinding = binding(candidate);
    const restored = applyRestoreEvents(
      restoreAttempt({ candidate, discoveredAt: now, previousInstanceId: null }),
      [
        { at: now, type: "begin-staging" },
        { at: now, type: "record-decrypted" },
        { at: now, binding: generationBinding, type: "record-manifest-valid" },
        {
          at: now,
          binding: generationBinding,
          stagingInstanceId,
          type: "record-vault-built",
        },
        { at: now, type: "record-ready" },
        { at: now, type: "begin-activation" },
        { activeInstanceId: stagingInstanceId, at: later, type: "record-activated" },
        {
          activeInstanceId: stagingInstanceId,
          at: later,
          binding: generationBinding,
          type: "record-post-open-verified",
        },
      ],
    );
    expect(restored.state).toBe("verified");
    expect(restored.previousInstanceId).toBeNull();
  });

  test("rejects serialized or copied restore authorization", () => {
    const { now } = fixtures();
    const validated = validatedCandidate();
    const copied = { ...validated } as ValidatedRestoreCandidate;
    expect(
      createRestoreAttempt({
        candidate: copied,
        discoveredAt: now,
        previousInstanceId: null,
      }).isOk(),
    ).toBe(false);
    const serialized = JSON.parse(JSON.stringify(validated)) as ValidatedRestoreCandidate;
    expect(
      createRestoreAttempt({
        candidate: serialized,
        discoveredAt: now,
        previousInstanceId: null,
      }).isOk(),
    ).toBe(false);
  });

  test("rejects wrong generation bindings at both manifest and post-open checks", () => {
    const { later, now, previousInstanceId, secondGenerationId, stagingInstanceId } = fixtures();
    const candidate = validatedCandidate();
    const generationBinding = binding(candidate);
    const wrongBinding = { ...generationBinding, generationId: secondGenerationId };
    const decrypted = applyRestoreEvents(
      restoreAttempt({ candidate, discoveredAt: now, previousInstanceId }),
      [
        { at: now, type: "begin-staging" },
        { at: now, type: "record-decrypted" },
      ],
    );
    expect(
      reduceRestoreAttempt(decrypted, {
        at: now,
        binding: wrongBinding,
        type: "record-manifest-valid",
      }).isOk(),
    ).toBe(false);

    const activated = applyRestoreEvents(decrypted, [
      { at: now, binding: generationBinding, type: "record-manifest-valid" },
      {
        at: now,
        binding: generationBinding,
        stagingInstanceId,
        type: "record-vault-built",
      },
      { at: now, type: "record-ready" },
      { at: now, type: "begin-activation" },
      { activeInstanceId: stagingInstanceId, at: later, type: "record-activated" },
    ]);
    expect(
      reduceRestoreAttempt(activated, {
        activeInstanceId: stagingInstanceId,
        at: later,
        binding: wrongBinding,
        type: "record-post-open-verified",
      }).isOk(),
    ).toBe(false);
  });

  test("never stages over the previous physical instance", () => {
    const { now, previousInstanceId } = fixtures();
    const candidate = validatedCandidate();
    const generationBinding = binding(candidate);
    const manifestValidated = applyRestoreEvents(
      restoreAttempt({ candidate, discoveredAt: now, previousInstanceId }),
      [
        { at: now, type: "begin-staging" },
        { at: now, type: "record-decrypted" },
        { at: now, binding: generationBinding, type: "record-manifest-valid" },
      ],
    );
    expect(
      reduceRestoreAttempt(manifestValidated, {
        at: now,
        binding: generationBinding,
        stagingInstanceId: previousInstanceId,
        type: "record-vault-built",
      }).isOk(),
    ).toBe(false);
  });

  test("persists uncertain activation and retries rollback", () => {
    const { now, previousInstanceId, stagingInstanceId } = fixtures();
    const candidate = validatedCandidate();
    const generationBinding = binding(candidate);
    const activating = applyRestoreEvents(
      restoreAttempt({ candidate, discoveredAt: now, previousInstanceId }),
      [
        { at: now, type: "begin-staging" },
        { at: now, type: "record-decrypted" },
        { at: now, binding: generationBinding, type: "record-manifest-valid" },
        {
          at: now,
          binding: generationBinding,
          stagingInstanceId,
          type: "record-vault-built",
        },
        { at: now, type: "record-ready" },
        { at: now, type: "begin-activation" },
      ],
    );
    const unknown = reduceRestoreAttempt(activating, {
      at: now,
      failureCode: "activation-outcome-unknown",
      type: "record-active-pointer-unknown",
    });
    expect(unknown.isOk()).toBe(true);
    if (unknown.isErr()) return;
    expect(unknown.value.state).toBe("active-pointer-unknown");
    expect(parseRestoreAttempt(JSON.parse(JSON.stringify(unknown.value))).isOk()).toBe(true);
    const rollingBack = reduceRestoreAttempt(unknown.value, {
      at: now,
      type: "begin-rollback",
    });
    expect(rollingBack.isOk()).toBe(true);
  });

  test("makes rollback failure durable and retryable", () => {
    const { now, previousInstanceId, stagingInstanceId } = fixtures();
    const candidate = validatedCandidate();
    const generationBinding = binding(candidate);
    const rollingBack = applyRestoreEvents(
      restoreAttempt({ candidate, discoveredAt: now, previousInstanceId }),
      [
        { at: now, type: "begin-staging" },
        { at: now, type: "record-decrypted" },
        { at: now, binding: generationBinding, type: "record-manifest-valid" },
        {
          at: now,
          binding: generationBinding,
          stagingInstanceId,
          type: "record-vault-built",
        },
        { at: now, type: "record-ready" },
        { at: now, type: "begin-activation" },
        { at: now, type: "begin-rollback" },
      ],
    );
    const failed = reduceRestoreAttempt(rollingBack, {
      at: now,
      type: "record-rollback-failed",
    });
    expect(failed.isOk()).toBe(true);
    if (failed.isErr()) return;
    expect(failed.value.state).toBe("rollback-failed");
    expect(parseRestoreAttempt(JSON.parse(JSON.stringify(failed.value))).isOk()).toBe(true);
    expect(reduceRestoreAttempt(failed.value, { at: now, type: "begin-rollback" }).isOk()).toBe(
      true,
    );
  });

  test("confirms rollback restored the exact previous physical pointer", () => {
    const { now, previousInstanceId, stagingInstanceId } = fixtures();
    const candidate = validatedCandidate();
    const generationBinding = binding(candidate);
    const createRollingBack = (previous: typeof previousInstanceId | null) =>
      applyRestoreEvents(
        restoreAttempt({ candidate, discoveredAt: now, previousInstanceId: previous }),
        [
          { at: now, type: "begin-staging" },
          { at: now, type: "record-decrypted" },
          { at: now, binding: generationBinding, type: "record-manifest-valid" },
          {
            at: now,
            binding: generationBinding,
            stagingInstanceId,
            type: "record-vault-built",
          },
          { at: now, type: "record-ready" },
          { at: now, type: "begin-activation" },
          { at: now, type: "begin-rollback" },
        ],
      );

    expect(
      reduceRestoreAttempt(createRollingBack(previousInstanceId), {
        activeInstanceId: null,
        at: now,
        type: "record-rolled-back",
      }).isOk(),
    ).toBe(false);
    expect(
      reduceRestoreAttempt(createRollingBack(previousInstanceId), {
        activeInstanceId: previousInstanceId,
        at: now,
        type: "record-rolled-back",
      }).isOk(),
    ).toBe(true);
    expect(
      reduceRestoreAttempt(createRollingBack(null), {
        activeInstanceId: null,
        at: now,
        type: "record-rolled-back",
      }).isOk(),
    ).toBe(true);
  });

  test("allows enumerated pre-activation failure but rejects raw errors", () => {
    const { now } = fixtures();
    const staged = reduceRestoreAttempt(
      restoreAttempt({
        candidate: validatedCandidate(),
        discoveredAt: now,
        previousInstanceId: null,
      }),
      { at: now, type: "begin-staging" },
    );
    if (staged.isErr()) return;
    const failed = reduceRestoreAttempt(staged.value, {
      at: now,
      failureCode: "decryption-failed",
      type: "fail",
    });
    expect(failed.isOk()).toBe(true);
    if (failed.isErr() || failed.value.state !== "failed") return;
    expect(failed.value.activePointerState).toBe("unchanged");
    expect(
      reduceRestoreAttempt(staged.value, {
        at: now,
        failureCode: "wrong_key_or_corrupt raw provider text",
        type: "fail",
      } as unknown as RestoreEvent).isOk(),
    ).toBe(false);
  });

  test("rejects events older than the durable restore checkpoint", () => {
    const { later, now } = fixtures();
    const result = reduceRestoreAttempt(
      restoreAttempt({
        candidate: validatedCandidate(),
        discoveredAt: later,
        previousInstanceId: null,
      }),
      { at: now, type: "begin-staging" },
    );
    expect(result.isOk()).toBe(false);
    if (result.isErr()) expect(result.error.code).toBe("invalid_timestamp");
  });
});

describe("retention", () => {
  test("validates all retention policy counts", () => {
    expect(validateRetentionPolicy({ daily: 7, monthly: 12, recent: 3 }).isOk()).toBe(true);
    expect(validateRetentionPolicy({ daily: -1, monthly: 12, recent: 3 }).isOk()).toBe(false);
    expect(validateRetentionPolicy({ daily: 1.5, monthly: 12, recent: 3 }).isOk()).toBe(false);
    expect(validateRetentionPolicy({ daily: 10_001, monthly: 12, recent: 3 }).isOk()).toBe(false);
    expect(
      validateRetentionPolicy({ daily: 7, monthly: 12 } as unknown as {
        daily: number;
        monthly: number;
        recent: number;
      }).isOk(),
    ).toBe(false);
    expect(
      validateRetentionPolicy({ daily: 7, hourly: 12, monthly: 12, recent: 3 } as unknown as {
        daily: number;
        monthly: number;
        recent: number;
      }).isOk(),
    ).toBe(false);
  });

  test("never deletes the only verified generation without an LKG", () => {
    const generation = manifest({ completedAt: NOW_TEXT });
    const verification = runtimeLocalVerification(generation);
    const plan = planGenerationRetention(
      [
        {
          completedAt: generation.completedAt,
          generationId: generation.generationId,
          pinned: false,
          reason: "mutation",
          vaultId: generation.vaultId,
          verification,
        },
      ],
      { daily: 0, monthly: 0, recent: 0 },
      null,
    );
    expect(plan.isOk()).toBe(true);
    if (plan.isErr()) return;
    expect(plan.value.delete).toEqual([]);
    expect(plan.value.keep).toEqual([generation.generationId]);
  });

  test("keeps newest verified and matching LKG before deleting older data", () => {
    const oldest = manifest({ completedAt: NOW_TEXT });
    const middle = manifest({ completedAt: LATER_TEXT, generationId: SECOND_GENERATION_UUID });
    const newest = manifest({ completedAt: LATEST_TEXT, generationId: THIRD_GENERATION_UUID });
    const oldestVerification = runtimeLocalVerification(oldest);
    const middleVerification = runtimeLocalVerification(middle);
    const newestVerification = runtimeLocalVerification(newest);
    const plan = planGenerationRetention(
      [
        {
          completedAt: newest.completedAt,
          generationId: newest.generationId,
          pinned: false,
          reason: "mutation",
          vaultId: newest.vaultId,
          verification: newestVerification,
        },
        {
          completedAt: middle.completedAt,
          generationId: middle.generationId,
          pinned: false,
          reason: "daily",
          vaultId: middle.vaultId,
          verification: middleVerification,
        },
        {
          completedAt: oldest.completedAt,
          generationId: oldest.generationId,
          pinned: false,
          reason: "manual",
          vaultId: oldest.vaultId,
          verification: oldestVerification,
        },
      ],
      { daily: 0, monthly: 0, recent: 0 },
      oldestVerification,
    );
    expect(plan.isOk()).toBe(true);
    if (plan.isErr()) return;
    expect(plan.value.keep).toContain(newest.generationId);
    expect(plan.value.keep).toContain(oldest.generationId);
    expect(plan.value.delete).toEqual([middle.generationId]);
  });

  test("refuses cleanup without a verified matching LKG", () => {
    const older = manifest({ completedAt: NOW_TEXT });
    const newer = manifest({ completedAt: LATER_TEXT, generationId: SECOND_GENERATION_UUID });
    const olderVerification = runtimeLocalVerification(older);
    const newerVerification = runtimeLocalVerification(newer);
    const generations = [
      {
        completedAt: newer.completedAt,
        generationId: newer.generationId,
        pinned: false,
        reason: "mutation" as const,
        vaultId: newer.vaultId,
        verification: newerVerification,
      },
      {
        completedAt: older.completedAt,
        generationId: older.generationId,
        pinned: false,
        reason: "daily" as const,
        vaultId: older.vaultId,
        verification: olderVerification,
      },
    ];
    expect(
      planGenerationRetention(generations, { daily: 0, monthly: 0, recent: 0 }, null).isOk(),
    ).toBe(false);
    expect(
      planGenerationRetention(
        generations,
        { daily: 0, monthly: 0, recent: 0 },
        runtimeLocalVerification(manifest({ vaultId: OTHER_VAULT_UUID })),
      ).isOk(),
    ).toBe(false);
    expect(
      planGenerationRetention(
        generations.map((item) =>
          item.generationId === older.generationId
            ? {
                completedAt: item.completedAt,
                generationId: item.generationId,
                pinned: item.pinned,
                reason: item.reason,
                vaultId: item.vaultId,
                verification: null,
              }
            : item,
        ),
        { daily: 0, monthly: 0, recent: 0 },
        olderVerification,
      ).isOk(),
    ).toBe(false);
  });

  test("refuses mixed-vault and duplicate inventories", () => {
    const sameVault = manifest({ completedAt: NOW_TEXT });
    const otherVault = manifest({
      completedAt: NOW_TEXT,
      generationId: SECOND_GENERATION_UUID,
      vaultId: OTHER_VAULT_UUID,
    });
    const sameVerification = runtimeLocalVerification(sameVault);
    const otherVerification = runtimeLocalVerification(otherVault);
    const sameRecord = {
      completedAt: sameVault.completedAt,
      generationId: sameVault.generationId,
      pinned: false,
      reason: "mutation" as const,
      vaultId: sameVault.vaultId,
      verification: sameVerification,
    };
    expect(
      planGenerationRetention(
        [
          sameRecord,
          {
            completedAt: otherVault.completedAt,
            generationId: otherVault.generationId,
            pinned: false,
            reason: "mutation",
            vaultId: otherVault.vaultId,
            verification: otherVerification,
          },
        ],
        { daily: 1, monthly: 1, recent: 1 },
        null,
      ).isOk(),
    ).toBe(false);
    expect(
      planGenerationRetention(
        [sameRecord, sameRecord],
        { daily: 1, monthly: 1, recent: 1 },
        null,
      ).isOk(),
    ).toBe(false);
  });

  test("rejects persisted evidence and copied plans as deletion authority", () => {
    const older = manifest({ completedAt: NOW_TEXT });
    const newer = manifest({ completedAt: LATER_TEXT, generationId: SECOND_GENERATION_UUID });
    const olderVerification = runtimeLocalVerification(older);
    const newerVerification = runtimeLocalVerification(newer);
    const parsed = parsePersistedGenerationVerificationClaim(
      JSON.parse(JSON.stringify(olderVerification)),
    );
    expect(parsed.isOk()).toBe(true);
    if (parsed.isErr()) return;
    expect(isRuntimeVerifiedGeneration(parsed.value)).toBe(false);
    const forged = parsed.value as unknown as ReturnType<typeof runtimeLocalVerification>;
    expect(
      planGenerationRetention(
        [
          {
            completedAt: newer.completedAt,
            generationId: newer.generationId,
            pinned: false,
            reason: "mutation",
            vaultId: newer.vaultId,
            verification: newerVerification,
          },
          {
            completedAt: older.completedAt,
            generationId: older.generationId,
            pinned: false,
            reason: "daily",
            vaultId: older.vaultId,
            verification: forged,
          },
        ],
        { daily: 0, monthly: 0, recent: 0 },
        forged,
      ).isOk(),
    ).toBe(false);

    const authorized = planGenerationRetention(
      [
        {
          completedAt: newer.completedAt,
          generationId: newer.generationId,
          pinned: false,
          reason: "mutation",
          vaultId: newer.vaultId,
          verification: newerVerification,
        },
        {
          completedAt: older.completedAt,
          generationId: older.generationId,
          pinned: false,
          reason: "daily",
          vaultId: older.vaultId,
          verification: olderVerification,
        },
      ],
      { daily: 0, monthly: 0, recent: 0 },
      newerVerification,
    );
    expect(authorized.isOk()).toBe(true);
    if (authorized.isErr()) return;
    expect(isAuthorizedRetentionPlan(authorized.value)).toBe(true);
    expect(isAuthorizedRetentionPlan({ ...authorized.value })).toBe(false);
  });
});
