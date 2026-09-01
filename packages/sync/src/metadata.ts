import { err, LenaError, ok, parseIsoTimestamp, type IsoTimestamp, type Result } from "@lena/core";

import {
  parseSyncChangeId,
  parseSyncCheckpointId,
  parseSyncProtocolVersion,
  parseSyncReplicaId,
  parseSyncTombstoneId,
  type SyncChangeId,
  type SyncCheckpointId,
  type SyncProtocolVersion,
  type SyncReplicaId,
  type SyncTombstoneId,
} from "./identifiers";
import { z } from "zod";

export interface SyncChangeMetadata {
  readonly baseRevision: number | null;
  readonly changeId: SyncChangeId;
  readonly changedAt: IsoTimestamp;
  readonly contentDigest: string;
  readonly entityId: string;
  readonly entityType: string;
  readonly kind: "sync_change";
  readonly protocolVersion: SyncProtocolVersion;
  readonly replicaId: SyncReplicaId;
  readonly revision: number;
  readonly schemaVersion: 1;
}

export interface SyncCheckpoint {
  readonly checkpointId: SyncCheckpointId;
  readonly createdAt: IsoTimestamp;
  readonly kind: "sync_checkpoint";
  readonly protocolVersion: SyncProtocolVersion;
  readonly replicaId: SyncReplicaId;
  readonly schemaVersion: 1;
  readonly sequence: number;
}

export interface SyncTombstone {
  readonly deletedAt: IsoTimestamp;
  readonly deletedRevision: number;
  readonly entityId: string;
  readonly entityType: string;
  readonly kind: "sync_tombstone";
  readonly protocolVersion: SyncProtocolVersion;
  readonly replicaId: SyncReplicaId;
  readonly schemaVersion: 1;
  readonly tombstoneId: SyncTombstoneId;
}

const ENTITY_TOKEN_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/;
const DIGEST_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,255}$/;

const syncChangeShapeSchema = z.strictObject({
  baseRevision: z.unknown(),
  changeId: z.unknown(),
  changedAt: z.unknown(),
  contentDigest: z.unknown(),
  entityId: z.unknown(),
  entityType: z.unknown(),
  kind: z.literal("sync_change"),
  protocolVersion: z.unknown(),
  replicaId: z.unknown(),
  revision: z.unknown(),
  schemaVersion: z.literal(1),
});

const syncCheckpointShapeSchema = z.strictObject({
  checkpointId: z.unknown(),
  createdAt: z.unknown(),
  kind: z.literal("sync_checkpoint"),
  protocolVersion: z.unknown(),
  replicaId: z.unknown(),
  schemaVersion: z.literal(1),
  sequence: z.unknown(),
});

const syncTombstoneShapeSchema = z.strictObject({
  deletedAt: z.unknown(),
  deletedRevision: z.unknown(),
  entityId: z.unknown(),
  entityType: z.unknown(),
  kind: z.literal("sync_tombstone"),
  protocolVersion: z.unknown(),
  replicaId: z.unknown(),
  schemaVersion: z.literal(1),
  tombstoneId: z.unknown(),
});

function parseEntityToken(value: unknown, boundary: string): Result<string, LenaError> {
  if (typeof value !== "string" || !ENTITY_TOKEN_PATTERN.test(value)) {
    return err(
      new LenaError("invalid_input", "Sync entity token is invalid", {
        boundary,
      }),
    );
  }

  return ok(value);
}

function parseRevision(value: unknown, boundary: string): Result<number, LenaError> {
  if (!Number.isSafeInteger(value) || (value as number) < 1) {
    return err(new LenaError("invalid_input", "Sync revision is invalid", { boundary }));
  }

  return ok(value as number);
}

