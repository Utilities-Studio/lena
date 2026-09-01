import {
  getGenerationObjectPath,
  getRuntimeLocalCiphertextUri,
  isAuthorizedRetentionPlan,
  isRuntimeClaimedBackupAttempt,
  isRuntimeRemoteObjectReceipt,
  isRuntimeVerifiedGeneration,
  sha256ChecksumSchema,
  transportFailure,
  type BackupTransportFailure,
  type BackupAttempt,
  type GenerationManifest,
  type RemoteObjectReceipt,
  type RetentionPlan,
  type VerifiedGeneration,
} from "@lena/backup";
import {
  effectIdSchema,
  err,
  generationIdSchema,
  LenaError,
  ok,
  vaultIdSchema,
  type EffectId,
  type GenerationId,
  type Result,
  type VaultId,
} from "@lena/core";
import { match } from "ts-pattern";
import { z } from "zod";

const googleDriveUploadPlanMarker = Symbol("lena.google-drive-upload-plan");
const googleDriveDeletePlanMarker = Symbol("lena.google-drive-delete-plan");
const authorizedGoogleDriveUploadPlans = new WeakSet<object>();
const authorizedGoogleDriveDeletePlans = new WeakSet<object>();

export type GoogleDriveImmutableUploadPlan = Readonly<{
  readonly [googleDriveUploadPlanMarker]: true;
  readonly claimId: EffectId;
  readonly conflictBehavior: "verify-existing-exact-object";
  readonly expectedObjectByteLength: number;
  readonly expectedObjectChecksum: VerifiedGeneration["objectChecksum"];
  readonly folder: "appDataFolder";
  readonly generationId: GenerationId;
  readonly localCiphertextUri: string;
  readonly remotePath: string;
  readonly requiredScope: "drive.appdata";
  readonly resumable: true;
  readonly vaultId: VaultId;
}>;

export interface GoogleDriveListPlan {
  readonly folder: "appDataFolder";
  readonly pageSize: number;
  readonly pageToken: string | null;
  readonly prefix: string;
  readonly readOnly: true;
  readonly requiredScope: "drive.appdata";
}

export interface GoogleDriveExactObjectPlan {
  readonly folder: "appDataFolder";
  readonly providerObjectId: string;
  readonly requiredScope: "drive.appdata";
}

export interface GoogleDriveDownloadPlan extends GoogleDriveExactObjectPlan {
  readonly expectedObjectByteLength: number;
  readonly expectedObjectChecksum: VerifiedGeneration["objectChecksum"];
  readonly stagingCiphertextUri: string;
}

export type GoogleDriveDeletePlan = Readonly<
  GoogleDriveExactObjectPlan & {
    readonly [googleDriveDeletePlanMarker]: true;
    readonly authorizedByRetention: true;
    readonly expectedObjectByteLength: number;
    readonly expectedObjectChecksum: VerifiedGeneration["objectChecksum"];
    readonly generationId: VerifiedGeneration["generationId"];
    readonly vaultId: VaultId;
  }
>;

export interface GoogleDriveConflictTarget extends GoogleDriveExactObjectPlan {
  readonly remotePath: string;
}

const googleDriveObjectByteLengthSchema = z.number().int().refine(Number.isSafeInteger).min(0);

export const googleDrivePageTokenSchema = z
  .string()
  .max(1_024)
  .refine((value) => value.trim().length > 0);

export const googleDriveProviderObjectIdSchema = z
  .string()
  .max(512)
  .refine((value) => value.trim().length > 0 && !/[\r\n]/.test(value));

export const googleDriveCiphertextUriSchema = z
  .string()
  .max(2_048)
  .refine((value) => value.trim().length > 0 && !/[\r\n]/.test(value));

const googleDriveRemotePathSchema = z
  .string()
  .max(1_024)
  .refine((value) => value.trim().length > 0 && !/[\r\n]/.test(value));

