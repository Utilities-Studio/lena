import {
  getGenerationObjectPath,
  getRuntimeLocalCiphertextUri,
  isAuthorizedRetentionPlan,
  isRuntimeClaimedBackupAttempt,
  isRuntimeRemoteObjectReceipt,
  isRuntimeVerifiedGeneration,
  transportFailure,
  type BackupTransportFailure,
  type BackupAttempt,
  type GenerationManifest,
  type RemoteObjectReceipt,
  type RetentionPlan,
  type VerifiedGeneration,
} from "@lena/backup";
import {
  err,
  LenaError,
  ok,
  type EffectId,
  type GenerationId,
  type Result,
  type VaultId,
} from "@lena/core";
import { match } from "ts-pattern";
import { z } from "zod";

const iCloudUploadPlanMarker = Symbol("lena.icloud-upload-plan");
const iCloudDeletePlanMarker = Symbol("lena.icloud-delete-plan");
const authorizedICloudUploadPlans = new WeakSet<object>();
const authorizedICloudDeletePlans = new WeakSet<object>();

export type ICloudImmutableUploadPlan = Readonly<{
  readonly [iCloudUploadPlanMarker]: true;
  readonly claimId: EffectId;
  readonly conflictBehavior: "verify-existing-exact-object";
  readonly expectedObjectByteLength: number;
  readonly expectedObjectChecksum: VerifiedGeneration["objectChecksum"];
  readonly generationId: GenerationId;
  readonly localCiphertextUri: string;
  readonly remotePath: string;
  readonly vaultId: VaultId;
  readonly visibility: "app-private";
}>;

export interface ICloudConflictTarget extends ICloudExactObjectPlan {}

export interface ICloudListPlan {
  readonly continuationToken: string | null;
  readonly prefix: string;
  readonly readOnly: true;
}

export interface ICloudExactObjectPlan {
  readonly providerObjectId: string;
  readonly remotePath: string;
}

export interface ICloudDownloadPlan extends ICloudExactObjectPlan {
  readonly expectedObjectByteLength: number;
  readonly expectedObjectChecksum: VerifiedGeneration["objectChecksum"];
  readonly materializePlaceholder: true;
  readonly stagingCiphertextUri: string;
}

export type ICloudDeletePlan = Readonly<
  ICloudExactObjectPlan & {
    readonly [iCloudDeletePlanMarker]: true;
    readonly authorizedByRetention: true;
    readonly expectedObjectByteLength: number;
    readonly expectedObjectChecksum: VerifiedGeneration["objectChecksum"];
    readonly generationId: VerifiedGeneration["generationId"];
    readonly vaultId: VaultId;
  }
>;

export const iCloudFailureCodeSchema = z.enum([
  "account-changed",
  "cancelled",
  "conflict",
  "not-authenticated",
  "not-found",
  "quota",
  "temporarily-unavailable",
  "unknown",
]);

export type ICloudFailureCode = z.infer<typeof iCloudFailureCodeSchema>;

export const iCloudContinuationTokenSchema = z
  .string()
  .max(1_024)
  .refine((value) => value.trim().length > 0);

export const iCloudProviderObjectIdSchema = z
  .string()
  .max(512)
  .refine((value) => value.trim().length > 0 && !/[\r\n]/.test(value));

export const iCloudCiphertextUriSchema = z
  .string()
  .max(2_048)
  .refine((value) => value.trim().length > 0 && !/[\r\n]/.test(value));

export const iCloudConflictTargetSchema = z
  .strictObject({
    providerObjectId: iCloudProviderObjectIdSchema,
    remotePath: z
      .string()
      .max(1_024)
      .refine((value) => value.trim().length > 0 && !/[\r\n]/.test(value)),
  })
  .readonly();

function validateUri(value: string, boundary: string): Result<string, LenaError> {
  const parsed = iCloudCiphertextUriSchema.safeParse(value);
  if (!parsed.success) {
    return err(new LenaError("invalid_input", `Invalid ${boundary} URI`));
  }
  return ok(parsed.data);
}