export function parseSyncChangeMetadata(input: unknown): Result<SyncChangeMetadata, LenaError> {
  const record = syncChangeShapeSchema.safeParse(input);
  if (!record.success) {
    return err(
      new LenaError("incompatible_schema", "Sync change shape is invalid", {
        boundary: "sync_change",
      }),
    );
  }

  const changeId = parseSyncChangeId(record.data.changeId);
  const replicaId = parseSyncReplicaId(record.data.replicaId);
  const protocolVersion = parseSyncProtocolVersion(record.data.protocolVersion);
  const entityType = parseEntityToken(record.data.entityType, "sync_change");
  const entityId = parseEntityToken(record.data.entityId, "sync_change");
  const revision = parseRevision(record.data.revision, "sync_change");
  const changedAt = parseIsoTimestamp(record.data.changedAt);
  const contentDigest = record.data.contentDigest;
  if (
    changeId.isErr() ||
    replicaId.isErr() ||
    protocolVersion.isErr() ||
    entityType.isErr() ||
    entityId.isErr() ||
    revision.isErr() ||
    changedAt.isErr() ||
    typeof contentDigest !== "string" ||
    !DIGEST_PATTERN.test(contentDigest)
  ) {
    if (changeId.isErr()) return err(changeId.error);
    if (replicaId.isErr()) return err(replicaId.error);
    if (protocolVersion.isErr()) return err(protocolVersion.error);
    if (entityType.isErr()) return err(entityType.error);
    if (entityId.isErr()) return err(entityId.error);
    if (revision.isErr()) return err(revision.error);
    if (changedAt.isErr()) return err(changedAt.error);
    return err(
      new LenaError("invalid_input", "Sync content digest is invalid", {
        boundary: "sync_change",
      }),
    );
  }

  const baseRevision = record.data.baseRevision;
  if (
    baseRevision !== null &&
    (!Number.isSafeInteger(baseRevision) ||
      (baseRevision as number) < 0 ||
      (baseRevision as number) >= revision.value)
  ) {
    return err(
      new LenaError("invalid_input", "Sync base revision is invalid", {
        boundary: "sync_change",
      }),
    );
  }

  return ok(
    Object.freeze({
      baseRevision: baseRevision as number | null,
      changeId: changeId.value,
      changedAt: changedAt.value,
      contentDigest,
      entityId: entityId.value,
      entityType: entityType.value,
      kind: "sync_change" as const,
      protocolVersion: protocolVersion.value,
      replicaId: replicaId.value,
      revision: revision.value,
      schemaVersion: 1 as const,
    }),
  );
}

export function parseSyncCheckpoint(input: unknown): Result<SyncCheckpoint, LenaError> {
  const record = syncCheckpointShapeSchema.safeParse(input);
  if (!record.success) {
    return err(
      new LenaError("incompatible_schema", "Sync checkpoint shape is invalid", {
        boundary: "sync_checkpoint",
      }),
    );
  }

  const checkpointId = parseSyncCheckpointId(record.data.checkpointId);
  const replicaId = parseSyncReplicaId(record.data.replicaId);
  const protocolVersion = parseSyncProtocolVersion(record.data.protocolVersion);
  const createdAt = parseIsoTimestamp(record.data.createdAt);
  const sequence = record.data.sequence;
  if (
    checkpointId.isErr() ||
    replicaId.isErr() ||
    protocolVersion.isErr() ||
    createdAt.isErr() ||
    !Number.isSafeInteger(sequence) ||
    (sequence as number) < 0
  ) {
    if (checkpointId.isErr()) return err(checkpointId.error);
    if (replicaId.isErr()) return err(replicaId.error);
    if (protocolVersion.isErr()) return err(protocolVersion.error);
    if (createdAt.isErr()) return err(createdAt.error);
    return err(
      new LenaError("invalid_input", "Sync checkpoint sequence is invalid", {
        boundary: "sync_checkpoint",
      }),
    );
  }

  return ok(
    Object.freeze({
      checkpointId: checkpointId.value,
      createdAt: createdAt.value,
      kind: "sync_checkpoint" as const,
      protocolVersion: protocolVersion.value,
      replicaId: replicaId.value,
      schemaVersion: 1 as const,
      sequence: sequence as number,
    }),
  );
}

export function parseSyncTombstone(input: unknown): Result<SyncTombstone, LenaError> {
  const record = syncTombstoneShapeSchema.safeParse(input);
  if (!record.success) {
    return err(
      new LenaError("incompatible_schema", "Sync tombstone shape is invalid", {
        boundary: "sync_tombstone",
      }),
    );
  }

  const tombstoneId = parseSyncTombstoneId(record.data.tombstoneId);
  const replicaId = parseSyncReplicaId(record.data.replicaId);
  const protocolVersion = parseSyncProtocolVersion(record.data.protocolVersion);
  const entityType = parseEntityToken(record.data.entityType, "sync_tombstone");
  const entityId = parseEntityToken(record.data.entityId, "sync_tombstone");
  const deletedRevision = parseRevision(record.data.deletedRevision, "sync_tombstone");
  const deletedAt = parseIsoTimestamp(record.data.deletedAt);
  if (tombstoneId.isErr()) return err(tombstoneId.error);
  if (replicaId.isErr()) return err(replicaId.error);
  if (protocolVersion.isErr()) return err(protocolVersion.error);
  if (entityType.isErr()) return err(entityType.error);
  if (entityId.isErr()) return err(entityId.error);
  if (deletedRevision.isErr()) return err(deletedRevision.error);
  if (deletedAt.isErr()) return err(deletedAt.error);

  return ok(
    Object.freeze({
      deletedAt: deletedAt.value,
      deletedRevision: deletedRevision.value,
      entityId: entityId.value,
      entityType: entityType.value,
      kind: "sync_tombstone" as const,
      protocolVersion: protocolVersion.value,
      replicaId: replicaId.value,
      schemaVersion: 1 as const,
      tombstoneId: tombstoneId.value,
    }),
  );
}