export const googleDriveListInputSchema = z
  .strictObject({
    pageSize: z.number().int().refine(Number.isSafeInteger).min(1).max(1_000).optional(),
    pageToken: googleDrivePageTokenSchema.nullable().optional(),
  })
  .readonly();

export const googleDriveConflictTargetSchema = z
  .strictObject({
    folder: z.literal("appDataFolder"),
    providerObjectId: googleDriveProviderObjectIdSchema,
    remotePath: googleDriveRemotePathSchema,
    requiredScope: z.literal("drive.appdata"),
  })
  .readonly();

export const googleDriveResumableCheckpointSchema = z
  .strictObject({
    claimId: effectIdSchema,
    committedByteLength: googleDriveObjectByteLengthSchema,
    expectedObjectByteLength: googleDriveObjectByteLengthSchema,
    expectedObjectChecksum: sha256ChecksumSchema,
    generationId: generationIdSchema,
    localCiphertextUri: googleDriveCiphertextUriSchema,
    remotePath: googleDriveRemotePathSchema,
    sessionId: z
      .string()
      .max(1_024)
      .refine((value) => value.trim().length > 0 && !/[\r\n]/.test(value)),
    vaultId: vaultIdSchema,
  })
  .superRefine((checkpoint, context) => {
    if (checkpoint.committedByteLength > checkpoint.expectedObjectByteLength) {
      context.addIssue({
        code: "custom",
        message: "committed_bytes_exceed_expected_bytes",
        path: ["committedByteLength"],
      });
    }
  })
  .readonly();

export type GoogleDriveResumableCheckpoint = z.infer<typeof googleDriveResumableCheckpointSchema>;

export interface GoogleDriveResumeUploadPlan {
  readonly checkpoint: GoogleDriveResumableCheckpoint;
  readonly remainingByteLength: number;
  readonly upload: GoogleDriveImmutableUploadPlan;
}

export const googleDriveFailureCodeSchema = z.enum([
  "account-changed",
  "cancelled",
  "conflict",
  "not-found",
  "quota",
  "rate-limited",
  "token-expired",
  "unknown",
]);

export type GoogleDriveFailureCode = z.infer<typeof googleDriveFailureCodeSchema>;

function validateUri(value: string, boundary: string): Result<string, LenaError> {
  const parsed = googleDriveCiphertextUriSchema.safeParse(value);
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

export function createGoogleDriveImmutableUploadPlan(
  manifest: GenerationManifest,
  verification: VerifiedGeneration,
  attempt: BackupAttempt,
): Result<GoogleDriveImmutableUploadPlan, LenaError> {
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
    attempt.provider !== "google-drive" ||
    attempt.vaultId !== manifest.vaultId ||
    attempt.generationId !== manifest.generationId ||
    attempt.objectByteLength !== verification.objectByteLength ||
    attempt.objectChecksum !== verification.objectChecksum
  ) {
    return err(new LenaError("integrity_failed", "Verified object and manifest do not match"));
  }

  const plan = Object.freeze({
    [googleDriveUploadPlanMarker]: true as const,
    claimId: attempt.claimId,
    conflictBehavior: "verify-existing-exact-object" as const,
    expectedObjectByteLength: verification.objectByteLength,
    expectedObjectChecksum: verification.objectChecksum,
    folder: "appDataFolder" as const,
    generationId: manifest.generationId,
    localCiphertextUri,
    remotePath: getGenerationObjectPath(manifest),
    requiredScope: "drive.appdata" as const,
    resumable: true as const,
    vaultId: manifest.vaultId,
  });
  authorizedGoogleDriveUploadPlans.add(plan);
  return ok(plan);
}

export function isAuthorizedGoogleDriveImmutableUploadPlan(
  value: unknown,
): value is GoogleDriveImmutableUploadPlan {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as { readonly [googleDriveUploadPlanMarker]?: unknown })[googleDriveUploadPlanMarker] ===
      true &&
    authorizedGoogleDriveUploadPlans.has(value)
  );
}

