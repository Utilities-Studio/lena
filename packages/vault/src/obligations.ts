import {
  compareIsoTimestamps,
  effectIdSchema,
  err,
  generationIdSchema,
  isoTimestampSchema,
  LenaError,
  lenaErrorCodeSchema,
  mutationIdSchema,
  ok,
  vaultIdSchema,
  vaultInstanceIdSchema,
  type EffectId,
  type IsoTimestamp,
  type LenaErrorCode,
  type MutationId,
  type Result,
  type VaultId,
  type VaultInstanceId,
} from "@lena/core";
import { match } from "ts-pattern";
import { z } from "zod";
export const PERSISTABLE_LENA_ERROR_CODES: readonly LenaErrorCode[] = Object.freeze([
  ...lenaErrorCodeSchema.options,
]);

export const persistableLenaErrorCodeSchema = lenaErrorCodeSchema;

export function parsePersistableLenaErrorCode(value: unknown): Result<LenaErrorCode, LenaError> {
  const parsed = persistableLenaErrorCodeSchema.safeParse(value);
  if (!parsed.success) {
    return err(new LenaError("invalid_input"));
  }

  return ok(parsed.data);
}

const nonNegativeSafeIntegerSchema = z.int().min(0).max(Number.MAX_SAFE_INTEGER);
const backupObligationIdentityShape = {
  attemptCount: nonNegativeSafeIntegerSchema,
  commitSequence: z.int().min(1).max(Number.MAX_SAFE_INTEGER),
  committedAt: isoTimestampSchema,
  createdAt: isoTimestampSchema,
  mutationId: mutationIdSchema,
  vaultId: vaultIdSchema,
  vaultInstanceId: vaultInstanceIdSchema,
} as const;
const backupObligationIdentityStructureShape = {
  attemptCount: z.unknown(),
  commitSequence: z.unknown(),
  committedAt: z.unknown(),
  createdAt: z.unknown(),
  mutationId: z.unknown(),
  vaultId: z.unknown(),
  vaultInstanceId: z.unknown(),
} as const;

export const pendingBackupObligationSchema = z
  .strictObject({
    ...backupObligationIdentityShape,
    lastFailureCode: persistableLenaErrorCodeSchema.optional(),
    state: z.literal("pending"),
  })
  .superRefine((obligation, context) => {
    if (compareIsoTimestamps(obligation.committedAt, obligation.createdAt) < 0) {
      context.addIssue({ code: "custom", message: "commit_chronology" });
    }
    const hasFailureCode = Object.prototype.hasOwnProperty.call(obligation, "lastFailureCode");
    if (hasFailureCode && obligation.lastFailureCode === undefined) {
      context.addIssue({ code: "custom", message: "invalid_failure_code" });
    } else if ((obligation.attemptCount === 0) !== (obligation.lastFailureCode === undefined)) {
      context.addIssue({ code: "custom", message: "pending_failure_state" });
    }
  })
  .readonly();

export const claimedBackupObligationSchema = z
  .strictObject({
    ...backupObligationIdentityShape,
    claimId: effectIdSchema,
    claimedAt: isoTimestampSchema,
    state: z.literal("claimed"),
  })
  .superRefine((obligation, context) => {
    if (
      compareIsoTimestamps(obligation.committedAt, obligation.createdAt) < 0 ||
      obligation.attemptCount < 1 ||
      compareIsoTimestamps(obligation.claimedAt, obligation.createdAt) < 0
    ) {
      context.addIssue({ code: "custom", message: "claimed_state" });
    }
  })
  .readonly();

