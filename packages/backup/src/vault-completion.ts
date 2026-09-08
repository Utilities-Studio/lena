import {
  compareIsoTimestamps,
  effectIdSchema,
  err,
  LenaError,
  mutationIdSchema,
  ok,
  type Result,
} from "@lena/core";
import {
  backupOutboxRowSchema,
  lenaBackupOutboxTable,
  lenaVerifiedBackupGenerationsTable,
  verifiedBackupGenerationRowSchema,
  type AsyncVaultDatabase,
  type BackupOutboxRow,
  type SyncVaultDatabase,
  type VerifiedBackupGenerationRow,
} from "@lena/vault";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { isRuntimeVerifiedGeneration, type VerifiedGeneration } from "./runtime-evidence";

export const backupCompletionClaimSchema = z
  .strictObject({
    attemptCount: z.int().min(1).max(Number.MAX_SAFE_INTEGER),
    claimId: effectIdSchema,
    mutationId: mutationIdSchema,
  })
  .readonly();

export type BackupCompletionClaim = z.infer<typeof backupCompletionClaimSchema>;

class AbortBackupCompletion extends Error {
  constructor(readonly lenaError: LenaError) {
    super("abort-backup-completion");
  }
}

function abort(code: ConstructorParameters<typeof LenaError>[0]): never {
  throw new AbortBackupCompletion(new LenaError(code));
}

function assertCoverage(
  verification: VerifiedGeneration,
  claim: BackupCompletionClaim,
  watermark: BackupOutboxRow | undefined,
  target: BackupOutboxRow | undefined,
): void {
  const snapshot = verification.snapshot;
  if (
    watermark === undefined ||
    watermark.commitSequence !== snapshot.commitSequence ||
    watermark.mutationId !== snapshot.mutationId ||
    watermark.vaultId !== verification.vaultId ||
    watermark.vaultInstanceId !== snapshot.vaultInstanceId ||
    watermark.committedAt !== snapshot.committedAt
  ) {
    abort("integrity_failed");
  }
  if (
    target === undefined ||
    target.state !== "claimed" ||
    target.attemptCount !== claim.attemptCount ||
    target.claimId !== claim.claimId ||
    target.vaultId !== verification.vaultId ||
    target.vaultInstanceId !== snapshot.vaultInstanceId ||
    target.claimedAt === null ||
    target.commitSequence > snapshot.commitSequence ||
    (target.commitSequence === snapshot.commitSequence && target.mutationId !== snapshot.mutationId)
  ) {
    abort("invalid_state_transition");
  }
  if (
    compareIsoTimestamps(snapshot.committedAt, target.committedAt) < 0 ||
    compareIsoTimestamps(snapshot.committedAt, target.claimedAt) > 0 ||
    compareIsoTimestamps(verification.verifiedAt, target.claimedAt) < 0
  ) {
    abort("invalid_timestamp");
  }
}

function generationRow(verification: VerifiedGeneration): VerifiedBackupGenerationRow {
  return verifiedBackupGenerationRowSchema.parse({
    commitSequence: verification.snapshot.commitSequence,
    committedAt: verification.snapshot.committedAt,
    generationId: verification.generationId,
    mutationId: verification.snapshot.mutationId,
    vaultId: verification.vaultId,
    vaultInstanceId: verification.snapshot.vaultInstanceId,
    verifiedAt: verification.verifiedAt,
  });
}

function assertExistingGeneration(
  existing: VerifiedBackupGenerationRow | undefined,
  expected: VerifiedBackupGenerationRow,
): void {
  if (
    existing !== undefined &&
    (existing.commitSequence !== expected.commitSequence ||
      existing.committedAt !== expected.committedAt ||
      existing.mutationId !== expected.mutationId ||
      existing.vaultId !== expected.vaultId ||
      existing.vaultInstanceId !== expected.vaultInstanceId ||
      existing.verifiedAt !== expected.verifiedAt)
  ) {
    abort("conflict");
  }
}

function completedValues(verification: VerifiedGeneration) {
  return {
    completedAt: verification.verifiedAt,
    coveredCommitAt: verification.snapshot.committedAt,
    generationId: verification.generationId,
    lastFailureCode: null,
    state: "satisfied" as const,
  };
}

/**
 * Atomically records an adapter-bound verified generation and satisfies one covered outbox row.
 * A parsed or reconstructed verification is rejected because it lacks the runtime byte binding.
 */
