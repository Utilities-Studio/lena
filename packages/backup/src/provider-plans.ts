import {
  err,
  effectIdSchema,
  generationIdSchema,
  LenaError,
  ok,
  vaultIdSchema,
  type EffectId,
  type GenerationId,
  type Result,
  type VaultId,
} from "@lena/core";
import { z } from "zod";
import { sha256ChecksumSchema } from "./checksum";
import { isRuntimeClaimedBackupAttempt, type BackupAttempt } from "./lifecycle";
import {
  getGenerationObjectPath,
  parseGenerationManifest,
  type GenerationManifest,
} from "./manifest";
import { isAuthorizedRetentionPlan, type RetentionPlan } from "./retention";
import {
  getRuntimeLocalCiphertextUri,
  isRuntimeRemoteObjectReceipt,
  isRuntimeVerifiedGeneration,
  type RemoteBackupProvider,
  type RemoteObjectReceipt,
  type VerifiedGeneration,
} from "./runtime-evidence";
import { remoteBackupProviderSchema } from "./transport";

export const transportProviderObjectIdSchema = z
  .string()
  .max(512)
  .refine((value) => value.trim().length > 0 && !/[\r\n]/.test(value));

export const transportCiphertextUriSchema = z
  .string()
  .max(2_048)
  .refine((value) => value.trim().length > 0 && !/[\r\n]/.test(value));

export const transportRemotePathSchema = z
  .string()
  .max(1_024)
  .refine((value) => value.trim().length > 0 && !/[\r\n]/.test(value));

export const transportContinuationTokenSchema = z
  .string()
  .max(1_024)
  .refine((value) => value.trim().length > 0 && !/[\r\n]/.test(value));

export const immutableTransportConflictTargetSchema = z
  .strictObject({
    providerObjectId: transportProviderObjectIdSchema,
    remotePath: transportRemotePathSchema,
  })
  .readonly();

export type ImmutableTransportConflictTarget = z.infer<
  typeof immutableTransportConflictTargetSchema
>;

const immutableTransportUploadPlanBrand: unique symbol = Symbol("ImmutableTransportUploadPlan");

export type ImmutableTransportUploadPlan = Readonly<{
  readonly [immutableTransportUploadPlanBrand]: "ImmutableTransportUploadPlan";
  readonly claimId: EffectId;
  readonly conflictBehavior: "verify-existing-exact-object";
  readonly executionAuthorized: false;
  readonly expectedObjectByteLength: number;
  readonly expectedObjectChecksum: VerifiedGeneration["objectChecksum"];
  readonly generationId: GenerationId;
  readonly localCiphertextUri: string;
  readonly provider: RemoteBackupProvider;
  readonly remotePath: string;
  readonly vaultId: VaultId;
}>;

export const immutableTransportUploadPlanSchema = z
  .strictObject({
    claimId: effectIdSchema,
    conflictBehavior: z.literal("verify-existing-exact-object"),
    executionAuthorized: z.literal(false),
    expectedObjectByteLength: z.int().min(0).max(Number.MAX_SAFE_INTEGER),
    expectedObjectChecksum: sha256ChecksumSchema,
    generationId: generationIdSchema,
    localCiphertextUri: transportCiphertextUriSchema,
    provider: remoteBackupProviderSchema,
    remotePath: transportRemotePathSchema,
    vaultId: vaultIdSchema,
  })
  .readonly();

export interface ImmutableTransportListPlan {
  readonly continuationToken: string | null;
  readonly prefix: string;
  readonly provider: RemoteBackupProvider;
  readonly readOnly: true;
}

export interface ImmutableTransportExactObjectPlan {
  readonly provider: RemoteBackupProvider;
  readonly providerObjectId: string;
  readonly remotePath: string;
}

export interface ImmutableTransportDownloadPlan extends ImmutableTransportExactObjectPlan {
  readonly expectedObjectByteLength: number;
  readonly expectedObjectChecksum: VerifiedGeneration["objectChecksum"];
  readonly generationId: GenerationId;
  readonly stagingCiphertextUri: string;
  readonly vaultId: VaultId;
}

const immutableTransportDeletePlanBrand: unique symbol = Symbol("ImmutableTransportDeletePlan");

export type ImmutableTransportDeletePlan = Readonly<
  ImmutableTransportExactObjectPlan & {
    readonly [immutableTransportDeletePlanBrand]: "ImmutableTransportDeletePlan";
    readonly authorizedByRetention: true;
    readonly executionAuthorized: false;
    readonly expectedObjectByteLength: number;
    readonly expectedObjectChecksum: VerifiedGeneration["objectChecksum"];
    readonly generationId: GenerationId;
    readonly vaultId: VaultId;
  }
>;