function verificationMatchesManifest(
  manifest: GenerationManifest,
  verification: VerifiedGeneration,
): boolean {
  return (
    verification.generationId === manifest.generationId && verification.vaultId === manifest.vaultId
  );
}

export function createICloudImmutableUploadPlan(
  manifest: GenerationManifest,
  verification: VerifiedGeneration,
  attempt: BackupAttempt,
): Result<ICloudImmutableUploadPlan, LenaError> {
  const localCiphertextUri = getRuntimeLocalCiphertextUri(verification);
  if (
    !isRuntimeVerifiedGeneration(verification) ||
    verification.kind !== "local" ||
    verification.provider !== null ||
    verification.providerObjectId !== null ||
    verification.providerObjectPath !== null ||
    localCiphertextUri === null ||
    !verificationMatchesManifest(manifest, verification) ||
    !isRuntimeClaimedBackupAttempt(attempt) ||
    attempt.state !== "uploading" ||
    attempt.provider !== "icloud" ||
    attempt.vaultId !== manifest.vaultId ||
    attempt.generationId !== manifest.generationId ||
    attempt.objectByteLength !== verification.objectByteLength ||
    attempt.objectChecksum !== verification.objectChecksum
  ) {
    return err(new LenaError("integrity_failed", "Verified object and manifest do not match"));
  }

  const plan = Object.freeze({
    [iCloudUploadPlanMarker]: true as const,
    claimId: attempt.claimId,
    conflictBehavior: "verify-existing-exact-object" as const,
    expectedObjectByteLength: verification.objectByteLength,
    expectedObjectChecksum: verification.objectChecksum,
    generationId: manifest.generationId,
    localCiphertextUri,
    remotePath: getGenerationObjectPath(manifest),
    vaultId: manifest.vaultId,
    visibility: "app-private" as const,
  });
  authorizedICloudUploadPlans.add(plan);
  return ok(plan);
}

export function isAuthorizedICloudImmutableUploadPlan(
  value: unknown,
): value is ICloudImmutableUploadPlan {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as { readonly [iCloudUploadPlanMarker]?: unknown })[iCloudUploadPlanMarker] === true &&
    authorizedICloudUploadPlans.has(value)
  );
}

export function isAuthorizedICloudDeletePlan(value: unknown): value is ICloudDeletePlan {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as { readonly [iCloudDeletePlanMarker]?: unknown })[iCloudDeletePlanMarker] === true &&
    authorizedICloudDeletePlans.has(value)
  );
}

export function createICloudListPlan(
  vaultId: VaultId,
  continuationToken: string | null = null,
): Result<ICloudListPlan, LenaError> {
  const parsedToken = z
    .union([iCloudContinuationTokenSchema, z.null()])
    .safeParse(continuationToken);
  if (!parsedToken.success) {
    return err(new LenaError("invalid_input", "Invalid iCloud continuation token"));
  }
  return ok(
    Object.freeze({
      continuationToken: parsedToken.data,
      prefix: `vaults/${vaultId}/generations/`,
      readOnly: true as const,
    }),
  );
}

export function createICloudInspectPlan(
  manifest: GenerationManifest,
  providerObjectId: string,
): Result<ICloudExactObjectPlan, LenaError> {
  const parsedObjectId = iCloudProviderObjectIdSchema.safeParse(providerObjectId);
  if (!parsedObjectId.success) {
    return err(new LenaError("invalid_input", "Invalid iCloud object id"));
  }
  return ok(
    Object.freeze({
      providerObjectId: parsedObjectId.data,
      remotePath: getGenerationObjectPath(manifest),
    }),
  );
}

