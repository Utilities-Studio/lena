import {
  err,
  generationIdSchema,
  isSchemaCompatible,
  isoTimestampSchema,
  LenaError,
  ok,
  schemaCompatibilityRangeSchema,
  schemaVersionSchema,
  vaultIdSchema,
  type Result,
} from "@lena/core";
import { sortKeys } from "es-toolkit";
import { z } from "zod";
import { sha256ChecksumSchema } from "./checksum";

export const BACKUP_MANIFEST_FORMAT_VERSION = 1 as const;
export const BACKUP_ENVELOPE_ALGORITHM = "AES-256-GCM" as const;
export const MAX_BACKUP_BYTE_LENGTH = 2_147_483_648;
export const MAX_ATTACHMENT_COUNT = 100_000;
export const MAX_RECORD_TYPE_COUNT = 128;
export const MAX_APP_VERSION_LENGTH = 80;

function boundedNonNegativeIntegerSchema(maximum: number) {
  return z.number().int().refine(Number.isSafeInteger).min(0).max(maximum);
}

export const backupReasonSchema = z.enum([
  "daily",
  "manual",
  "monthly",
  "mutation",
  "pre-destructive-action",
  "pre-migration",
]);

export type BackupReason = z.infer<typeof backupReasonSchema>;

export const backupEncryptionDescriptorSchema = z
  .strictObject({
    algorithm: z.literal(BACKUP_ENVELOPE_ALGORITHM),
    envelopeVersion: z.number().int().refine(Number.isSafeInteger).min(1),
    nonceByteLength: z.literal(12),
    tagByteLength: z.literal(16),
  })
  .readonly();

export type BackupEncryptionDescriptor = z.infer<typeof backupEncryptionDescriptorSchema>;

export const backupRecordCountsSchema = z
  .record(
    z.string().regex(/^[a-z][a-z0-9_]{0,63}$/),
    boundedNonNegativeIntegerSchema(Number.MAX_SAFE_INTEGER),
  )
  .superRefine((recordCounts, context) => {
    if (Object.keys(recordCounts).length > MAX_RECORD_TYPE_COUNT) {
      context.addIssue({ code: "custom", message: "record_type_limit_exceeded" });
    }
  })
  .readonly();

export const backupPayloadDescriptorSchema = z
  .strictObject({
    attachmentByteLength: boundedNonNegativeIntegerSchema(MAX_BACKUP_BYTE_LENGTH),
    attachmentCount: boundedNonNegativeIntegerSchema(MAX_ATTACHMENT_COUNT),
    contentByteLength: boundedNonNegativeIntegerSchema(MAX_BACKUP_BYTE_LENGTH),
    contentChecksum: sha256ChecksumSchema,
    recordCounts: backupRecordCountsSchema,
  })
  .superRefine((payload, context) => {
    if (payload.attachmentByteLength > payload.contentByteLength) {
      context.addIssue({
        code: "custom",
        message: "attachment_bytes_exceed_content_bytes",
        path: ["attachmentByteLength"],
      });
    }
  })
  .readonly();

export type BackupPayloadDescriptor = z.infer<typeof backupPayloadDescriptorSchema>;

/**
 * Version 1 belongs inside the authenticated encrypted generation envelope.
 * Parsing this structure validates claims only. It does not create runtime verification evidence.
 */
export const generationManifestV1Schema = z
  .strictObject({
    applicationVersion: z.string().min(1).max(MAX_APP_VERSION_LENGTH),
    completedAt: isoTimestampSchema,
    compatibleSchema: schemaCompatibilityRangeSchema,
    createdAt: isoTimestampSchema,
    encryption: backupEncryptionDescriptorSchema,
    formatVersion: z.literal(BACKUP_MANIFEST_FORMAT_VERSION),
    generationId: generationIdSchema,
    parentGenerationId: generationIdSchema.nullable(),
    payload: backupPayloadDescriptorSchema,
    reason: backupReasonSchema,
    schemaVersion: schemaVersionSchema,
    vaultId: vaultIdSchema,
  })
  .superRefine((manifest, context) => {
    if (manifest.createdAt > manifest.completedAt) {
      context.addIssue({
        code: "custom",
        message: "completed_before_created",
        path: ["completedAt"],
      });
    }
    if (!isSchemaCompatible(manifest.schemaVersion, manifest.compatibleSchema)) {
      context.addIssue({
        code: "custom",
        message: "schema_outside_compatibility_range",
        path: ["schemaVersion"],
      });
    }
  })
  .readonly();

export const generationManifestSchema = generationManifestV1Schema;

export type GenerationManifest = z.infer<typeof generationManifestSchema>;

const manifestVersionSchema = z.object({ formatVersion: z.unknown() });

export function parseGenerationManifest(value: unknown): Result<GenerationManifest, LenaError> {
  const version = manifestVersionSchema.safeParse(value);
  if (version.success && version.data.formatVersion !== BACKUP_MANIFEST_FORMAT_VERSION) {
    return err(new LenaError("unsupported", "Unsupported backup manifest format"));
  }

  const parsed = generationManifestSchema.safeParse(value);
  if (!parsed.success) {
    return err(new LenaError("invalid_input", "Invalid generation manifest"));
  }

  return ok(parsed.data);
}

export function getGenerationObjectPath(manifest: GenerationManifest): string {
  return `vaults/${manifest.vaultId}/generations/${manifest.generationId}.lena`;
}

/** Deterministic plaintext serialization performed immediately before envelope encryption. */
export function serializeGenerationManifest(
  manifest: GenerationManifest,
): Result<string, LenaError> {
  const validated = parseGenerationManifest(manifest);
  if (validated.isErr()) return err(validated.error);
  const value = validated.value;
  const recordCounts = sortKeys(value.payload.recordCounts);

  return ok(
    JSON.stringify({
      applicationVersion: value.applicationVersion,
      completedAt: value.completedAt,
      compatibleSchema: {
        maximum: value.compatibleSchema.maximum,
        minimum: value.compatibleSchema.minimum,
      },
      createdAt: value.createdAt,
      encryption: {
        algorithm: value.encryption.algorithm,
        envelopeVersion: value.encryption.envelopeVersion,
        nonceByteLength: value.encryption.nonceByteLength,
        tagByteLength: value.encryption.tagByteLength,
      },
      formatVersion: value.formatVersion,
      generationId: value.generationId,
      parentGenerationId: value.parentGenerationId,
      payload: {
        attachmentByteLength: value.payload.attachmentByteLength,
        attachmentCount: value.payload.attachmentCount,
        contentByteLength: value.payload.contentByteLength,
        contentChecksum: value.payload.contentChecksum,
        recordCounts,
      },
      reason: value.reason,
      schemaVersion: value.schemaVersion,
      vaultId: value.vaultId,
    }),
  );
}