export function isAuthorizedGoogleDriveDeletePlan(value: unknown): value is GoogleDriveDeletePlan {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as { readonly [googleDriveDeletePlanMarker]?: unknown })[googleDriveDeletePlanMarker] ===
      true &&
    authorizedGoogleDriveDeletePlans.has(value)
  );
}

export function createGoogleDriveListPlan(
  vaultId: VaultId,
  input: z.input<typeof googleDriveListInputSchema> = {},
): Result<GoogleDriveListPlan, LenaError> {
  const parsedInput = googleDriveListInputSchema.safeParse(input);
  if (!parsedInput.success) {
    return err(new LenaError("invalid_input", "Invalid Google Drive list input"));
  }
  const pageSize = parsedInput.data.pageSize ?? 100;
  const pageToken = parsedInput.data.pageToken ?? null;
  return ok(
    Object.freeze({
      folder: "appDataFolder" as const,
      pageSize,
      pageToken,
      prefix: `vaults/${vaultId}/generations/`,
      readOnly: true as const,
      requiredScope: "drive.appdata" as const,
    }),
  );
}

export function createGoogleDriveInspectPlan(
  providerObjectId: string,
): Result<GoogleDriveExactObjectPlan, LenaError> {
  const parsedObjectId = googleDriveProviderObjectIdSchema.safeParse(providerObjectId);
  if (!parsedObjectId.success) {
    return err(new LenaError("invalid_input", "Invalid Google Drive object id"));
  }
  return ok(
    Object.freeze({
      folder: "appDataFolder" as const,
      providerObjectId: parsedObjectId.data,
      requiredScope: "drive.appdata" as const,
    }),
  );
}

export function reconcileGoogleDriveUploadConflict(
  plan: GoogleDriveImmutableUploadPlan,
  target: GoogleDriveConflictTarget,
  receipt: RemoteObjectReceipt,
): Result<RemoteObjectReceipt, LenaError> {
  const parsedTarget = googleDriveConflictTargetSchema.safeParse(target);
  if (
    !parsedTarget.success ||
    !isAuthorizedGoogleDriveImmutableUploadPlan(plan) ||
    !isRuntimeRemoteObjectReceipt(receipt) ||
    parsedTarget.data.remotePath !== plan.remotePath ||
    parsedTarget.data.providerObjectId !== receipt.providerObjectId ||
    receipt.claimId !== plan.claimId ||
    receipt.provider !== "google-drive" ||
    receipt.vaultId !== plan.vaultId ||
    receipt.generationId !== plan.generationId ||
    receipt.providerObjectPath !== plan.remotePath ||
    receipt.objectByteLength !== plan.expectedObjectByteLength ||
    receipt.objectChecksum !== plan.expectedObjectChecksum
  ) {
    return err(
      new LenaError("conflict", "Existing Google Drive object is not the expected generation"),
    );
  }
  return ok(receipt);
}

export function createGoogleDriveDownloadPlan(
  manifest: GenerationManifest,
  verification: VerifiedGeneration,
  stagingCiphertextUri: string,
): Result<GoogleDriveDownloadPlan, LenaError> {
  const uri = validateUri(stagingCiphertextUri, "staging ciphertext");
  if (uri.isErr()) return err(uri.error);
  if (
    !verificationMatchesManifest(manifest, verification) ||
    !isRuntimeVerifiedGeneration(verification) ||
    verification.kind !== "remote" ||
    verification.provider !== "google-drive" ||
    verification.providerObjectId === null ||
    verification.providerObjectPath !== getGenerationObjectPath(manifest)
  ) {
    return err(
      new LenaError("integrity_failed", "Google Drive verification does not match download"),
    );
  }
  return ok(
    Object.freeze({
      expectedObjectByteLength: verification.objectByteLength,
      expectedObjectChecksum: verification.objectChecksum,
      folder: "appDataFolder" as const,
      providerObjectId: verification.providerObjectId,
      requiredScope: "drive.appdata" as const,
      stagingCiphertextUri: uri.value,
    }),
  );
}