export const immutableTransportDeletePlanSchema = z
  .strictObject({
    authorizedByRetention: z.literal(true),
    executionAuthorized: z.literal(false),
    expectedObjectByteLength: z.int().min(0).max(Number.MAX_SAFE_INTEGER),
    expectedObjectChecksum: sha256ChecksumSchema,
    generationId: generationIdSchema,
    provider: remoteBackupProviderSchema,
    providerObjectId: transportProviderObjectIdSchema,
    remotePath: transportRemotePathSchema,
    vaultId: vaultIdSchema,
  })
  .readonly();

const authorizedUploadPlans = new WeakSet();
const authorizedDeletePlans = new WeakSet();

function verificationMatchesManifest(
  manifest: GenerationManifest,
  verification: VerifiedGeneration,
): boolean {
  return (
    verification.generationId === manifest.generationId &&
    verification.vaultId === manifest.vaultId &&
    verification.snapshot.commitSequence === manifest.snapshot.commitSequence &&
    verification.snapshot.committedAt === manifest.snapshot.committedAt &&
    verification.snapshot.mutationId === manifest.snapshot.mutationId &&
    verification.snapshot.vaultInstanceId === manifest.snapshot.vaultInstanceId
  );
}

export function createImmutableTransportUploadPlan(
  manifest: GenerationManifest,
  verification: VerifiedGeneration,
  attempt: BackupAttempt,
  provider: RemoteBackupProvider,
): Result<ImmutableTransportUploadPlan, LenaError> {
  const parsedManifest = parseGenerationManifest(manifest);
  const parsedProvider = remoteBackupProviderSchema.safeParse(provider);
  const localCiphertextUri = getRuntimeLocalCiphertextUri(verification);
  if (
    parsedManifest.isErr() ||
    !parsedProvider.success ||
    !isRuntimeVerifiedGeneration(verification) ||
    verification.kind !== "local" ||
    verification.provider !== null ||
    verification.providerObjectId !== null ||
    verification.providerObjectPath !== null ||
    localCiphertextUri === null ||
    !verificationMatchesManifest(manifest, verification) ||
    !isRuntimeClaimedBackupAttempt(attempt) ||
    attempt.state !== "uploading" ||
    attempt.provider !== provider ||
    attempt.vaultId !== manifest.vaultId ||
    attempt.generationId !== manifest.generationId ||
    attempt.objectByteLength !== verification.objectByteLength ||
    attempt.objectChecksum !== verification.objectChecksum
  ) {
    return err(new LenaError("integrity_failed"));
  }

  const planFields: ImmutableTransportUploadPlan = {
    [immutableTransportUploadPlanBrand]: "ImmutableTransportUploadPlan",
    claimId: attempt.claimId,
    conflictBehavior: "verify-existing-exact-object" as const,
    executionAuthorized: false as const,
    expectedObjectByteLength: verification.objectByteLength,
    expectedObjectChecksum: verification.objectChecksum,
    generationId: manifest.generationId,
    localCiphertextUri,
    provider,
    remotePath: getGenerationObjectPath(manifest),
    vaultId: manifest.vaultId,
  };
  const plan = Object.freeze(planFields);
  authorizedUploadPlans.add(plan);
  return ok(plan);
}

export function isAuthorizedImmutableTransportUploadPlan(
  value: unknown,
): value is ImmutableTransportUploadPlan {
  return typeof value === "object" && value !== null && authorizedUploadPlans.has(value);
}

export function createTransportListPlan(
  vaultId: VaultId,
  provider: RemoteBackupProvider,
  continuationToken: string | null = null,
): Result<ImmutableTransportListPlan, LenaError> {
  const parsed = z
    .strictObject({
      continuationToken: transportContinuationTokenSchema.nullable(),
      provider: remoteBackupProviderSchema,
      vaultId: vaultIdSchema,
    })
    .safeParse({ continuationToken, provider, vaultId });
  if (!parsed.success) {
    return err(new LenaError("invalid_input"));
  }

  return ok(
    Object.freeze({
      continuationToken: parsed.data.continuationToken,
      prefix: `vaults/${parsed.data.vaultId}/generations/`,
      provider: parsed.data.provider,
      readOnly: true as const,
    }),
  );
}

export function createTransportInspectPlan(
  manifest: GenerationManifest,
  provider: RemoteBackupProvider,
  providerObjectId: string,
): Result<ImmutableTransportExactObjectPlan, LenaError> {
  const parsedManifest = parseGenerationManifest(manifest);
  const parsed = z
    .strictObject({
      provider: remoteBackupProviderSchema,
      providerObjectId: transportProviderObjectIdSchema,
    })
    .safeParse({ provider, providerObjectId });
  if (parsedManifest.isErr() || !parsed.success) {
    return err(new LenaError("invalid_input"));
  }

  return ok(
    Object.freeze({
      provider: parsed.data.provider,
      providerObjectId: parsed.data.providerObjectId,
      remotePath: getGenerationObjectPath(parsedManifest.value),
    }),
  );
}

