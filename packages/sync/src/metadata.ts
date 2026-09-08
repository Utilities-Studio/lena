import { err, isoTimestampSchema, LenaError, ok, type Result } from "@lena/core";

import {
  syncChangeIdSchema,
  syncCheckpointIdSchema,
  syncProtocolVersionSchema,
  syncReplicaIdSchema,
  syncTombstoneIdSchema,
} from "./identifiers";
import { z } from "zod";

const ENTITY_TOKEN_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/;
const DIGEST_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,255}$/;
const syncEntityTokenSchema = z.string().regex(ENTITY_TOKEN_PATTERN);
const syncContentDigestSchema = z.string().regex(DIGEST_PATTERN);
const syncRevisionSchema = z.int().positive();

export const syncChangeMetadataSchema = z
  .strictObject({
    baseRevision: z.int().nonnegative().nullable(),
    changeId: syncChangeIdSchema,
    changedAt: isoTimestampSchema,
    contentDigest: syncContentDigestSchema,
    entityId: syncEntityTokenSchema,
    entityType: syncEntityTokenSchema,
    kind: z.literal("sync_change"),
    protocolVersion: syncProtocolVersionSchema,
    replicaId: syncReplicaIdSchema,
    revision: syncRevisionSchema,
    schemaVersion: z.literal(1),
  })
  .superRefine((change, context) => {
    if (change.baseRevision !== null && change.baseRevision >= change.revision) {
      context.addIssue({
        code: "custom",
        message: "base_revision_not_before_revision",
        path: ["baseRevision"],
      });
    }
  })
  .readonly();

export const syncCheckpointSchema = z
  .strictObject({
    checkpointId: syncCheckpointIdSchema,
    createdAt: isoTimestampSchema,
    kind: z.literal("sync_checkpoint"),
    protocolVersion: syncProtocolVersionSchema,
    replicaId: syncReplicaIdSchema,
    schemaVersion: z.literal(1),
    sequence: z.int().nonnegative(),
  })
  .readonly();

export const syncTombstoneSchema = z
  .strictObject({
    deletedAt: isoTimestampSchema,
    deletedRevision: syncRevisionSchema,
    entityId: syncEntityTokenSchema,
    entityType: syncEntityTokenSchema,
    kind: z.literal("sync_tombstone"),
    protocolVersion: syncProtocolVersionSchema,
    replicaId: syncReplicaIdSchema,
    schemaVersion: z.literal(1),
    tombstoneId: syncTombstoneIdSchema,
  })
  .readonly();

export type SyncChangeMetadata = z.output<typeof syncChangeMetadataSchema>;
export type SyncCheckpoint = z.output<typeof syncCheckpointSchema>;
export type SyncTombstone = z.output<typeof syncTombstoneSchema>;

export function parseSyncChangeMetadata(input: unknown): Result<SyncChangeMetadata, LenaError> {
  const parsed = syncChangeMetadataSchema.safeParse(input);
  return parsed.success
    ? ok(parsed.data)
    : err(new LenaError("incompatible_schema", { boundary: "sync_change" }));
}

export function parseSyncCheckpoint(input: unknown): Result<SyncCheckpoint, LenaError> {
  const parsed = syncCheckpointSchema.safeParse(input);
  return parsed.success
    ? ok(parsed.data)
    : err(new LenaError("incompatible_schema", { boundary: "sync_checkpoint" }));
}

export function parseSyncTombstone(input: unknown): Result<SyncTombstone, LenaError> {
  const parsed = syncTombstoneSchema.safeParse(input);
  return parsed.success
    ? ok(parsed.data)
    : err(new LenaError("incompatible_schema", { boundary: "sync_tombstone" }));
}
