import { describe, expect, test } from "bun:test";
import {
  parseEffectId,
  parseGenerationId,
  parseIsoTimestamp,
  parseMutationId,
  parseVaultId,
  parseVaultInstanceId,
} from "@lena/core";
import type { BackupOutboxRow, SyncVaultDatabase } from "@lena/vault";
import {
  backupCompletionClaimSchema,
  completeSyncBackupObligation,
  parseSha256Checksum,
} from "../../src/index";
import { createRuntimeLocalVerifiedGeneration } from "../../src/runtime-evidence";

const IDS = Object.freeze({
  claim: "00000000-0000-4000-8000-000000000004",
  generation: "00000000-0000-4000-8000-000000000003",
  snapshotMutation: "00000000-0000-4000-8000-000000000002",
  targetMutation: "00000000-0000-4000-8000-000000000005",
  vault: "00000000-0000-4000-8000-000000000000",
  vaultInstance: "00000000-0000-4000-8000-000000000001",
});
const TARGET_COMMITTED_AT = "2026-01-01T00:00:00.000Z";
const SNAPSHOT_COMMITTED_AT = "2026-01-01T00:00:01.000Z";
const CLAIMED_AT = "2026-01-01T00:00:02.000Z";
const VERIFIED_AT = "2026-01-01T00:00:03.000Z";

function fixtures() {
  const claimId = parseEffectId(IDS.claim);
  const generationId = parseGenerationId(IDS.generation);
  const snapshotMutationId = parseMutationId(IDS.snapshotMutation);
  const targetMutationId = parseMutationId(IDS.targetMutation);
  const vaultId = parseVaultId(IDS.vault);
  const vaultInstanceId = parseVaultInstanceId(IDS.vaultInstance);
  const targetCommittedAt = parseIsoTimestamp(TARGET_COMMITTED_AT);
  const snapshotCommittedAt = parseIsoTimestamp(SNAPSHOT_COMMITTED_AT);
  const claimedAt = parseIsoTimestamp(CLAIMED_AT);
  const verifiedAt = parseIsoTimestamp(VERIFIED_AT);
  const objectChecksum = parseSha256Checksum(`sha256:${"a".repeat(64)}`);
  if (
    claimId.isErr() ||
    generationId.isErr() ||
    snapshotMutationId.isErr() ||
    targetMutationId.isErr() ||
    vaultId.isErr() ||
    vaultInstanceId.isErr() ||
    targetCommittedAt.isErr() ||
    snapshotCommittedAt.isErr() ||
    claimedAt.isErr() ||
    verifiedAt.isErr() ||
    objectChecksum.isErr()
  ) {
    throw new Error("Invalid backup completion fixture");
  }
  return {
    claimId: claimId.value,
    claimedAt: claimedAt.value,
    generationId: generationId.value,
    objectChecksum: objectChecksum.value,
    snapshotCommittedAt: snapshotCommittedAt.value,
    snapshotMutationId: snapshotMutationId.value,
    targetCommittedAt: targetCommittedAt.value,
    targetMutationId: targetMutationId.value,
    vaultId: vaultId.value,
    vaultInstanceId: vaultInstanceId.value,
    verifiedAt: verifiedAt.value,
  };
}

function pendingRow(input: ReturnType<typeof fixtures>): BackupOutboxRow {
  return {
    attemptCount: 0,
    claimedAt: null,
    claimId: null,
    committedAt: input.snapshotCommittedAt,
    commitSequence: 2,
    completedAt: null,
    coveredCommitAt: null,
    createdAt: input.snapshotCommittedAt,
    generationId: null,
    lastFailureCode: null,
    mutationId: input.snapshotMutationId,
    state: "pending",
    vaultId: input.vaultId,
    vaultInstanceId: input.vaultInstanceId,
  };
}

function claimedRow(input: ReturnType<typeof fixtures>): BackupOutboxRow {
  return {
    attemptCount: 1,
    claimedAt: input.claimedAt,
    claimId: input.claimId,
    committedAt: input.targetCommittedAt,
    commitSequence: 1,
    completedAt: null,
    coveredCommitAt: null,
    createdAt: input.targetCommittedAt,
    generationId: null,
    lastFailureCode: null,
    mutationId: input.targetMutationId,
    state: "claimed",
    vaultId: input.vaultId,
    vaultInstanceId: input.vaultInstanceId,
  };
}

