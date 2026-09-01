import {
  compareIsoTimestamps,
  err,
  LenaError,
  ok,
  parseGenerationId,
  parseIsoTimestamp,
  type EffectId,
  type GenerationId,
  type IsoTimestamp,
  type MutationId,
  type Result,
  type VaultId,
  type VaultInstanceId,
} from "@lena/core";

import type { VaultMutationReceipt } from "./mutations";
import type { ClaimedBackupObligation } from "./obligations";

const backupCoverageTokenBrand: unique symbol = Symbol("BackupCoverageToken");
const issuedBackupCoverageTokens = new WeakSet<object>();

export type BackupCoverageToken = Readonly<{
  readonly [backupCoverageTokenBrand]: true;
  readonly attemptCount: number;
  readonly claimId: EffectId;
  readonly coveredCommitAt: IsoTimestamp;
  readonly generationId: GenerationId;
  readonly mutationId: MutationId;
  readonly verifiedAt: IsoTimestamp;
  readonly vaultId: VaultId;
  readonly vaultInstanceId: VaultInstanceId;
}>;

export function isBackupCoverageToken(input: unknown): input is BackupCoverageToken {
  return (
    typeof input === "object" &&
    input !== null &&
    issuedBackupCoverageTokens.has(input) &&
    (input as { readonly [backupCoverageTokenBrand]?: unknown })[backupCoverageTokenBrand] === true
  );
}

/**
 * Internal boundary for the composition adapter that owns both the verified
 * @lena/backup result and the committed vault mutation receipt. The adapter
 * calls this only after proving that the exact verified generation includes
 * the receipt's committed mutation. It is intentionally absent from the
 * @lena/vault package root.
 */
export function createBackupCoverageTokenFromAdapter(
  input: Readonly<{
    generationId: GenerationId;
    mutationReceipt: VaultMutationReceipt;
    obligation: ClaimedBackupObligation;
    verifiedAt: IsoTimestamp;
  }>,
): Result<BackupCoverageToken, LenaError> {
  const generationId = parseGenerationId(input.generationId);
  const committedAt = parseIsoTimestamp(input.mutationReceipt.committedAt);
  const verifiedAt = parseIsoTimestamp(input.verifiedAt);
  if (generationId.isErr()) return err(generationId.error);
  if (committedAt.isErr()) return err(committedAt.error);
  if (verifiedAt.isErr()) return err(verifiedAt.error);

  if (
    input.mutationReceipt.backupObligationCreated !== true ||
    input.mutationReceipt.mutationId !== input.obligation.mutationId ||
    input.mutationReceipt.vaultId !== input.obligation.vaultId ||
    input.mutationReceipt.vaultInstanceId !== input.obligation.vaultInstanceId
  ) {
    return err(
      new LenaError("conflict", "Mutation receipt does not match the claimed backup obligation", {
        boundary: "vault_backup_coverage_adapter",
      }),
    );
  }
  if (
    compareIsoTimestamps(committedAt.value, input.obligation.createdAt) < 0 ||
    compareIsoTimestamps(committedAt.value, input.obligation.claimedAt) > 0
  ) {
    return err(
      new LenaError("invalid_timestamp", "Mutation commit is outside the claimed obligation", {
        boundary: "vault_backup_coverage_adapter",
      }),
    );
  }
  if (
    compareIsoTimestamps(verifiedAt.value, committedAt.value) < 0 ||
    compareIsoTimestamps(verifiedAt.value, input.obligation.claimedAt) < 0
  ) {
    return err(
      new LenaError("invalid_timestamp", "Backup verification predates covered mutation state", {
        boundary: "vault_backup_coverage_adapter",
      }),
    );
  }

  const token = {
    attemptCount: input.obligation.attemptCount,
    claimId: input.obligation.claimId,
    coveredCommitAt: committedAt.value,
    generationId: generationId.value,
    mutationId: input.obligation.mutationId,
    verifiedAt: verifiedAt.value,
    vaultId: input.obligation.vaultId,
    vaultInstanceId: input.obligation.vaultInstanceId,
  } as Record<PropertyKey, unknown>;
  Object.defineProperty(token, backupCoverageTokenBrand, {
    configurable: false,
    enumerable: false,
    value: true,
    writable: false,
  });
  const issuedToken = Object.freeze(token) as unknown as BackupCoverageToken;
  issuedBackupCoverageTokens.add(issuedToken);
  return ok(issuedToken);
}
