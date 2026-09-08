import { describe, expect, test } from "bun:test";
import {
  createBackupAttempt,
  createPersistedLocalVerificationClaim,
  getGenerationObjectPath,
  parseGenerationManifest,
  parseBackupAttempt,
  parsePersistedRemoteObjectReceiptClaim,
  parseSha256Checksum,
  parsePersistedGenerationVerificationClaim,
  planGenerationRetention,
  reduceBackupAttempt,
  type BackupAttempt,
  type GenerationManifest,
  type RemoteObjectReceipt,
  type RemoteObjectReceiptInput,
  type RetentionPlan,
  type VerifiedGeneration,
} from "@lena/backup";
import { parseEffectId, parseIsoTimestamp } from "@lena/core";
import {
  createRuntimeLocalVerifiedGeneration,
  createRuntimeRemoteObjectReceipt,
  createRuntimeRemoteVerifiedGeneration,
} from "../../../backup/src/runtime-evidence";
import {
  classifyICloudFailure,
  classifyUnknownICloudFailure,
  createICloudDeletePlan,
  createICloudDownloadPlan,
  createICloudImmutableUploadPlan,
  createICloudInspectPlan,
  createICloudListPlan,
  isAuthorizedICloudDeletePlan,
  isAuthorizedICloudImmutableUploadPlan,
  reconcileICloudUploadConflict,
} from "../../src/index";

const VAULT_ID = "11111111-1111-4111-8111-111111111111";
const GENERATION_ID = "22222222-2222-4222-8222-222222222222";
const NEWER_GENERATION_ID = "33333333-3333-4333-8333-333333333333";
const CLAIM_ID = "44444444-4444-4444-8444-444444444444";
const OTHER_CLAIM_ID = "55555555-5555-4555-8555-555555555555";
const OBJECT_CHECKSUM_TEXT = `sha256:${"b".repeat(64)}`;
const LOCAL_CIPHERTEXT_URI = "file:///verified/generation.lena";

function manifest(
  overrides: Readonly<{
    completedAt?: string;
    createdAt?: string;
    generationId?: string;
  }> = {},
): GenerationManifest {
  const parsed = parseGenerationManifest({
    applicationVersion: "1.0.0",
    completedAt: overrides.completedAt ?? "2026-09-01T08:16:30.000Z",
    createdAt: overrides.createdAt ?? "2026-09-01T08:15:30.000Z",
    encryption: {
      algorithm: "AES-256-GCM",
      envelopeVersion: 1,
      nonceByteLength: 12,
      tagByteLength: 16,
    },
    formatVersion: 1,
    generationId: overrides.generationId ?? GENERATION_ID,
    parentGenerationId: null,
    payload: {
      attachmentByteLength: 0,
      attachmentCount: 0,
      contentByteLength: 100,
      contentChecksum: `sha256:${"a".repeat(64)}`,
      recordCounts: { entries: 1 },
    },
    reason: "mutation",
    schemaVersion: 1,
    snapshot: {
      commitSequence: 1,
      committedAt: overrides.createdAt ?? "2026-09-01T08:15:30.000Z",
      mutationId: "66666666-6666-4666-8666-666666666666",
      vaultInstanceId: "77777777-7777-4777-8777-777777777777",
    },
    vaultId: VAULT_ID,
  });
  if (parsed.isErr()) throw parsed.error;
  return parsed.value;
}

function objectChecksum() {
  const parsed = parseSha256Checksum(OBJECT_CHECKSUM_TEXT);
  if (parsed.isErr()) throw parsed.error;
  return parsed.value;
}

function effectId(value = CLAIM_ID) {
  const parsed = parseEffectId(value);
  if (parsed.isErr()) throw parsed.error;
  return parsed.value;
}

function verifiedAt(value = "2026-09-01T08:17:30.000Z") {
  const parsed = parseIsoTimestamp(value);
  if (parsed.isErr()) throw parsed.error;
  return parsed.value;
}

function runtimeLocalVerification(
  generation = manifest(),
  localCiphertextUri = LOCAL_CIPHERTEXT_URI,
  verificationTime = verifiedAt(),
): VerifiedGeneration {
  const verification = createRuntimeLocalVerifiedGeneration({
    generationId: generation.generationId,
    localCiphertextUri,
    objectByteLength: 148,
    objectChecksum: objectChecksum(),
    snapshot: generation.snapshot,
    verifiedAt: verificationTime,
    vaultId: generation.vaultId,
  });
  if (verification.isErr()) throw verification.error;
  return verification.value;
}

