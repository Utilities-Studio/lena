import {
  effectIdSchema,
  err,
  generationIdSchema,
  isoTimestampSchema,
  LenaError,
  ok,
  vaultIdSchema,
  type Result,
} from "@lena/core";
import { match } from "ts-pattern";
import { z } from "zod";
import { sha256ChecksumSchema } from "./checksum";
import {
  getRuntimeLocalCiphertextUri,
  isRuntimeRemoteObjectReceipt,
  isRuntimeVerifiedGeneration,
  type GenerationVerificationKind,
  type GenerationVerificationFields,
  type LocalVerifiedGenerationInput,
  type RemoteBackupProvider,
  type RemoteObjectReceipt,
  type RemoteObjectReceiptInput,
  type VerifiedGeneration,
} from "./runtime-evidence";

export { getRuntimeLocalCiphertextUri, isRuntimeRemoteObjectReceipt, isRuntimeVerifiedGeneration };
export type {
  GenerationVerificationKind,
  GenerationVerificationFields,
  LocalVerifiedGenerationInput,
  RemoteBackupProvider,
  RemoteObjectReceipt,
  RemoteObjectReceiptInput,
  VerifiedGeneration,
};

export const remoteBackupProviderSchema = z.enum(["google-drive", "icloud"]);

const objectByteLengthSchema = z.number().int().refine(Number.isSafeInteger).min(0);
const providerObjectIdSchema = z
  .string()
  .max(512)
  .refine((value) => value.trim().length > 0 && !/[\r\n]/.test(value));
const providerObjectPathSchema = z
  .string()
  .max(1_024)
  .refine((value) => value.trim().length > 0 && !/[\r\n]/.test(value));

export const persistedRemoteObjectReceiptClaimSchema = z
  .strictObject({
    claimId: effectIdSchema,
    generationId: generationIdSchema,
    objectByteLength: objectByteLengthSchema,
    objectChecksum: sha256ChecksumSchema,
    provider: remoteBackupProviderSchema,
    providerObjectId: providerObjectIdSchema,
    providerObjectPath: providerObjectPathSchema,
    verifiedAt: isoTimestampSchema,
    vaultId: vaultIdSchema,
  })
  .readonly()
  .brand<"PersistedRemoteObjectReceiptClaim">();

export type PersistedRemoteObjectReceiptClaim = z.infer<
  typeof persistedRemoteObjectReceiptClaimSchema
>;

const persistedLocalGenerationVerificationClaimSchema = z.strictObject({
  claimId: z.null(),
  generationId: generationIdSchema,
  kind: z.literal("local"),
  objectByteLength: objectByteLengthSchema,
  objectChecksum: sha256ChecksumSchema,
  provider: z.null(),
  providerObjectId: z.null(),
  providerObjectPath: z.null(),
  verifiedAt: isoTimestampSchema,
  vaultId: vaultIdSchema,
});

const persistedRemoteGenerationVerificationClaimSchema = z.strictObject({
  claimId: effectIdSchema,
  generationId: generationIdSchema,
  kind: z.literal("remote"),
  objectByteLength: objectByteLengthSchema,
  objectChecksum: sha256ChecksumSchema,
  provider: remoteBackupProviderSchema,
  providerObjectId: providerObjectIdSchema,
  providerObjectPath: providerObjectPathSchema,
  verifiedAt: isoTimestampSchema,
  vaultId: vaultIdSchema,
});

export const persistedGenerationVerificationClaimSchema = z
  .discriminatedUnion("kind", [
    persistedLocalGenerationVerificationClaimSchema,
    persistedRemoteGenerationVerificationClaimSchema,
  ])
  .readonly()
  .brand<"PersistedGenerationVerificationClaim">();

export type PersistedGenerationVerificationClaim = z.infer<
  typeof persistedGenerationVerificationClaimSchema
>;

export type BackupTransportFailureKind =
  | "authentication-required"
  | "cancelled"
  | "conflict"
  | "fatal"
  | "not-found"
  | "quota-exceeded"
  | "retryable";

export interface BackupTransportFailure {
  readonly kind: BackupTransportFailureKind;
  readonly retryable: boolean;
  readonly userActionRequired: boolean;
}

export function parseRemoteBackupProvider(value: unknown): Result<RemoteBackupProvider, LenaError> {
  const parsed = remoteBackupProviderSchema.safeParse(value);
  return parsed.success
    ? ok(parsed.data)
    : err(new LenaError("invalid_input", "Invalid remote backup provider"));
}

/**
 * Parses a durable structural claim only. Runtime receipt authority remains owned by runtime-evidence.
 */
export function parsePersistedRemoteObjectReceiptClaim(
  value: unknown,
): Result<PersistedRemoteObjectReceiptClaim, LenaError> {
  const parsed = persistedRemoteObjectReceiptClaimSchema.safeParse(value);
  if (!parsed.success) {
    return err(new LenaError("invalid_input", "Invalid persisted remote object receipt"));
  }

  return ok(parsed.data);
}

export function createPersistedLocalVerificationClaim(
  input: LocalVerifiedGenerationInput,
): Result<PersistedGenerationVerificationClaim, LenaError> {
  const parsed = persistedGenerationVerificationClaimSchema.safeParse({
    claimId: null,
    generationId: input.generationId,
    kind: "local",
    objectByteLength: input.objectByteLength,
    objectChecksum: input.objectChecksum,
    provider: null,
    providerObjectId: null,
    providerObjectPath: null,
    verifiedAt: input.verifiedAt,
    vaultId: input.vaultId,
  });
  if (!parsed.success) {
    return err(new LenaError("invalid_input", "Invalid local verification claim"));
  }

  return ok(parsed.data);
}

/**
 * Parses durable provenance without adding it to the runtime verification WeakSet.
 */
export function parsePersistedGenerationVerificationClaim(
  value: unknown,
): Result<PersistedGenerationVerificationClaim, LenaError> {
  const parsed = persistedGenerationVerificationClaimSchema.safeParse(value);
  if (!parsed.success) {
    return err(new LenaError("invalid_input", "Invalid persisted generation verification"));
  }

  return ok(parsed.data);
}

export function transportFailure(kind: BackupTransportFailureKind): BackupTransportFailure {
  return match(kind)
    .with("authentication-required", (value) =>
      Object.freeze({ kind: value, retryable: true, userActionRequired: true }),
    )
    .with("cancelled", (value) =>
      Object.freeze({ kind: value, retryable: false, userActionRequired: false }),
    )
    .with("conflict", (value) =>
      Object.freeze({ kind: value, retryable: false, userActionRequired: true }),
    )
    .with("fatal", (value) =>
      Object.freeze({ kind: value, retryable: false, userActionRequired: true }),
    )
    .with("not-found", (value) =>
      Object.freeze({ kind: value, retryable: false, userActionRequired: false }),
    )
    .with("quota-exceeded", (value) =>
      Object.freeze({ kind: value, retryable: true, userActionRequired: true }),
    )
    .with("retryable", (value) =>
      Object.freeze({ kind: value, retryable: true, userActionRequired: false }),
    )
    .exhaustive();
}