export const satisfiedBackupObligationSchema = z
  .strictObject({
    ...backupObligationIdentityShape,
    claimId: effectIdSchema,
    claimedAt: isoTimestampSchema,
    completedAt: isoTimestampSchema,
    coveredCommitAt: isoTimestampSchema,
    generationId: generationIdSchema,
    state: z.literal("satisfied"),
  })
  .superRefine((obligation, context) => {
    if (
      compareIsoTimestamps(obligation.committedAt, obligation.createdAt) < 0 ||
      obligation.attemptCount < 1 ||
      compareIsoTimestamps(obligation.claimedAt, obligation.createdAt) < 0 ||
      compareIsoTimestamps(obligation.coveredCommitAt, obligation.committedAt) < 0 ||
      compareIsoTimestamps(obligation.coveredCommitAt, obligation.claimedAt) > 0 ||
      compareIsoTimestamps(obligation.completedAt, obligation.claimedAt) < 0 ||
      compareIsoTimestamps(obligation.completedAt, obligation.coveredCommitAt) < 0
    ) {
      context.addIssue({ code: "custom", message: "satisfied_state" });
    }
  })
  .readonly();

export const backupObligationSchema = z.discriminatedUnion("state", [
  pendingBackupObligationSchema,
  claimedBackupObligationSchema,
  satisfiedBackupObligationSchema,
]);

const pendingBackupObligationStructureSchema = z.strictObject({
  ...backupObligationIdentityStructureShape,
  lastFailureCode: z.unknown().optional(),
  state: z.literal("pending"),
});
const claimedBackupObligationStructureSchema = z.strictObject({
  ...backupObligationIdentityStructureShape,
  claimId: z.unknown(),
  claimedAt: z.unknown(),
  state: z.literal("claimed"),
});
const satisfiedBackupObligationStructureSchema = z.strictObject({
  ...backupObligationIdentityStructureShape,
  claimId: z.unknown(),
  claimedAt: z.unknown(),
  completedAt: z.unknown(),
  coveredCommitAt: z.unknown(),
  generationId: z.unknown(),
  state: z.literal("satisfied"),
});

export type PendingBackupObligation = z.infer<typeof pendingBackupObligationSchema>;
export type ClaimedBackupObligation = z.infer<typeof claimedBackupObligationSchema>;
export type SatisfiedBackupObligation = z.infer<typeof satisfiedBackupObligationSchema>;
export type BackupObligation = z.infer<typeof backupObligationSchema>;

export function createBackupObligation(input: {
  commitSequence: number;
  committedAt: IsoTimestamp;
  createdAt: IsoTimestamp;
  mutationId: MutationId;
  vaultId: VaultId;
  vaultInstanceId: VaultInstanceId;
}): PendingBackupObligation {
  return Object.freeze({
    attemptCount: 0,
    commitSequence: input.commitSequence,
    committedAt: input.committedAt,
    createdAt: input.createdAt,
    mutationId: input.mutationId,
    state: "pending",
    vaultId: input.vaultId,
    vaultInstanceId: input.vaultInstanceId,
  });
}

export function claimBackupObligation(
  obligation: BackupObligation,
  claimId: EffectId,
  claimedAt: IsoTimestamp,
): Result<ClaimedBackupObligation, LenaError> {
  if (obligation.state !== "pending") {
    return err(
      new LenaError("invalid_state_transition", {
        state: obligation.state,
      }),
    );
  }

  if (compareIsoTimestamps(claimedAt, obligation.createdAt) < 0) {
    return err(new LenaError("invalid_timestamp"));
  }

  return ok(
    Object.freeze({
      attemptCount: obligation.attemptCount + 1,
      commitSequence: obligation.commitSequence,
      committedAt: obligation.committedAt,
      claimedAt,
      claimId,
      createdAt: obligation.createdAt,
      mutationId: obligation.mutationId,
      state: "claimed",
      vaultId: obligation.vaultId,
      vaultInstanceId: obligation.vaultInstanceId,
    }),
  );
}

export function releaseBackupObligation(
  obligation: BackupObligation,
  claimId: EffectId,
  failureCode: LenaErrorCode,
): Result<PendingBackupObligation, LenaError> {
  if (obligation.state !== "claimed" || obligation.claimId !== claimId) {
    return err(new LenaError("invalid_state_transition"));
  }

  return ok(
    Object.freeze({
      attemptCount: obligation.attemptCount,
      commitSequence: obligation.commitSequence,
      committedAt: obligation.committedAt,
      createdAt: obligation.createdAt,
      lastFailureCode: failureCode,
      mutationId: obligation.mutationId,
      state: "pending",
      vaultId: obligation.vaultId,
      vaultInstanceId: obligation.vaultInstanceId,
    }),
  );
}