function runtimeReceipt(
  generation = manifest(),
  overrides: Partial<RemoteObjectReceiptInput> = {},
): RemoteObjectReceipt {
  const receipt = createRuntimeRemoteObjectReceipt({
    claimId: effectId(),
    generationId: generation.generationId,
    objectByteLength: 148,
    objectChecksum: objectChecksum(),
    provider: "icloud",
    providerObjectId: "icloud-object-1",
    providerObjectPath: getGenerationObjectPath(generation),
    verifiedAt: verifiedAt(),
    vaultId: generation.vaultId,
    ...overrides,
  });
  if (receipt.isErr()) throw receipt.error;
  return receipt.value;
}

function runtimeRemoteVerification(
  generation = manifest(),
  receipt = runtimeReceipt(generation),
): VerifiedGeneration {
  const verification = createRuntimeRemoteVerifiedGeneration({
    activeClaimId: receipt.claimId,
    expectedGenerationId: generation.generationId,
    expectedObjectByteLength: receipt.objectByteLength,
    expectedObjectChecksum: receipt.objectChecksum,
    expectedProvider: "icloud",
    expectedProviderObjectId: receipt.providerObjectId,
    expectedProviderObjectPath: receipt.providerObjectPath,
    expectedVaultId: generation.vaultId,
    receipt,
    sourceVerification: runtimeLocalVerification(generation),
  });
  if (verification.isErr()) throw verification.error;
  return verification.value;
}

function activeUploadAttempt(
  generation: GenerationManifest,
  verification: VerifiedGeneration,
): BackupAttempt {
  const at = verifiedAt();
  let attempt = createBackupAttempt({
    createdAt: generation.completedAt,
    generationId: generation.generationId,
    vaultId: generation.vaultId,
  });
  for (const event of [
    { at, type: "begin-write" as const },
    {
      at,
      objectByteLength: verification.objectByteLength,
      objectChecksum: verification.objectChecksum,
      type: "verify-local" as const,
    },
    { at, provider: "icloud" as const, type: "queue-upload" as const },
    { at, claimId: effectId(), type: "claim-upload" as const },
  ]) {
    const next = reduceBackupAttempt(attempt, event);
    if (next.isErr()) throw next.error;
    attempt = next.value;
  }
  return attempt;
}

function authorizedDeletionRetention(
  generation: GenerationManifest,
  verification: VerifiedGeneration,
): RetentionPlan {
  const newer = manifest({
    completedAt: "2026-09-02T08:16:30.000Z",
    createdAt: "2026-09-02T08:15:30.000Z",
    generationId: NEWER_GENERATION_ID,
  });
  const newerVerification = runtimeLocalVerification(
    newer,
    "file:///verified/newer-generation.lena",
    verifiedAt("2026-09-02T08:17:30.000Z"),
  );
  const retention = planGenerationRetention(
    [
      {
        completedAt: newer.completedAt,
        generationId: newer.generationId,
        pinned: false,
        reason: "daily",
        vaultId: newer.vaultId,
        verification: newerVerification,
      },
      {
        completedAt: generation.completedAt,
        generationId: generation.generationId,
        pinned: false,
        reason: generation.reason,
        vaultId: generation.vaultId,
        verification,
      },
    ],
    { daily: 0, monthly: 0, recent: 0 },
    newerVerification,
  );
  if (retention.isErr()) throw retention.error;
  return retention.value;
}

