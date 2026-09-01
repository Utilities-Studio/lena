import { describe, expect, test } from "bun:test";
import {
  createBackupAttempt,
  createPersistedLocalVerificationClaim,
  getGenerationObjectPath,
  parseBackupAttempt,
  parseGenerationManifest,
  parseSha256Checksum,
  parsePersistedGenerationVerificationClaim,
  planGenerationRetention,
  reduceBackupAttempt,
  type BackupAttempt,
  type GenerationManifest,
  type VerifiedGeneration,
} from "@lena/backup";
import { parseEffectId, parseIsoTimestamp } from "@lena/core";
import {
  createRuntimeLocalVerifiedGeneration,
  createRuntimeRemoteObjectReceipt,
  createRuntimeRemoteVerifiedGeneration,
} from "../../../backup/src/runtime-evidence";
import {
  classifyGoogleDriveFailure,
  classifyUnknownGoogleDriveFailure,
  createGoogleDriveDeletePlan,
  createGoogleDriveDownloadPlan,
  createGoogleDriveImmutableUploadPlan,
  createGoogleDriveInspectPlan,
  createGoogleDriveListPlan,
  createGoogleDriveResumeUploadPlan,
  isAuthorizedGoogleDriveDeletePlan,
  isAuthorizedGoogleDriveImmutableUploadPlan,
  reconcileGoogleDriveUploadConflict,
  type GoogleDriveImmutableUploadPlan,
  type GoogleDriveResumableCheckpoint,
} from "../../src/index";

const VAULT_ID = "018f3f5a-1d2c-7abc-8def-0123456789ab";
const GENERATION_ID = "018f3f5a-1d2c-7abc-8def-2123456789ab";
const NEWER_GENERATION_ID = "018f3f5a-1d2c-7abc-8def-3123456789ab";
const CLAIM_ID = "018f3f5a-1d2c-7abc-8def-4123456789ab";
const SECOND_CLAIM_ID = "018f3f5a-1d2c-7abc-8def-5123456789ab";
const OBJECT_CHECKSUM_TEXT = `sha256:${"b".repeat(64)}`;

function manifest(overrides: Record<string, unknown> = {}): GenerationManifest {
  const parsed = parseGenerationManifest({
    applicationVersion: "1.0.0",
    completedAt: "2026-09-01T08:16:30.000Z",
    compatibleSchema: { maximum: 1, minimum: 1 },
    createdAt: "2026-09-01T08:15:30.000Z",
    encryption: {
      algorithm: "AES-256-GCM",
      envelopeVersion: 1,
      nonceByteLength: 12,
      tagByteLength: 16,
    },
    formatVersion: 1,
    generationId: GENERATION_ID,
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
    vaultId: VAULT_ID,
    ...overrides,
  });
  if (parsed.isErr()) throw parsed.error;
  return parsed.value;
}

function verificationFixtures(generation = manifest()) {
  const checksum = parseSha256Checksum(OBJECT_CHECKSUM_TEXT);
  const claimId = parseEffectId(CLAIM_ID);
  const secondClaimId = parseEffectId(SECOND_CLAIM_ID);
  const verifiedAt = parseIsoTimestamp("2026-09-01T08:17:30.000Z");
  if (checksum.isErr() || claimId.isErr() || secondClaimId.isErr() || verifiedAt.isErr()) {
    throw new Error("Invalid fixture");
  }
  const localCiphertextUri = `file:///verified/${generation.generationId}.lena`;
  const local = createRuntimeLocalVerifiedGeneration({
    generationId: generation.generationId,
    localCiphertextUri,
    objectByteLength: 148,
    objectChecksum: checksum.value,
    verifiedAt: verifiedAt.value,
    vaultId: generation.vaultId,
  });
  const remotePath = getGenerationObjectPath(generation);
  const receipt = createRuntimeRemoteObjectReceipt({
    claimId: claimId.value,
    generationId: generation.generationId,
    objectByteLength: 148,
    objectChecksum: checksum.value,
    provider: "google-drive",
    providerObjectId: "drive-object-1",
    providerObjectPath: remotePath,
    verifiedAt: verifiedAt.value,
    vaultId: generation.vaultId,
  });
  if (local.isErr() || receipt.isErr()) throw new Error("Invalid verification fixture");
  const remote = createRuntimeRemoteVerifiedGeneration({
    activeClaimId: claimId.value,
    expectedGenerationId: generation.generationId,
    expectedObjectByteLength: 148,
    expectedObjectChecksum: checksum.value,
    expectedProvider: "google-drive",
    expectedProviderObjectId: "drive-object-1",
    expectedProviderObjectPath: remotePath,
    expectedVaultId: generation.vaultId,
    receipt: receipt.value,
  });
  if (remote.isErr()) throw remote.error;
  return {
    claimId: claimId.value,
    local: local.value,
    localCiphertextUri,
    receipt: receipt.value,
    remote: remote.value,
    remotePath,
    secondClaimId: secondClaimId.value,
  };
}