export function reconcileImmutableTransportConflict(
  plan: ImmutableTransportUploadPlan,
  target: ImmutableTransportConflictTarget,
  receipt: RemoteObjectReceipt,
): Result<RemoteObjectReceipt, LenaError> {
  const parsedTarget = immutableTransportConflictTargetSchema.safeParse(target);
  if (
    !parsedTarget.success ||
    !isAuthorizedImmutableTransportUploadPlan(plan) ||
    !isRuntimeRemoteObjectReceipt(receipt) ||
    parsedTarget.data.remotePath !== plan.remotePath ||
    parsedTarget.data.providerObjectId !== receipt.providerObjectId ||
    receipt.claimId !== plan.claimId ||
    receipt.provider !== plan.provider ||
    receipt.vaultId !== plan.vaultId ||
    receipt.generationId !== plan.generationId ||
    receipt.providerObjectPath !== plan.remotePath ||
    receipt.objectByteLength !== plan.expectedObjectByteLength ||
    receipt.objectChecksum !== plan.expectedObjectChecksum
  ) {
    return err(new LenaError("conflict"));
  }
  return ok(receipt);
}

export function createTransportDownloadPlan(
  manifest: GenerationManifest,
  verification: VerifiedGeneration,
  provider: RemoteBackupProvider,
  stagingCiphertextUri: string,
): Result<ImmutableTransportDownloadPlan, LenaError> {
  const parsedManifest = parseGenerationManifest(manifest);
  const parsed = z
    .strictObject({
      provider: remoteBackupProviderSchema,
      stagingCiphertextUri: transportCiphertextUriSchema,
    })
    .safeParse({ provider, stagingCiphertextUri });
  if (
    parsedManifest.isErr() ||
    !parsed.success ||
    !verificationMatchesManifest(manifest, verification) ||
    !isRuntimeVerifiedGeneration(verification) ||
    verification.kind !== "remote" ||
    verification.provider !== provider ||
    verification.providerObjectId === null ||
    verification.providerObjectPath !== getGenerationObjectPath(manifest)
  ) {
    return err(new LenaError("integrity_failed"));
  }

  return ok(
    Object.freeze({
      expectedObjectByteLength: verification.objectByteLength,
      expectedObjectChecksum: verification.objectChecksum,
      generationId: manifest.generationId,
      provider,
      providerObjectId: verification.providerObjectId,
      remotePath: verification.providerObjectPath,
      stagingCiphertextUri: parsed.data.stagingCiphertextUri,
      vaultId: manifest.vaultId,
    }),
  );
}

export function createTransportDeletePlan(
  manifest: GenerationManifest,
  verification: VerifiedGeneration,
  retention: RetentionPlan,
  provider: RemoteBackupProvider,
): Result<ImmutableTransportDeletePlan, LenaError> {
  const parsedManifest = parseGenerationManifest(manifest);
  const parsedProvider = remoteBackupProviderSchema.safeParse(provider);
  if (
    parsedManifest.isErr() ||
    !parsedProvider.success ||
    !isAuthorizedRetentionPlan(retention) ||
    retention.vaultId !== manifest.vaultId ||
    !retention.delete.includes(manifest.generationId) ||
    !verificationMatchesManifest(manifest, verification) ||
    !isRuntimeVerifiedGeneration(verification) ||
    verification.kind !== "remote" ||
    verification.provider !== provider ||
    verification.providerObjectId === null ||
    verification.providerObjectPath !== getGenerationObjectPath(manifest)
  ) {
    return err(new LenaError("invalid_state_transition"));
  }

  const planFields: ImmutableTransportDeletePlan = {
    [immutableTransportDeletePlanBrand]: "ImmutableTransportDeletePlan",
    authorizedByRetention: true as const,
    executionAuthorized: false as const,
    expectedObjectByteLength: verification.objectByteLength,
    expectedObjectChecksum: verification.objectChecksum,
    generationId: manifest.generationId,
    provider,
    providerObjectId: verification.providerObjectId,
    remotePath: verification.providerObjectPath,
    vaultId: manifest.vaultId,
  };
  const plan = Object.freeze(planFields);
  authorizedDeletePlans.add(plan);
  return ok(plan);
}

export function isAuthorizedImmutableTransportDeletePlan(
  value: unknown,
): value is ImmutableTransportDeletePlan {
  return typeof value === "object" && value !== null && authorizedDeletePlans.has(value);
}
