import { describe, expect, test } from "bun:test";
import {
  createPersistedLocalVerificationClaim,
  getGenerationObjectPath,
  parseGenerationManifest,
  parsePersistedGenerationVerificationClaim,
  parseSha256Checksum,
  type VerifiedGeneration,
} from "@lena/backup";
import { ok, parseEffectId, parseIsoTimestamp } from "@lena/core";
import {
  createRuntimeLocalVerifiedGeneration,
  createRuntimeRemoteObjectReceipt,
  createRuntimeRemoteVerifiedGeneration,
} from "../../../backup/src/runtime-evidence";
import {
  createManualBackupExportDescriptor,
  createManualBackupImportAttempt,
  LENA_BACKUP_MEDIA_TYPE,
  parseManualBackupFileName,
  preflightManualBackupImport,
  reduceManualBackupImportAttempt,
  validateManualBackupFileIdentity,
} from "../../src/index";

const GENERATION_UUID = "018f3f5a-1d2c-7abc-8def-2123456789ab";
const CLAIM_UUID = "018f3f5a-1d2c-7abc-8def-3123456789ab";
const LOCAL_CIPHERTEXT_URI = "file:///verified/manual-generation.lena";

function manifest() {
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
    generationId: GENERATION_UUID,
    parentGenerationId: null,
    payload: {
      attachmentByteLength: 0,
      attachmentCount: 0,
      contentByteLength: 100,
      contentChecksum: `sha256:${"a".repeat(64)}`,
      recordCounts: { entries: 1 },
    },
    reason: "manual",
    schemaVersion: 1,
    vaultId: "018f3f5a-1d2c-7abc-8def-0123456789ab",
  });
  if (parsed.isErr()) throw parsed.error;
  return parsed.value;
}

function verification() {
  const generation = manifest();
  const checksum = parseSha256Checksum(`sha256:${"b".repeat(64)}`);
  const verifiedAt = parseIsoTimestamp("2026-09-01T08:17:30.000Z");
  if (checksum.isErr() || verifiedAt.isErr()) throw new Error("Invalid verification fixture");
  const verified = createRuntimeLocalVerifiedGeneration({
    generationId: generation.generationId,
    localCiphertextUri: LOCAL_CIPHERTEXT_URI,
    objectByteLength: 148,
    objectChecksum: checksum.value,
    verifiedAt: verifiedAt.value,
    vaultId: generation.vaultId,
  });
  if (verified.isErr()) throw verified.error;
  return verified.value;
}

function remoteVerification(): VerifiedGeneration {
  const generation = manifest();
  const checksum = parseSha256Checksum(`sha256:${"b".repeat(64)}`);
  const claimId = parseEffectId(CLAIM_UUID);
  const verifiedAt = parseIsoTimestamp("2026-09-01T08:17:30.000Z");
  if (checksum.isErr() || claimId.isErr() || verifiedAt.isErr()) throw new Error("Invalid fixture");
  const receipt = createRuntimeRemoteObjectReceipt({
    claimId: claimId.value,
    generationId: generation.generationId,
    objectByteLength: 148,
    objectChecksum: checksum.value,
    provider: "icloud",
    providerObjectId: "opaque-object-id",
    providerObjectPath: getGenerationObjectPath(generation),
    verifiedAt: verifiedAt.value,
    vaultId: generation.vaultId,
  });
  if (receipt.isErr()) throw receipt.error;
  const remote = createRuntimeRemoteVerifiedGeneration({
    activeClaimId: claimId.value,
    expectedGenerationId: generation.generationId,
    expectedObjectByteLength: 148,
    expectedObjectChecksum: checksum.value,
    expectedProvider: "icloud",
    expectedProviderObjectId: "opaque-object-id",
    expectedProviderObjectPath: getGenerationObjectPath(generation),
    expectedVaultId: generation.vaultId,
    receipt: receipt.value,
  });
  if (remote.isErr()) throw remote.error;
  return remote.value;
}