describe("iCloud transport protocol", () => {
  test("plans upload only from exact runtime local evidence", () => {
    const generation = manifest();
    const claimId = effectId();
    const local = runtimeLocalVerification(generation);
    const attempt = activeUploadAttempt(generation, local);
    const plan = createICloudImmutableUploadPlan(generation, local, attempt);
    expect(plan.isOk()).toBe(true);
    if (plan.isErr()) throw plan.error;
    expect(plan.value.conflictBehavior).toBe("verify-existing-exact-object");
    expect(plan.value.localCiphertextUri).toBe(LOCAL_CIPHERTEXT_URI);
    expect(plan.value.claimId).toBe(claimId);
    expect(plan.value.visibility).toBe("app-private");
    expect(plan.value.expectedObjectByteLength).toBe(148);
    expect(isAuthorizedICloudImmutableUploadPlan(plan.value)).toBe(true);
    expect(isAuthorizedICloudImmutableUploadPlan({ ...plan.value })).toBe(false);
    expect(createICloudImmutableUploadPlan(generation, local, { ...attempt }).isOk()).toBe(false);
    const persistedAttempt = parseBackupAttempt(JSON.parse(JSON.stringify(attempt)));
    if (persistedAttempt.isErr()) throw persistedAttempt.error;
    expect(createICloudImmutableUploadPlan(generation, local, persistedAttempt.value).isOk()).toBe(
      false,
    );
    expect(JSON.stringify(plan.value)).not.toContain("recordCounts");

    const forgedLocal = createPersistedLocalVerificationClaim({
      generationId: generation.generationId,
      objectByteLength: 148,
      objectChecksum: objectChecksum(),
      snapshot: generation.snapshot,
      verifiedAt: verifiedAt(),
      vaultId: generation.vaultId,
    });
    expect(forgedLocal.isOk()).toBe(true);
    if (forgedLocal.isOk()) {
      expect(
        createICloudImmutableUploadPlan(
          generation,
          forgedLocal.value as unknown as VerifiedGeneration,
          attempt,
        ).isOk(),
      ).toBe(false);
    }

    const parsedLocal = parsePersistedGenerationVerificationClaim(
      JSON.parse(JSON.stringify(local)),
    );
    expect(parsedLocal.isOk()).toBe(true);
    if (parsedLocal.isOk()) {
      expect(
        createICloudImmutableUploadPlan(
          generation,
          parsedLocal.value as unknown as VerifiedGeneration,
          attempt,
        ).isOk(),
      ).toBe(false);
    }

    expect(
      createICloudImmutableUploadPlan(
        generation,
        runtimeRemoteVerification(generation),
        attempt,
      ).isOk(),
    ).toBe(false);
  });

  test("reconciles a conflict only for the exact runtime receipt, target, path, and claim", () => {
    const generation = manifest();
    const receipt = runtimeReceipt(generation);
    const upload = createICloudImmutableUploadPlan(
      generation,
      runtimeLocalVerification(generation),
      activeUploadAttempt(generation, runtimeLocalVerification(generation)),
    );
    const target = createICloudInspectPlan(generation, receipt.providerObjectId);
    if (upload.isErr() || target.isErr()) throw new Error("Invalid conflict fixture");

    expect(reconcileICloudUploadConflict(upload.value, target.value, receipt).isOk()).toBe(true);

    const parsedReceipt = parsePersistedRemoteObjectReceiptClaim(
      JSON.parse(JSON.stringify(receipt)),
    );
    expect(parsedReceipt.isOk()).toBe(true);
    if (parsedReceipt.isOk()) {
      expect(
        reconcileICloudUploadConflict(
          upload.value,
          target.value,
          parsedReceipt.value as unknown as RemoteObjectReceipt,
        ).isOk(),
      ).toBe(false);
    }

    expect(
      reconcileICloudUploadConflict(
        upload.value,
        { ...target.value, providerObjectId: "icloud-object-other" },
        receipt,
      ).isOk(),
    ).toBe(false);
    expect(
      reconcileICloudUploadConflict(
        upload.value,
        { ...target.value, remotePath: `${target.value.remotePath}.wrong` },
        receipt,
      ).isOk(),
    ).toBe(false);
    expect(
      reconcileICloudUploadConflict(
        upload.value,
        target.value,
        runtimeReceipt(generation, { claimId: effectId(OTHER_CLAIM_ID) }),
      ).isOk(),
    ).toBe(false);
    expect(
      reconcileICloudUploadConflict(
        upload.value,
        target.value,
        runtimeReceipt(generation, {
          providerObjectPath: `${getGenerationObjectPath(generation)}.wrong`,
        }),
      ).isOk(),
    ).toBe(false);
  });

  test("lists read-only, inspects exact ids, and downloads runtime-verified objects to staging", () => {
    const generation = manifest();
    const list = createICloudListPlan(generation.vaultId);
    expect(list.isOk() && list.value.readOnly).toBe(true);
    expect(createICloudInspectPlan(generation, "icloud-object-1").isOk()).toBe(true);

    const remote = runtimeRemoteVerification(generation);
    const download = createICloudDownloadPlan(generation, remote, "file:///staging/download.lena");
    expect(download.isOk()).toBe(true);
    if (download.isErr()) throw download.error;
    expect(download.value.materializePlaceholder).toBe(true);
    expect(download.value.providerObjectId).toBe("icloud-object-1");
    expect(isAuthorizedICloudDeletePlan(download.value)).toBe(false);

    const parsedRemote = parsePersistedGenerationVerificationClaim(
      JSON.parse(JSON.stringify(remote)),
    );
    expect(parsedRemote.isOk()).toBe(true);
    if (parsedRemote.isOk()) {
      expect(
        createICloudDownloadPlan(
          generation,
          parsedRemote.value as unknown as VerifiedGeneration,
          "file:///staging/untrusted.lena",
        ).isOk(),
      ).toBe(false);
    }
  });

  test("deletes only with runtime verification and runtime-backed retention", () => {
    const generation = manifest();
    const remote = runtimeRemoteVerification(generation);
    const retention = authorizedDeletionRetention(generation, remote);
    const deletion = createICloudDeletePlan(generation, remote, retention);
    expect(deletion.isOk()).toBe(true);
    if (deletion.isOk()) {
      expect(isAuthorizedICloudDeletePlan(deletion.value)).toBe(true);
      expect(isAuthorizedICloudDeletePlan({ ...deletion.value })).toBe(false);
    }
    expect(createICloudDeletePlan(generation, remote, { ...retention }).isOk()).toBe(false);

    const parsedRemote = parsePersistedGenerationVerificationClaim(
      JSON.parse(JSON.stringify(remote)),
    );
    expect(parsedRemote.isOk()).toBe(true);
    if (parsedRemote.isOk()) {
      expect(
        createICloudDeletePlan(
          generation,
          parsedRemote.value as unknown as VerifiedGeneration,
          retention,
        ).isOk(),
      ).toBe(false);
    }

    const newer = manifest({
      completedAt: "2026-09-02T08:16:30.000Z",
      createdAt: "2026-09-02T08:15:30.000Z",
      generationId: NEWER_GENERATION_ID,
    });
    const newerRuntime = runtimeLocalVerification(
      newer,
      "file:///verified/newer-generation.lena",
      verifiedAt("2026-09-02T08:17:30.000Z"),
    );
    const parsedNewer = parsePersistedGenerationVerificationClaim(
      JSON.parse(JSON.stringify(newerRuntime)),
    );
    expect(parsedNewer.isOk()).toBe(true);
    if (parsedNewer.isOk()) {
      expect(
        planGenerationRetention(
          [
            {
              completedAt: newer.completedAt,
              generationId: newer.generationId,
              pinned: false,
              reason: "daily",
              vaultId: newer.vaultId,
              verification: parsedNewer.value as unknown as VerifiedGeneration,
            },
            {
              completedAt: generation.completedAt,
              generationId: generation.generationId,
              pinned: false,
              reason: generation.reason,
              vaultId: generation.vaultId,
              verification: remote,
            },
          ],
          { daily: 0, monthly: 0, recent: 0 },
          parsedNewer.value as unknown as VerifiedGeneration,
        ).isOk(),
      ).toBe(false);
    }

    const wrongPathReceipt = runtimeReceipt(generation, {
      providerObjectPath: `${getGenerationObjectPath(generation)}.wrong`,
    });
    const wrongPathRemote = runtimeRemoteVerification(generation, wrongPathReceipt);
    expect(createICloudDeletePlan(generation, wrongPathRemote, retention).isOk()).toBe(false);
  });

  test("classifies account, quota, and unknown runtime failures safely", () => {
    expect(classifyICloudFailure("account-changed")).toEqual({
      kind: "authentication-required",
      retryable: true,
      userActionRequired: true,
    });
    expect(classifyICloudFailure("quota").kind).toBe("quota-exceeded");
    expect(classifyUnknownICloudFailure("future-provider-code").kind).toBe("fatal");
  });
});