describe("verified-generation ledger completion", () => {
  test("records the verified watermark and satisfies its covered claim in one transaction", () => {
    const fixture = fixtures();
    const verification = createRuntimeLocalVerifiedGeneration({
      generationId: fixture.generationId,
      localCiphertextUri: "file:///verified/generation.lena",
      objectByteLength: 240,
      objectChecksum: fixture.objectChecksum,
      snapshot: {
        commitSequence: 2,
        committedAt: fixture.snapshotCommittedAt,
        mutationId: fixture.snapshotMutationId,
        vaultInstanceId: fixture.vaultInstanceId,
      },
      verifiedAt: fixture.verifiedAt,
      vaultId: fixture.vaultId,
    });
    if (verification.isErr()) throw verification.error;

    const target = claimedRow(fixture);
    const selected: Array<BackupOutboxRow | undefined> = [pendingRow(fixture), target, undefined];
    const inserted: unknown[] = [];
    let transactionBehavior: unknown;
    const database = {
      transaction: (callback: (transaction: unknown) => BackupOutboxRow, config: unknown) => {
        transactionBehavior = config;
        const transaction = {
          insert: () => ({
            values: (value: unknown) => ({ run: () => void inserted.push(value) }),
          }),
          select: () => ({
            from: () => ({ where: () => ({ get: () => selected.shift() }) }),
          }),
          update: () => ({
            set: (values: Partial<BackupOutboxRow>) => ({
              where: () => ({
                returning: () => ({ get: () => ({ ...target, ...values }) }),
              }),
            }),
          }),
        };
        return callback(transaction);
      },
    } as unknown as SyncVaultDatabase;

    const completed = completeSyncBackupObligation(
      database,
      {
        attemptCount: 1,
        claimId: fixture.claimId,
        mutationId: fixture.targetMutationId,
      },
      verification.value,
    );
    expect(completed.isOk()).toBe(true);
    if (completed.isErr()) throw completed.error;
    expect(transactionBehavior).toEqual({ behavior: "exclusive" });
    expect(selected).toHaveLength(0);
    expect(inserted).toEqual([
      {
        commitSequence: 2,
        committedAt: fixture.snapshotCommittedAt,
        generationId: fixture.generationId,
        mutationId: fixture.snapshotMutationId,
        vaultId: fixture.vaultId,
        vaultInstanceId: fixture.vaultInstanceId,
        verifiedAt: fixture.verifiedAt,
      },
    ]);
    expect(completed.value).toMatchObject({
      coveredCommitAt: fixture.snapshotCommittedAt,
      generationId: fixture.generationId,
      mutationId: fixture.targetMutationId,
      state: "satisfied",
    });
  });

  test("rejects reconstructed verification before opening a transaction", () => {
    const fixture = fixtures();
    const verification = createRuntimeLocalVerifiedGeneration({
      generationId: fixture.generationId,
      localCiphertextUri: "file:///verified/generation.lena",
      objectByteLength: 240,
      objectChecksum: fixture.objectChecksum,
      snapshot: {
        commitSequence: 2,
        committedAt: fixture.snapshotCommittedAt,
        mutationId: fixture.snapshotMutationId,
        vaultInstanceId: fixture.vaultInstanceId,
      },
      verifiedAt: fixture.verifiedAt,
      vaultId: fixture.vaultId,
    });
    if (verification.isErr()) throw verification.error;
    let transactionCount = 0;
    const database = {
      transaction: () => {
        transactionCount += 1;
        throw new Error("Transaction must not open");
      },
    } as unknown as SyncVaultDatabase;

    const rejected = completeSyncBackupObligation(
      database,
      {
        attemptCount: 1,
        claimId: fixture.claimId,
        mutationId: fixture.targetMutationId,
      },
      { ...verification.value },
    );
    expect(rejected.isErr()).toBe(true);
    expect(transactionCount).toBe(0);
    expect(
      backupCompletionClaimSchema.safeParse({
        attemptCount: 1,
        claimId: fixture.claimId,
        mutationId: fixture.targetMutationId,
        providerReceipt: "forbidden",
      }).success,
    ).toBe(false);
  });
});