export async function completeAsyncBackupObligation<RunResult>(
  database: AsyncVaultDatabase<RunResult>,
  claimInput: BackupCompletionClaim,
  verification: VerifiedGeneration,
): Promise<Result<BackupOutboxRow, LenaError>> {
  const claim = backupCompletionClaimSchema.safeParse(claimInput);
  if (!claim.success || !isRuntimeVerifiedGeneration(verification)) {
    return err(new LenaError("integrity_failed"));
  }
  const expectedGeneration = generationRow(verification);

  try {
    const completed = await database.transaction(
      async (transaction) => {
        const watermark = await transaction
          .select()
          .from(lenaBackupOutboxTable)
          .where(
            and(
              eq(lenaBackupOutboxTable.commitSequence, verification.snapshot.commitSequence),
              eq(lenaBackupOutboxTable.mutationId, verification.snapshot.mutationId),
              eq(lenaBackupOutboxTable.vaultId, verification.vaultId),
              eq(lenaBackupOutboxTable.vaultInstanceId, verification.snapshot.vaultInstanceId),
            ),
          )
          .get();
        const target = await transaction
          .select()
          .from(lenaBackupOutboxTable)
          .where(eq(lenaBackupOutboxTable.mutationId, claim.data.mutationId))
          .get();
        assertCoverage(verification, claim.data, watermark, target);

        const existing = await transaction
          .select()
          .from(lenaVerifiedBackupGenerationsTable)
          .where(eq(lenaVerifiedBackupGenerationsTable.generationId, verification.generationId))
          .get();
        assertExistingGeneration(existing, expectedGeneration);
        if (existing === undefined) {
          await transaction
            .insert(lenaVerifiedBackupGenerationsTable)
            .values(expectedGeneration)
            .run();
        }

        const updated = await transaction
          .update(lenaBackupOutboxTable)
          .set(completedValues(verification))
          .where(
            and(
              eq(lenaBackupOutboxTable.mutationId, claim.data.mutationId),
              eq(lenaBackupOutboxTable.state, "claimed"),
              eq(lenaBackupOutboxTable.claimId, claim.data.claimId),
            ),
          )
          .returning()
          .get();
        const parsed = backupOutboxRowSchema.safeParse(updated);
        if (!parsed.success) abort("integrity_failed");
        return parsed.data;
      },
      { behavior: "exclusive" },
    );
    return ok(completed);
  } catch (cause) {
    return err(
      cause instanceof AbortBackupCompletion
        ? cause.lenaError
        : new LenaError("internal", { boundary: "backup_completion_transaction" }),
    );
  }
}

/** Sync-driver variant of completeAsyncBackupObligation. */
export function completeSyncBackupObligation<RunResult>(
  database: SyncVaultDatabase<RunResult>,
  claimInput: BackupCompletionClaim,
  verification: VerifiedGeneration,
): Result<BackupOutboxRow, LenaError> {
  const claim = backupCompletionClaimSchema.safeParse(claimInput);
  if (!claim.success || !isRuntimeVerifiedGeneration(verification)) {
    return err(new LenaError("integrity_failed"));
  }
  const expectedGeneration = generationRow(verification);

  try {
    const completed = database.transaction(
      (transaction) => {
        const watermark = transaction
          .select()
          .from(lenaBackupOutboxTable)
          .where(
            and(
              eq(lenaBackupOutboxTable.commitSequence, verification.snapshot.commitSequence),
              eq(lenaBackupOutboxTable.mutationId, verification.snapshot.mutationId),
              eq(lenaBackupOutboxTable.vaultId, verification.vaultId),
              eq(lenaBackupOutboxTable.vaultInstanceId, verification.snapshot.vaultInstanceId),
            ),
          )
          .get();
        const target = transaction
          .select()
          .from(lenaBackupOutboxTable)
          .where(eq(lenaBackupOutboxTable.mutationId, claim.data.mutationId))
          .get();
        assertCoverage(verification, claim.data, watermark, target);

        const existing = transaction
          .select()
          .from(lenaVerifiedBackupGenerationsTable)
          .where(eq(lenaVerifiedBackupGenerationsTable.generationId, verification.generationId))
          .get();
        assertExistingGeneration(existing, expectedGeneration);
        if (existing === undefined) {
          transaction.insert(lenaVerifiedBackupGenerationsTable).values(expectedGeneration).run();
        }

        const updated = transaction
          .update(lenaBackupOutboxTable)
          .set(completedValues(verification))
          .where(
            and(
              eq(lenaBackupOutboxTable.mutationId, claim.data.mutationId),
              eq(lenaBackupOutboxTable.state, "claimed"),
              eq(lenaBackupOutboxTable.claimId, claim.data.claimId),
            ),
          )
          .returning()
          .get();
        const parsed = backupOutboxRowSchema.safeParse(updated);
        if (!parsed.success) abort("integrity_failed");
        return parsed.data;
      },
      { behavior: "exclusive" },
    );
    return ok(completed);
  } catch (cause) {
    return err(
      cause instanceof AbortBackupCompletion
        ? cause.lenaError
        : new LenaError("internal", { boundary: "backup_completion_transaction" }),
    );
  }
}