describe("manual backup", () => {
  test("exports only the encrypted generation artifact", () => {
    const descriptor = createManualBackupExportDescriptor(manifest(), verification());
    expect(descriptor.isOk()).toBe(true);
    if (descriptor.isErr()) return;
    expect(descriptor.value.encrypted).toBe(true);
    expect(descriptor.value.mediaType).toBe(LENA_BACKUP_MEDIA_TYPE);
    expect(descriptor.value.objectByteLength).toBe(148);
    expect(descriptor.value.sourceCiphertextUri).toBe(LOCAL_CIPHERTEXT_URI);
    expect(descriptor.value.suggestedFileName).toBe(`lena-backup-20260901-${GENERATION_UUID}.lena`);
  });

  test("requires local verification of the exact export artifact", () => {
    const local = verification();
    const persisted = createPersistedLocalVerificationClaim({
      generationId: local.generationId,
      objectByteLength: local.objectByteLength,
      objectChecksum: local.objectChecksum,
      verifiedAt: local.verifiedAt,
      vaultId: local.vaultId,
    });
    if (persisted.isErr()) throw persisted.error;
    expect(
      createManualBackupExportDescriptor(
        manifest(),
        persisted.value as unknown as VerifiedGeneration,
      ).isOk(),
    ).toBe(false);

    const parsed = parsePersistedGenerationVerificationClaim(JSON.parse(JSON.stringify(local)));
    if (parsed.isErr()) throw parsed.error;
    expect(
      createManualBackupExportDescriptor(
        manifest(),
        parsed.value as unknown as VerifiedGeneration,
      ).isOk(),
    ).toBe(false);

    expect(createManualBackupExportDescriptor(manifest(), remoteVerification()).isOk()).toBe(false);
    expect(
      createManualBackupExportDescriptor(manifest(), {
        ...local,
      } as unknown as VerifiedGeneration).isOk(),
    ).toBe(false);
  });

  test("preflights trusted shape before staging", () => {
    expect(
      preflightManualBackupImport({
        byteLength: 100,
        detectedEnvelopeVersion: 1,
        fileName: `lena-backup-20260901-${GENERATION_UUID}.lena`,
        mediaType: LENA_BACKUP_MEDIA_TYPE,
      }).isOk(),
    ).toBe(true);
  });

  test("rejects traversal, wrong type, empty, and oversized files", () => {
    const base = {
      byteLength: 100,
      detectedEnvelopeVersion: 1,
      fileName: `lena-backup-20260901-${GENERATION_UUID}.lena`,
      mediaType: LENA_BACKUP_MEDIA_TYPE,
    };
    expect(preflightManualBackupImport({ ...base, fileName: `../${base.fileName}` }).isOk()).toBe(
      false,
    );
    expect(preflightManualBackupImport({ ...base, mediaType: "application/json" }).isOk()).toBe(
      false,
    );
    expect(preflightManualBackupImport({ ...base, byteLength: 0 }).isOk()).toBe(false);
    expect(preflightManualBackupImport({ ...base, byteLength: 3_000_000_000 }).isOk()).toBe(false);
    expect(preflightManualBackupImport({ ...base, detectedEnvelopeVersion: 999 }).isOk()).toBe(
      false,
    );
    expect(
      preflightManualBackupImport({
        ...base,
        fileName: `lena-backup-99999999-${GENERATION_UUID}.lena`,
      }).isOk(),
    ).toBe(false);
    expect(
      preflightManualBackupImport({
        ...base,
        fileName: "lena-backup-20260901-aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa.lena",
      }).isOk(),
    ).toBe(false);
  });

  test("binds authenticated manifest identity to the manual filename", () => {
    const fileName = `lena-backup-20260901-${GENERATION_UUID}.lena`;
    expect(parseManualBackupFileName(fileName).isOk()).toBe(true);
    expect(validateManualBackupFileIdentity(fileName, manifest()).isOk()).toBe(true);
    expect(
      validateManualBackupFileIdentity(
        `lena-backup-20260902-${GENERATION_UUID}.lena`,
        manifest(),
      ).isOk(),
    ).toBe(false);
  });

  test("copies to staging before backup-core validation and rejects partial copies", () => {
    const selected = createManualBackupImportAttempt({
      byteLength: 100,
      detectedEnvelopeVersion: 1,
      fileName: `lena-backup-20260901-${GENERATION_UUID}.lena`,
      mediaType: null,
    });
    if (selected.isErr()) throw selected.error;
    const copying = reduceManualBackupImportAttempt(selected.value, { type: "begin-copy" });
    if (copying.isErr()) throw copying.error;
    expect(
      reduceManualBackupImportAttempt(copying.value, {
        byteLength: 99,
        stagingCiphertextUri: "file:///private/import.lena",
        type: "record-copy",
      }).isOk(),
    ).toBe(false);
    const copied = reduceManualBackupImportAttempt(copying.value, {
      byteLength: 100,
      stagingCiphertextUri: "file:///private/import.lena",
      type: "record-copy",
    });
    expect(copied.isOk() && copied.value.state).toBe("copied-to-staging");
  });

  test("cancellation is terminal and changes no vault state", () => {
    const selected = createManualBackupImportAttempt({
      byteLength: 100,
      detectedEnvelopeVersion: 1,
      fileName: `lena-backup-20260901-${GENERATION_UUID}.lena`,
      mediaType: LENA_BACKUP_MEDIA_TYPE,
    });
    if (selected.isErr()) throw selected.error;
    const cancelled = reduceManualBackupImportAttempt(selected.value, { type: "cancel" });
    expect(cancelled).toEqual(ok({ state: "cancelled" }));
    if (cancelled.isErr()) return;
    expect(reduceManualBackupImportAttempt(cancelled.value, { type: "begin-copy" }).isOk()).toBe(
      false,
    );
  });
});
