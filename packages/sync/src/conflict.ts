import { compareIsoTimestamps, err, LenaError, ok, type Result } from "@lena/core";

import type { SyncChangeId, SyncProtocolVersion } from "./identifiers";
import type { SyncChangeMetadata } from "./metadata";

export interface VersionedSyncRecord<Value> {
  readonly metadata: SyncChangeMetadata;
  readonly value: Value;
}

export interface SyncConflictIdentity {
  readonly firstChangeId: SyncChangeId;
  readonly protocolVersion: SyncProtocolVersion;
  readonly secondChangeId: SyncChangeId;
}

export type SyncConflictOutcome<Value> =
  | Readonly<{
      duplicate: VersionedSyncRecord<Value>;
      kind: "merged_identical";
      selected: VersionedSyncRecord<Value>;
    }>
  | Readonly<{
      conflict: SyncConflictIdentity;
      first: VersionedSyncRecord<Value>;
      kind: "preserve_both";
      reason: "concurrent_user_changes";
      second: VersionedSyncRecord<Value>;
    }>;

function compareVersions<Value>(
  left: VersionedSyncRecord<Value>,
  right: VersionedSyncRecord<Value>,
): number {
  const revisionOrder = left.metadata.revision - right.metadata.revision;
  if (revisionOrder !== 0) return revisionOrder;
  const timestampOrder = compareIsoTimestamps(left.metadata.changedAt, right.metadata.changedAt);
  if (timestampOrder !== 0) return timestampOrder;
  const replicaOrder = left.metadata.replicaId.localeCompare(right.metadata.replicaId);
  return replicaOrder === 0
    ? left.metadata.changeId.localeCompare(right.metadata.changeId)
    : replicaOrder;
}

export function resolveSyncConflict<Value>(
  left: VersionedSyncRecord<Value>,
  right: VersionedSyncRecord<Value>,
): Result<SyncConflictOutcome<Value>, LenaError> {
  if (
    left.metadata.entityType !== right.metadata.entityType ||
    left.metadata.entityId !== right.metadata.entityId
  ) {
    return err(
      new LenaError("invalid_input", {
        boundary: "sync_conflict",
      }),
    );
  }

  if (left.metadata.protocolVersion !== right.metadata.protocolVersion) {
    return err(
      new LenaError("incompatible_schema", {
        boundary: "sync_conflict",
      }),
    );
  }

  const [first, second] = compareVersions(left, right) <= 0 ? [left, right] : [right, left];

  if (first.metadata.contentDigest === second.metadata.contentDigest) {
    return ok(
      Object.freeze({
        duplicate: first,
        kind: "merged_identical" as const,
        selected: second,
      }),
    );
  }

  return ok(
    Object.freeze({
      conflict: Object.freeze({
        firstChangeId: first.metadata.changeId,
        protocolVersion: first.metadata.protocolVersion,
        secondChangeId: second.metadata.changeId,
      }),
      first,
      kind: "preserve_both" as const,
      reason: "concurrent_user_changes" as const,
      second,
    }),
  );
}