export function recoverStaleClaimedBackupObligation(
  obligation: BackupObligation,
  staleAtOrBefore: IsoTimestamp,
  failureCode: LenaErrorCode,
): Result<PendingBackupObligation, LenaError> {
  if (obligation.state !== "claimed") {
    return err(
      new LenaError("invalid_state_transition", {
        state: obligation.state,
      }),
    );
  }

  if (compareIsoTimestamps(obligation.claimedAt, staleAtOrBefore) > 0) {
    return err(new LenaError("invalid_state_transition"));
  }

  return ok(
    Object.freeze({
      attemptCount: obligation.attemptCount,
      commitSequence: obligation.commitSequence,
      committedAt: obligation.committedAt,
      createdAt: obligation.createdAt,
      lastFailureCode: failureCode,
      mutationId: obligation.mutationId,
      state: "pending",
      vaultId: obligation.vaultId,
      vaultInstanceId: obligation.vaultInstanceId,
    }),
  );
}

export function parseBackupObligation(value: unknown): Result<BackupObligation, LenaError> {
  const stateProbe = z.object({ state: z.unknown() }).safeParse(value);
  if (!stateProbe.success) {
    return err(new LenaError("invalid_input"));
  }

  const structure = match(stateProbe.data.state)
    .with("pending", () => ({
      boundary: "pending_backup_obligation",
      result: pendingBackupObligationStructureSchema.safeParse(value),
    }))
    .with("claimed", () => ({
      boundary: "claimed_backup_obligation",
      result: claimedBackupObligationStructureSchema.safeParse(value),
    }))
    .with("satisfied", () => ({
      boundary: "satisfied_backup_obligation",
      result: satisfiedBackupObligationStructureSchema.safeParse(value),
    }))
    .otherwise(() => null);
  if (structure === null) {
    return err(new LenaError("invalid_input"));
  }
  if (!structure.result.success) {
    return err(
      new LenaError("invalid_input", {
        boundary: structure.boundary,
      }),
    );
  }

  const parsed = backupObligationSchema.safeParse(structure.result.data);
  if (parsed.success) return ok(parsed.data);

  const customIssue = parsed.error.issues.find((issue) => issue.code === "custom")?.message;
  if (customIssue === "invalid_failure_code") {
    return err(new LenaError("invalid_input"));
  }
  const invariantError = match(stateProbe.data.state)
    .with("pending", () =>
      customIssue === "pending_failure_state" ? new LenaError("invalid_state_transition") : null,
    )
    .with("claimed", () =>
      customIssue === "claimed_state" ? new LenaError("invalid_state_transition") : null,
    )
    .with("satisfied", () =>
      customIssue === "satisfied_state" ? new LenaError("invalid_state_transition") : null,
    )
    .otherwise(() => new LenaError("invalid_input"));
  if (invariantError !== null) return err(invariantError);

  const failedField = parsed.error.issues[0]?.path.at(-1);
  if (
    failedField === "createdAt" ||
    failedField === "claimedAt" ||
    failedField === "coveredCommitAt" ||
    failedField === "completedAt"
  ) {
    return err(new LenaError("invalid_timestamp"));
  }
  if (
    failedField === "claimId" ||
    failedField === "generationId" ||
    failedField === "mutationId" ||
    failedField === "vaultId" ||
    failedField === "vaultInstanceId"
  ) {
    const kinds = {
      claimId: "EffectId",
      generationId: "GenerationId",
      mutationId: "MutationId",
      vaultId: "VaultId",
      vaultInstanceId: "VaultInstanceId",
    } as const;
    const kind = kinds[failedField];
    return err(new LenaError("invalid_identifier", { kind }));
  }
  if (failedField === "lastFailureCode") {
    return err(new LenaError("invalid_input"));
  }

  return err(
    new LenaError("invalid_input", {
      boundary: `${String(stateProbe.data.state)}_backup_obligation`,
    }),
  );
}
