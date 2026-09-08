import { err, LenaError, ok, type Result } from "@lena/core";
import { z } from "zod";

const syncIdSchema = z.uuidv4();

export const syncChangeIdSchema = syncIdSchema.brand<"SyncChangeId">();
export const syncCheckpointIdSchema = syncIdSchema.brand<"SyncCheckpointId">();
export const syncConsentIdSchema = syncIdSchema.brand<"SyncConsentId">();
export const syncConsentRequestIdSchema = syncIdSchema.brand<"SyncConsentRequestId">();
export const syncReplicaIdSchema = syncIdSchema.brand<"SyncReplicaId">();
export const syncTombstoneIdSchema = syncIdSchema.brand<"SyncTombstoneId">();
export const syncProtocolVersionSchema = z
  .number()
  .int()
  .safe()
  .positive()
  .brand<"SyncProtocolVersion">();

export type SyncChangeId = z.infer<typeof syncChangeIdSchema>;
export type SyncCheckpointId = z.infer<typeof syncCheckpointIdSchema>;
export type SyncConsentId = z.infer<typeof syncConsentIdSchema>;
export type SyncConsentRequestId = z.infer<typeof syncConsentRequestIdSchema>;
export type SyncReplicaId = z.infer<typeof syncReplicaIdSchema>;
export type SyncTombstoneId = z.infer<typeof syncTombstoneIdSchema>;
export type SyncProtocolVersion = z.infer<typeof syncProtocolVersionSchema>;

function parseSyncId<Schema extends z.ZodType>(
  value: unknown,
  boundary: string,
  schema: Schema,
): Result<z.output<Schema>, LenaError> {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    return err(new LenaError("invalid_identifier", { boundary }));
  }

  return ok(parsed.data);
}

export function parseSyncChangeId(value: unknown): Result<SyncChangeId, LenaError> {
  return parseSyncId(value, "sync_change_id", syncChangeIdSchema);
}

export function parseSyncCheckpointId(value: unknown): Result<SyncCheckpointId, LenaError> {
  return parseSyncId(value, "sync_checkpoint_id", syncCheckpointIdSchema);
}

export function parseSyncConsentId(value: unknown): Result<SyncConsentId, LenaError> {
  return parseSyncId(value, "sync_consent_id", syncConsentIdSchema);
}

export function parseSyncConsentRequestId(value: unknown): Result<SyncConsentRequestId, LenaError> {
  return parseSyncId(value, "sync_consent_request_id", syncConsentRequestIdSchema);
}

export function parseSyncReplicaId(value: unknown): Result<SyncReplicaId, LenaError> {
  return parseSyncId(value, "sync_replica_id", syncReplicaIdSchema);
}

export function parseSyncTombstoneId(value: unknown): Result<SyncTombstoneId, LenaError> {
  return parseSyncId(value, "sync_tombstone_id", syncTombstoneIdSchema);
}

export function parseSyncProtocolVersion(value: unknown): Result<SyncProtocolVersion, LenaError> {
  const parsed = syncProtocolVersionSchema.safeParse(value);
  if (!parsed.success) {
    return err(new LenaError("invalid_input", { boundary: "sync_protocol_version" }));
  }

  return ok(parsed.data);
}
