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
import { isBackupCoverageToken, type BackupCoverageToken } from "./backup-coverage";

export type { BackupCoverageToken } from "./backup-coverage";

export const PERSISTABLE_LENA_ERROR_CODES: readonly LenaErrorCode[] = Object.freeze([
  ...lenaErrorCodeSchema.options,
]);

export const persistableLenaErrorCodeSchema = lenaErrorCodeSchema;

export function parsePersistableLenaErrorCode(value: unknown): Result<LenaErrorCode, LenaError> {
  const parsed = persistableLenaErrorCodeSchema.safeParse(value);
  if (!parsed.success) {
    return err(new LenaError("invalid_input", "Invalid persisted Lena error code"));
  }

  return ok(parsed.data);
}

const nonNegativeSafeIntegerSchema = z.int().min(0);
const backupObligationIdentityShape = {
  attemptCount: nonNegativeSafeIntegerSchema,
  createdAt: isoTimestampSchema,
  mutationId: mutationIdSchema,
  vaultId: vaultIdSchema,
  vaultInstanceId: vaultInstanceIdSchema,
} as const;
const backupObligationIdentityStructureShape = {
  attemptCount: z.unknown(),
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
      obligation.attemptCount < 1 ||
      compareIsoTimestamps(obligation.claimedAt, obligation.createdAt) < 0 ||
      compareIsoTimestamps(obligation.coveredCommitAt, obligation.createdAt) < 0 ||
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
  createdAt: IsoTimestamp;
  mutationId: MutationId;
  vaultId: VaultId;
  vaultInstanceId: VaultInstanceId;
}): PendingBackupObligation {
  return Object.freeze({
    attemptCount: 0,
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
      new LenaError("invalid_state_transition", "Only a pending backup obligation can be claimed", {
        state: obligation.state,
      }),
    );
  }

  if (compareIsoTimestamps(claimedAt, obligation.createdAt) < 0) {
    return err(new LenaError("invalid_timestamp", "Claim cannot precede obligation creation"));
  }

  return ok(
    Object.freeze({
      attemptCount: obligation.attemptCount + 1,
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
    return err(
      new LenaError(
        "invalid_state_transition",
        "Backup claim does not match the active obligation claim",
      ),
    );
  }

  return ok(
    Object.freeze({
      attemptCount: obligation.attemptCount,
      createdAt: obligation.createdAt,
      lastFailureCode: failureCode,
      mutationId: obligation.mutationId,
      state: "pending",
      vaultId: obligation.vaultId,
      vaultInstanceId: obligation.vaultInstanceId,
    }),
  );
}

export function satisfyBackupObligation(
  obligation: BackupObligation,
  coverage: BackupCoverageToken,
): Result<SatisfiedBackupObligation, LenaError> {
  if (!isBackupCoverageToken(coverage)) {
    return err(
      new LenaError("authentication_required", "Backup coverage lacks adapter verification", {
        boundary: "vault_backup_obligation",
      }),
    );
  }
  if (
    obligation.state !== "claimed" ||
    obligation.attemptCount !== coverage.attemptCount ||
    obligation.claimId !== coverage.claimId ||
    obligation.mutationId !== coverage.mutationId ||
    obligation.vaultId !== coverage.vaultId ||
    obligation.vaultInstanceId !== coverage.vaultInstanceId
  ) {
    return err(
      new LenaError(
        "invalid_state_transition",
        "Verified generation coverage does not match the active backup obligation",
      ),
    );
  }

  if (
    compareIsoTimestamps(coverage.coveredCommitAt, obligation.createdAt) < 0 ||
    compareIsoTimestamps(coverage.coveredCommitAt, obligation.claimedAt) > 0 ||
    compareIsoTimestamps(coverage.verifiedAt, obligation.claimedAt) < 0 ||
    compareIsoTimestamps(coverage.verifiedAt, coverage.coveredCommitAt) < 0
  ) {
    return err(new LenaError("invalid_timestamp", "Backup coverage chronology is invalid"));
  }

  return ok(
    Object.freeze({
      attemptCount: obligation.attemptCount,
      claimId: obligation.claimId,
      claimedAt: obligation.claimedAt,
      completedAt: coverage.verifiedAt,
      coveredCommitAt: coverage.coveredCommitAt,
      createdAt: obligation.createdAt,
      generationId: coverage.generationId,
      mutationId: obligation.mutationId,
      state: "satisfied",
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
      new LenaError("invalid_state_transition", "Only a claimed obligation can be recovered", {
        state: obligation.state,
      }),
    );
  }

  if (compareIsoTimestamps(obligation.claimedAt, staleAtOrBefore) > 0) {
    return err(new LenaError("invalid_state_transition", "Backup obligation claim is not stale"));
  }

  return ok(
    Object.freeze({
      attemptCount: obligation.attemptCount,
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
    return err(new LenaError("invalid_input", "Expected a backup obligation object"));
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
    return err(new LenaError("invalid_input", "Invalid backup obligation state"));
  }
  if (!structure.result.success) {
    return err(
      new LenaError("invalid_input", "Persisted record has missing or unexpected fields", {
        boundary: structure.boundary,
      }),
    );
  }

  const parsed = backupObligationSchema.safeParse(structure.result.data);
  if (parsed.success) return ok(parsed.data);

  const customIssue = parsed.error.issues.find((issue) => issue.code === "custom")?.message;
  if (customIssue === "invalid_failure_code") {
    return err(new LenaError("invalid_input", "Invalid persisted Lena error code"));
  }
  const invariantError = match(stateProbe.data.state)
    .with("pending", () =>
      customIssue === "pending_failure_state"
        ? new LenaError(
            "invalid_state_transition",
            "Pending obligation failure state does not match its attempt count",
          )
        : null,
    )
    .with("claimed", () =>
      customIssue === "claimed_state"
        ? new LenaError("invalid_state_transition", "Invalid claimed obligation state")
        : null,
    )
    .with("satisfied", () =>
      customIssue === "satisfied_state"
        ? new LenaError("invalid_state_transition", "Invalid satisfied obligation state")
        : null,
    )
    .otherwise(() => new LenaError("invalid_input", "Invalid backup obligation state"));
  if (invariantError !== null) return err(invariantError);

  const failedField = parsed.error.issues[0]?.path.at(-1);
  if (
    failedField === "createdAt" ||
    failedField === "claimedAt" ||
    failedField === "coveredCommitAt" ||
    failedField === "completedAt"
  ) {
    return err(new LenaError("invalid_timestamp", "Timestamp must be canonical UTC"));
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
    return err(new LenaError("invalid_identifier", `Invalid ${kind}`, { kind }));
  }
  if (failedField === "lastFailureCode") {
    return err(new LenaError("invalid_input", "Invalid persisted Lena error code"));
  }

  return err(
    new LenaError("invalid_input", "Persisted record has missing or unexpected fields", {
      boundary: `${String(stateProbe.data.state)}_backup_obligation`,
    }),
  );
}