function activeUploadAttempt(
  generation: GenerationManifest,
  verification: VerifiedGeneration,
  claimId: ReturnType<typeof verificationFixtures>["claimId"],
): BackupAttempt {
  const at = parseIsoTimestamp(generation.completedAt);
  if (at.isErr()) throw at.error;
  let attempt = createBackupAttempt({
    createdAt: generation.completedAt,
    generationId: generation.generationId,
    vaultId: generation.vaultId,
  });
  for (const event of [
    { at: at.value, type: "begin-write" as const },
    {
      at: at.value,
      objectByteLength: verification.objectByteLength,
      objectChecksum: verification.objectChecksum,
      type: "verify-local" as const,
    },
    { at: at.value, provider: "google-drive" as const, type: "queue-upload" as const },
    { at: at.value, claimId, type: "claim-upload" as const },
  ]) {
    const next = reduceBackupAttempt(attempt, event);
    if (next.isErr()) throw next.error;
    attempt = next.value;
  }
  return attempt;
}

function uploadPlan(generation = manifest()): GoogleDriveImmutableUploadPlan {
  const fixture = verificationFixtures(generation);
  const plan = createGoogleDriveImmutableUploadPlan(
    generation,
    fixture.local,
    activeUploadAttempt(generation, fixture.local, fixture.claimId),
  );
  if (plan.isErr()) throw plan.error;
  return plan.value;
}

function checkpoint(
  upload: GoogleDriveImmutableUploadPlan,
  overrides: Partial<GoogleDriveResumableCheckpoint> = {},
): GoogleDriveResumableCheckpoint {
  return {
    claimId: upload.claimId,
    committedByteLength: 100,
    expectedObjectByteLength: upload.expectedObjectByteLength,
    expectedObjectChecksum: upload.expectedObjectChecksum,
    generationId: upload.generationId,
    localCiphertextUri: upload.localCiphertextUri,
    remotePath: upload.remotePath,
    sessionId: "resumable-session-1",
    vaultId: upload.vaultId,
    ...overrides,
  };
}