export function createGoogleDriveDeletePlan(
  manifest: GenerationManifest,
  verification: VerifiedGeneration,
  retention: RetentionPlan,
): Result<GoogleDriveDeletePlan, LenaError> {
  if (
    !isAuthorizedRetentionPlan(retention) ||
    retention.vaultId !== manifest.vaultId ||
    !retention.delete.includes(manifest.generationId) ||
    !verificationMatchesManifest(manifest, verification) ||
    !isRuntimeVerifiedGeneration(verification) ||
    verification.kind !== "remote" ||
    verification.provider !== "google-drive" ||
    verification.providerObjectId === null ||
    verification.providerObjectPath !== getGenerationObjectPath(manifest)
  ) {
    return err(
      new LenaError("invalid_state_transition", "Google Drive deletion is not authorized"),
    );
  }
  const plan = Object.freeze({
    [googleDriveDeletePlanMarker]: true as const,
    authorizedByRetention: true as const,
    expectedObjectByteLength: verification.objectByteLength,
    expectedObjectChecksum: verification.objectChecksum,
    folder: "appDataFolder" as const,
    generationId: manifest.generationId,
    providerObjectId: verification.providerObjectId,
    requiredScope: "drive.appdata" as const,
    vaultId: manifest.vaultId,
  });
  authorizedGoogleDriveDeletePlans.add(plan);
  return ok(plan);
}

export function createGoogleDriveResumeUploadPlan(
  upload: GoogleDriveImmutableUploadPlan,
  checkpoint: GoogleDriveResumableCheckpoint,
): Result<GoogleDriveResumeUploadPlan, LenaError> {
  const parsedCheckpoint = googleDriveResumableCheckpointSchema.safeParse(checkpoint);
  if (
    !parsedCheckpoint.success ||
    !isAuthorizedGoogleDriveImmutableUploadPlan(upload) ||
    parsedCheckpoint.data.claimId !== upload.claimId ||
    parsedCheckpoint.data.vaultId !== upload.vaultId ||
    parsedCheckpoint.data.generationId !== upload.generationId ||
    parsedCheckpoint.data.localCiphertextUri !== upload.localCiphertextUri ||
    parsedCheckpoint.data.remotePath !== upload.remotePath ||
    parsedCheckpoint.data.expectedObjectChecksum !== upload.expectedObjectChecksum ||
    parsedCheckpoint.data.expectedObjectByteLength !== upload.expectedObjectByteLength ||
    parsedCheckpoint.data.committedByteLength > upload.expectedObjectByteLength
  ) {
    return err(new LenaError("invalid_input", "Invalid Google Drive upload checkpoint"));
  }
  return ok(
    Object.freeze({
      checkpoint: parsedCheckpoint.data,
      remainingByteLength:
        upload.expectedObjectByteLength - parsedCheckpoint.data.committedByteLength,
      upload,
    }),
  );
}

export function classifyGoogleDriveFailure(code: GoogleDriveFailureCode): BackupTransportFailure {
  return match(code)
    .with("account-changed", "token-expired", () => transportFailure("authentication-required"))
    .with("cancelled", () => transportFailure("cancelled"))
    .with("conflict", () => transportFailure("conflict"))
    .with("not-found", () => transportFailure("not-found"))
    .with("quota", () => transportFailure("quota-exceeded"))
    .with("rate-limited", () => transportFailure("retryable"))
    .with("unknown", () => transportFailure("fatal"))
    .exhaustive();
}

export function classifyUnknownGoogleDriveFailure(code: unknown): BackupTransportFailure {
  const parsed = googleDriveFailureCodeSchema.safeParse(code);
  return parsed.success ? classifyGoogleDriveFailure(parsed.data) : transportFailure("fatal");
}