export function reconcileICloudUploadConflict(
  plan: ICloudImmutableUploadPlan,
  target: ICloudConflictTarget,
  receipt: RemoteObjectReceipt,
): Result<RemoteObjectReceipt, LenaError> {
  const parsedTarget = iCloudConflictTargetSchema.safeParse(target);
  if (
    !parsedTarget.success ||
    !isAuthorizedICloudImmutableUploadPlan(plan) ||
    !isRuntimeRemoteObjectReceipt(receipt) ||
    parsedTarget.data.remotePath !== plan.remotePath ||
    parsedTarget.data.providerObjectId !== receipt.providerObjectId ||
    receipt.claimId !== plan.claimId ||
    receipt.provider !== "icloud" ||
    receipt.vaultId !== plan.vaultId ||
    receipt.generationId !== plan.generationId ||
    receipt.providerObjectPath !== plan.remotePath ||
    receipt.objectByteLength !== plan.expectedObjectByteLength ||
    receipt.objectChecksum !== plan.expectedObjectChecksum
  ) {
    return err(new LenaError("conflict", "Existing iCloud object is not the expected generation"));
  }
  return ok(receipt);
}

export function createICloudDownloadPlan(
  manifest: GenerationManifest,
  verification: VerifiedGeneration,
  stagingCiphertextUri: string,
): Result<ICloudDownloadPlan, LenaError> {
  const uri = validateUri(stagingCiphertextUri, "staging ciphertext");
  if (uri.isErr()) return err(uri.error);
  if (
    !verificationMatchesManifest(manifest, verification) ||
    !isRuntimeVerifiedGeneration(verification) ||
    verification.kind !== "remote" ||
    verification.provider !== "icloud" ||
    verification.providerObjectId === null ||
    verification.providerObjectPath !== getGenerationObjectPath(manifest)
  ) {
    return err(new LenaError("integrity_failed", "iCloud verification does not match download"));
  }
  return ok(
    Object.freeze({
      expectedObjectByteLength: verification.objectByteLength,
      expectedObjectChecksum: verification.objectChecksum,
      materializePlaceholder: true as const,
      providerObjectId: verification.providerObjectId,
      remotePath: getGenerationObjectPath(manifest),
      stagingCiphertextUri: uri.value,
    }),
  );
}

export function createICloudDeletePlan(
  manifest: GenerationManifest,
  verification: VerifiedGeneration,
  retention: RetentionPlan,
): Result<ICloudDeletePlan, LenaError> {
  if (
    !isAuthorizedRetentionPlan(retention) ||
    retention.vaultId !== manifest.vaultId ||
    !retention.delete.includes(manifest.generationId) ||
    !verificationMatchesManifest(manifest, verification) ||
    !isRuntimeVerifiedGeneration(verification) ||
    verification.kind !== "remote" ||
    verification.provider !== "icloud" ||
    verification.providerObjectId === null ||
    verification.providerObjectPath !== getGenerationObjectPath(manifest)
  ) {
    return err(new LenaError("invalid_state_transition", "iCloud deletion is not authorized"));
  }
  const plan = Object.freeze({
    [iCloudDeletePlanMarker]: true as const,
    authorizedByRetention: true as const,
    expectedObjectByteLength: verification.objectByteLength,
    expectedObjectChecksum: verification.objectChecksum,
    generationId: manifest.generationId,
    providerObjectId: verification.providerObjectId,
    remotePath: getGenerationObjectPath(manifest),
    vaultId: manifest.vaultId,
  });
  authorizedICloudDeletePlans.add(plan);
  return ok(plan);
}

export function classifyICloudFailure(code: ICloudFailureCode): BackupTransportFailure {
  return match(code)
    .with("account-changed", "not-authenticated", () => transportFailure("authentication-required"))
    .with("cancelled", () => transportFailure("cancelled"))
    .with("conflict", () => transportFailure("conflict"))
    .with("not-found", () => transportFailure("not-found"))
    .with("quota", () => transportFailure("quota-exceeded"))
    .with("temporarily-unavailable", () => transportFailure("retryable"))
    .with("unknown", () => transportFailure("fatal"))
    .exhaustive();
}

export function classifyUnknownICloudFailure(code: unknown): BackupTransportFailure {
  const parsed = iCloudFailureCodeSchema.safeParse(code);
  return parsed.success ? classifyICloudFailure(parsed.data) : transportFailure("fatal");
}
