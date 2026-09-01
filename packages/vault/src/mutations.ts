import {
  compareIsoTimestamps,
  isoTimestampSchema,
  err,
  LenaError,
  ok,
  mutationIdSchema,
  vaultIdSchema,
  vaultInstanceIdSchema,
  type IsoTimestamp,
  type MutationId,
  type Result,
  type VaultId,
  type VaultInstanceId,
} from "@lena/core";
import { z } from "zod";
import { createBackupObligation, type PendingBackupObligation } from "./obligations";

/**
 * A database adapter consumes this as one transaction boundary. The domain mutation and the
 * supplied pending obligation must either both commit or both roll back.
 */
export interface AtomicVaultMutationPlan<Mutation> {
  readonly backupObligation: PendingBackupObligation;
  readonly mutation: Mutation;
}

export const vaultMutationReceiptSchema = z
  .strictObject({
    backupObligationCreated: z.literal(true),
    committedAt: isoTimestampSchema,
    mutationId: mutationIdSchema,
    vaultId: vaultIdSchema,
    vaultInstanceId: vaultInstanceIdSchema,
  })
  .readonly();

const vaultMutationReceiptStructureSchema = z.strictObject({
  backupObligationCreated: z.unknown(),
  committedAt: z.unknown(),
  mutationId: z.unknown(),
  vaultId: z.unknown(),
  vaultInstanceId: z.unknown(),
});

export type VaultMutationReceipt = z.infer<typeof vaultMutationReceiptSchema>;

export function prepareAtomicVaultMutation<Mutation>(input: {
  createdAt: IsoTimestamp;
  mutation: Mutation;
  mutationId: MutationId;
  vaultId: VaultId;
  vaultInstanceId: VaultInstanceId;
}): AtomicVaultMutationPlan<Mutation> {
  return Object.freeze({
    backupObligation: createBackupObligation({
      createdAt: input.createdAt,
      mutationId: input.mutationId,
      vaultId: input.vaultId,
      vaultInstanceId: input.vaultInstanceId,
    }),
    mutation: input.mutation,
  });
}

/**
 * Database adapters call this only after the transaction represented by the plan has committed.
 * This pure factory validates the persisted receipt shape but does not itself prove a native commit.
 */
export function createVaultMutationReceipt<Mutation>(
  plan: AtomicVaultMutationPlan<Mutation>,
  committedAt: IsoTimestamp,
): Result<VaultMutationReceipt, LenaError> {
  if (compareIsoTimestamps(committedAt, plan.backupObligation.createdAt) < 0) {
    return err(new LenaError("invalid_timestamp", "Mutation commit cannot precede its creation"));
  }

  return ok(
    Object.freeze({
      backupObligationCreated: true,
      committedAt,
      mutationId: plan.backupObligation.mutationId,
      vaultId: plan.backupObligation.vaultId,
      vaultInstanceId: plan.backupObligation.vaultInstanceId,
    }),
  );
}

export function parseVaultMutationReceipt(value: unknown): Result<VaultMutationReceipt, LenaError> {
  const structure = vaultMutationReceiptStructureSchema.safeParse(value);
  if (!structure.success) {
    return err(
      new LenaError("invalid_input", "Persisted record has missing or unexpected fields", {
        boundary: "vault_mutation_receipt",
      }),
    );
  }

  const parsed = vaultMutationReceiptSchema.safeParse(structure.data);
  if (parsed.success) return ok(parsed.data);

  const failedField = parsed.error.issues[0]?.path[0];
  if (failedField === "backupObligationCreated") {
    return err(
      new LenaError("invalid_state_transition", "Mutation receipt lacks a backup obligation"),
    );
  }
  if (failedField === "committedAt") {
    return err(new LenaError("invalid_timestamp", "Timestamp must be canonical UTC"));
  }
  if (
    failedField === "mutationId" ||
    failedField === "vaultId" ||
    failedField === "vaultInstanceId"
  ) {
    const kind =
      failedField === "mutationId"
        ? "MutationId"
        : failedField === "vaultId"
          ? "VaultId"
          : "VaultInstanceId";
    return err(new LenaError("invalid_identifier", `Invalid ${kind}`, { kind }));
  }

  return err(
    new LenaError("invalid_input", "Persisted record has missing or unexpected fields", {
      boundary: "vault_mutation_receipt",
    }),
  );
}