describe("Google Drive transport protocol", () => {
  test("binds immutable upload to runtime-verified local ciphertext", () => {
    const generation = manifest();
    const fixture = verificationFixtures(generation);
    const attempt = activeUploadAttempt(generation, fixture.local, fixture.claimId);
    const plan = createGoogleDriveImmutableUploadPlan(generation, fixture.local, attempt);
    expect(plan.isOk()).toBe(true);
    if (plan.isErr()) return;
    expect(plan.value.localCiphertextUri).toBe(fixture.localCiphertextUri);
    expect(plan.value.requiredScope).toBe("drive.appdata");
    expect(isAuthorizedGoogleDriveImmutableUploadPlan(plan.value)).toBe(true);
    expect(isAuthorizedGoogleDriveImmutableUploadPlan({ ...plan.value })).toBe(false);
    expect(
      createGoogleDriveImmutableUploadPlan(generation, fixture.local, {
        ...attempt,
      } as BackupAttempt).isOk(),
    ).toBe(false);
    const persistedAttempt = parseBackupAttempt(JSON.parse(JSON.stringify(attempt)));
    if (persistedAttempt.isErr()) throw persistedAttempt.error;
    expect(
      createGoogleDriveImmutableUploadPlan(
        generation,
        fixture.local,
        persistedAttempt.value,
      ).isOk(),
    ).toBe(false);

    const persisted = createPersistedLocalVerificationClaim({
      generationId: generation.generationId,
      objectByteLength: 148,
      objectChecksum: plan.value.expectedObjectChecksum,
      verifiedAt: generation.completedAt,
      vaultId: generation.vaultId,
    });
    if (persisted.isErr()) throw persisted.error;
    expect(
      createGoogleDriveImmutableUploadPlan(
        generation,
        persisted.value as unknown as VerifiedGeneration,
        attempt,
      ).isOk(),
    ).toBe(false);
    expect(createGoogleDriveImmutableUploadPlan(generation, fixture.remote, attempt).isOk()).toBe(
      false,
    );
    const parsed = parsePersistedGenerationVerificationClaim(
      JSON.parse(JSON.stringify(fixture.local)),
    );
    if (parsed.isErr()) throw parsed.error;
    expect(
      createGoogleDriveImmutableUploadPlan(
        generation,
        parsed.value as unknown as VerifiedGeneration,
        attempt,
      ).isOk(),
    ).toBe(false);
  });

  test("resolves conflict only for the exact claimed provider object", () => {
    const generation = manifest();
    const fixture = verificationFixtures(generation);
    const plan = uploadPlan(generation);
    const target = {
      folder: "appDataFolder" as const,
      providerObjectId: "drive-object-1",
      remotePath: fixture.remotePath,
      requiredScope: "drive.appdata" as const,
    };
    expect(reconcileGoogleDriveUploadConflict(plan, target, fixture.receipt).isOk()).toBe(true);
    expect(
      reconcileGoogleDriveUploadConflict(
        { ...plan } as GoogleDriveImmutableUploadPlan,
        target,
        fixture.receipt,
      ).isOk(),
    ).toBe(false);
    expect(
      reconcileGoogleDriveUploadConflict(
        plan,
        { ...target, providerObjectId: "other-object" },
        fixture.receipt,
      ).isOk(),
    ).toBe(false);
    expect(
      reconcileGoogleDriveUploadConflict(
        plan,
        { ...target, remotePath: "vaults/wrong/generation.lena" },
        fixture.receipt,
      ).isOk(),
    ).toBe(false);
    const wrongClaimReceipt = createRuntimeRemoteObjectReceipt({
      ...fixture.receipt,
      claimId: fixture.secondClaimId,
    });
    if (wrongClaimReceipt.isErr()) throw wrongClaimReceipt.error;
    expect(reconcileGoogleDriveUploadConflict(plan, target, wrongClaimReceipt.value).isOk()).toBe(
      false,
    );
    const wrongProviderReceipt = createRuntimeRemoteObjectReceipt({
      ...fixture.receipt,
      provider: "icloud",
    });
    if (wrongProviderReceipt.isErr()) throw wrongProviderReceipt.error;
    expect(
      reconcileGoogleDriveUploadConflict(plan, target, wrongProviderReceipt.value).isOk(),
    ).toBe(false);
  });

  test("downloads and resumes only bounded exact operations", () => {
    const generation = manifest();
    const fixture = verificationFixtures(generation);
    expect(createGoogleDriveListPlan(generation.vaultId, { pageSize: 250 }).isOk()).toBe(true);
    expect(createGoogleDriveListPlan(generation.vaultId, { pageSize: 0 }).isOk()).toBe(false);
    expect(createGoogleDriveInspectPlan("drive-object-1").isOk()).toBe(true);
    const download = createGoogleDriveDownloadPlan(
      generation,
      fixture.remote,
      "file:///staging/download.lena",
    );
    expect(download.isOk()).toBe(true);
    if (download.isOk()) expect(isAuthorizedGoogleDriveDeletePlan(download.value)).toBe(false);

    const upload = uploadPlan(generation);
    const resume = createGoogleDriveResumeUploadPlan(upload, checkpoint(upload));
    expect(resume.isOk() && resume.value.remainingByteLength).toBe(48);
    expect(
      createGoogleDriveResumeUploadPlan(
        upload,
        checkpoint(upload, { committedByteLength: 149 }),
      ).isOk(),
    ).toBe(false);
    expect(
      createGoogleDriveResumeUploadPlan(
        upload,
        checkpoint(upload, { claimId: fixture.secondClaimId }),
      ).isOk(),
    ).toBe(false);
    expect(
      createGoogleDriveResumeUploadPlan(upload, checkpoint(upload, { remotePath: "wrong" })).isOk(),
    ).toBe(false);
    expect(
      createGoogleDriveResumeUploadPlan(
        { ...upload } as GoogleDriveImmutableUploadPlan,
        checkpoint(upload),
      ).isOk(),
    ).toBe(false);
  });

  test("does not resume a checkpoint from another upload", () => {
    const first = uploadPlan();
    const second = uploadPlan(
      manifest({
        completedAt: "2026-09-02T08:16:30.000Z",
        generationId: NEWER_GENERATION_ID,
      }),
    );
    expect(createGoogleDriveResumeUploadPlan(second, checkpoint(first)).isOk()).toBe(false);
  });

  test("deletes only with runtime verification and opaque retention authority", () => {
    const generation = manifest();
    const fixture = verificationFixtures(generation);
    const newer = manifest({
      completedAt: "2026-09-02T08:16:30.000Z",
      generationId: NEWER_GENERATION_ID,
    });
    const newerVerification = verificationFixtures(newer).local;
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
          verification: fixture.remote,
        },
      ],
      { daily: 0, monthly: 0, recent: 0 },
      newerVerification,
    );
    if (retention.isErr()) throw retention.error;
    const deletion = createGoogleDriveDeletePlan(generation, fixture.remote, retention.value);
    expect(deletion.isOk()).toBe(true);
    if (deletion.isErr()) return;
    expect(isAuthorizedGoogleDriveDeletePlan(deletion.value)).toBe(true);
    expect(isAuthorizedGoogleDriveDeletePlan({ ...deletion.value })).toBe(false);
    expect(
      createGoogleDriveDeletePlan(generation, fixture.remote, { ...retention.value }).isOk(),
    ).toBe(false);
  });

  test("keeps token and rate failures retryable and unknown codes fatal", () => {
    expect(classifyGoogleDriveFailure("token-expired")).toEqual({
      kind: "authentication-required",
      retryable: true,
      userActionRequired: true,
    });
    expect(classifyGoogleDriveFailure("rate-limited").retryable).toBe(true);
    expect(classifyUnknownGoogleDriveFailure("future-provider-code").kind).toBe("fatal");
  });
});
