import {
  err,
  isoTimestampSchema,
  LenaError,
  ok,
  type Result,
  schemaVersionSchema,
  vaultIdSchema,
  vaultInstanceIdSchema,
  type IsoTimestamp,
  type SchemaVersion,
  type VaultId,
  type VaultInstanceId,
} from "@lena/core";
import { z } from "zod";

export const VAULT_METADATA_FORMAT_VERSION = 1 as const;

const positiveSafeIntegerSchema = z.number().int().min(1).max(Number.MAX_SAFE_INTEGER);
const vaultMetadataStructureSchema = z.strictObject({
  createdAt: z.unknown(),
  encryptionEnvelopeVersion: z.unknown(),
  formatVersion: z.unknown(),
  schemaVersion: z.unknown(),
  vaultId: z.unknown(),
  vaultInstanceId: z.unknown(),
});

export const vaultMetadataSchema = z
  .strictObject({
    createdAt: isoTimestampSchema,
    encryptionEnvelopeVersion: positiveSafeIntegerSchema,
    formatVersion: z.literal(VAULT_METADATA_FORMAT_VERSION),
    schemaVersion: schemaVersionSchema,
    vaultId: vaultIdSchema,
    vaultInstanceId: vaultInstanceIdSchema,
  })
  .readonly();

export type VaultMetadata = z.infer<typeof vaultMetadataSchema>;

export function createVaultMetadata(input: {
  createdAt: IsoTimestamp;
  encryptionEnvelopeVersion: number;
  schemaVersion: SchemaVersion;
  vaultId: VaultId;
  vaultInstanceId: VaultInstanceId;
}): Result<VaultMetadata, LenaError> {
  return parseVaultMetadata({ ...input, formatVersion: VAULT_METADATA_FORMAT_VERSION });
}

export function parseVaultMetadata(value: unknown): Result<VaultMetadata, LenaError> {
  const structure = vaultMetadataStructureSchema.safeParse(value);
  if (!structure.success) {
    return err(
      new LenaError("invalid_input", {
        boundary: "vault_metadata",
      }),
    );
  }

  if (structure.data.formatVersion !== VAULT_METADATA_FORMAT_VERSION) {
    return err(
      new LenaError("unsupported", {
        formatVersion:
          typeof structure.data.formatVersion === "number" ? structure.data.formatVersion : null,
      }),
    );
  }

  const parsed = vaultMetadataSchema.safeParse(structure.data);
  if (parsed.success) return ok(parsed.data);

  const failedField = parsed.error.issues[0]?.path[0];
  if (failedField === "vaultId") {
    return err(new LenaError("invalid_identifier", { kind: "VaultId" }));
  }
  if (failedField === "vaultInstanceId") {
    return err(
      new LenaError("invalid_identifier", {
        kind: "VaultInstanceId",
      }),
    );
  }
  if (failedField === "createdAt") {
    return err(new LenaError("invalid_timestamp"));
  }
  if (failedField === "encryptionEnvelopeVersion") {
    return err(new LenaError("invalid_input"));
  }

  return err(
    new LenaError("invalid_input", {
      boundary: "vault_metadata",
    }),
  );
}
