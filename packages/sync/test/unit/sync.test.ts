import { describe, expect, test } from "bun:test";

import { parseIsoTimestamp, type IsoTimestamp } from "@lena/core";

import {
  createExplicitHostedSyncConsentGrant,
  createHostedSyncConsentRequest,
  INITIAL_HOSTED_SYNC_CAPABILITY,
  INITIAL_SYNC_CONSENT_STATE,
  parseSyncChangeMetadata,
  parseSyncCheckpoint,
  parseSyncConsentId,
  parseSyncConsentRequestId,
  parseSyncTombstone,
  planSyncUpload,
  PRIVATE_VAULT_SYNC_CAPABILITY,
  reduceSyncConsent,
  resolveSyncConflict,
  type SyncChangeMetadata,
  type SyncConsentEvent,
  type VersionedSyncRecord,
} from "../../src/index";

const FIRST_TIME = "2026-09-01T08:00:00.000Z";
const SECOND_TIME = "2026-09-01T08:01:00.000Z";
const CHANGE_1 = "11111111-1111-4111-8111-111111111111";
const CHANGE_2 = "22222222-2222-4222-8222-222222222222";
const REPLICA_1 = "33333333-3333-4333-8333-333333333333";
const REPLICA_2 = "44444444-4444-4444-8444-444444444444";
const REQUEST_1 = "55555555-5555-4555-8555-555555555555";
const REQUEST_NEW = "66666666-6666-4666-8666-666666666666";
const REQUEST_OLD = "77777777-7777-4777-8777-777777777777";
const CONSENT_1 = "88888888-8888-4888-8888-888888888888";
const CHECKPOINT_1 = "99999999-9999-4999-8999-999999999999";
const TOMBSTONE_1 = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

function timestamp(value: string): IsoTimestamp {
  const parsed = parseIsoTimestamp(value);
  if (parsed.isErr()) throw parsed.error;
  return parsed.value;
}

function change(overrides: Readonly<Record<string, unknown>> = {}): SyncChangeMetadata {
  const parsed = parseSyncChangeMetadata({
    baseRevision: 0,
    changeId: CHANGE_1,
    changedAt: FIRST_TIME,
    contentDigest: "sha256:aaaaaaaa",
    entityId: "entry-1",
    entityType: "journal_entry",
    kind: "sync_change",
    protocolVersion: 1,
    replicaId: REPLICA_1,
    revision: 1,
    schemaVersion: 1,
    ...overrides,
  });
  if (parsed.isErr()) throw parsed.error;
  return parsed.value;
}

describe("disabled initial capability", () => {
  test("disables both Private Vault and unapproved Hosted Sync", () => {
    expect(PRIVATE_VAULT_SYNC_CAPABILITY).toEqual({
      canDownload: false,
      canUpload: false,
      mode: "private_vault",
      reason: "private_vault",
      status: "disabled",
    });
    expect(INITIAL_HOSTED_SYNC_CAPABILITY.status).toBe("disabled");
  });

  test("rejects upload planning even after consent", () => {
    const planned = planSyncUpload(INITIAL_HOSTED_SYNC_CAPABILITY, {
      changeIds: [change().changeId],
    });
    expect(planned.isOk()).toBe(false);
    if (planned.isErr()) expect(planned.error.code).toBe("unsupported");
  });
});

describe("explicit consent", () => {
  test("ignores unrelated payment, account, provider, and update events", () => {
    const sources = [
      "app_update",
      "backup_authorization",
      "backup_provider",
      "login",
      "purchase",
      "sign_out",
    ] as const;

    let state = INITIAL_SYNC_CONSENT_STATE;
    for (const source of sources) {
      const event: SyncConsentEvent = {
        occurredAt: timestamp(FIRST_TIME),
        source,
        type: "unrelated_authority_changed",
      };
      const reduced = reduceSyncConsent(state, event);
      if (reduced.isErr()) throw reduced.error;
      expect(reduced.value).toBe(state);
      state = reduced.value;
    }
    expect(state.status).toBe("not_requested");
  });

  test("rejects stale request replacement and preserves a request high-watermark", () => {
    const newer = createHostedSyncConsentRequest({
      disclosureVersion: "privacy-v2",
      requestId: REQUEST_NEW,
      requestedAt: SECOND_TIME,
    });
    const older = createHostedSyncConsentRequest({
      disclosureVersion: "privacy-v1",
      requestId: REQUEST_OLD,
      requestedAt: FIRST_TIME,
    });
    if (newer.isErr() || older.isErr()) throw new Error("Expected valid consent requests");
    const requested = reduceSyncConsent(INITIAL_SYNC_CONSENT_STATE, {
      request: newer.value,
      type: "request",
    });
    if (requested.isErr()) throw requested.error;

    expect(
      reduceSyncConsent(requested.value, {
        request: older.value,
        type: "request",
      }).isOk(),
    ).toBe(false);
    expect(
      reduceSyncConsent(requested.value, {
        request: { ...newer.value, disclosureVersion: "privacy-reused" },
        type: "request",
      }).isOk(),
    ).toBe(false);
  });

  test("requires a matching request and explicit confirmation", () => {
    const implicit = createExplicitHostedSyncConsentGrant({
      confirmation: "implicit",
      consentId: CONSENT_1,
      disclosureVersion: "privacy-v1",
      grantedAt: SECOND_TIME,
      requestId: REQUEST_1,
    });
    expect(implicit.isOk()).toBe(false);

    const request = createHostedSyncConsentRequest({
      disclosureVersion: "privacy-v1",
      requestId: REQUEST_1,
      requestedAt: FIRST_TIME,
    });
    if (request.isErr()) throw request.error;
    const requested = reduceSyncConsent(INITIAL_SYNC_CONSENT_STATE, {
      request: request.value,
      type: "request",
    });
    if (requested.isErr()) throw requested.error;

    const grant = createExplicitHostedSyncConsentGrant({
      confirmation: "explicit",
      consentId: CONSENT_1,
      disclosureVersion: "privacy-v1",
      grantedAt: SECOND_TIME,
      requestId: REQUEST_1,
    });
    if (grant.isErr()) throw grant.error;
    const granted = reduceSyncConsent(requested.value, grant.value);
    expect(granted.isOk() && granted.value).toMatchObject({
      mode: "hosted_sync",
      status: "granted",
    });
    expect(INITIAL_HOSTED_SYNC_CAPABILITY.status).toBe("disabled");
  });

  test("withdrawal returns to Private Vault without any data operation", () => {
    const request = createHostedSyncConsentRequest({
      disclosureVersion: "privacy-v1",
      requestId: REQUEST_1,
      requestedAt: FIRST_TIME,
    });
    const grant = createExplicitHostedSyncConsentGrant({
      confirmation: "explicit",
      consentId: CONSENT_1,
      disclosureVersion: "privacy-v1",
      grantedAt: SECOND_TIME,
      requestId: REQUEST_1,
    });
    if (request.isErr() || grant.isErr()) throw new Error("Expected valid consent data");
    const requested = reduceSyncConsent(INITIAL_SYNC_CONSENT_STATE, {
      request: request.value,
      type: "request",
    });
    if (requested.isErr()) throw requested.error;
    const granted = reduceSyncConsent(requested.value, grant.value);
    if (granted.isErr()) throw granted.error;
    const consentId = parseSyncConsentId(CONSENT_1);
    if (consentId.isErr()) throw consentId.error;
    const withdrawn = reduceSyncConsent(granted.value, {
      consentId: consentId.value,
      type: "withdraw",
      withdrawnAt: timestamp("2026-09-01T08:02:00.000Z"),
    });
    expect(withdrawn.isOk() && withdrawn.value).toMatchObject({
      mode: "private_vault",
      status: "withdrawn",
    });
  });

  test("cannot grant consent without an active matching request", () => {
    const grant = createExplicitHostedSyncConsentGrant({
      confirmation: "explicit",
      consentId: CONSENT_1,
      disclosureVersion: "privacy-v1",
      grantedAt: SECOND_TIME,
      requestId: REQUEST_1,
    });
    if (grant.isErr()) throw grant.error;
    expect(reduceSyncConsent(INITIAL_SYNC_CONSENT_STATE, grant.value).isOk()).toBe(false);
  });
});

describe("versioned sync metadata", () => {
  test("validates exact checkpoint and tombstone shapes", () => {
    const checkpoint = parseSyncCheckpoint({
      checkpointId: CHECKPOINT_1,
      createdAt: FIRST_TIME,
      kind: "sync_checkpoint",
      protocolVersion: 1,
      replicaId: REPLICA_1,
      schemaVersion: 1,
      sequence: 0,
    });
    expect(checkpoint.isOk()).toBe(true);
    if (checkpoint.isErr()) throw checkpoint.error;
    expect(parseSyncCheckpoint({ ...checkpoint.value, unexpected: true }).isOk()).toBe(false);

    expect(
      parseSyncTombstone({
        deletedAt: FIRST_TIME,
        deletedRevision: 2,
        entityId: "entry-1",
        entityType: "journal_entry",
        kind: "sync_tombstone",
        protocolVersion: 1,
        replicaId: REPLICA_1,
        schemaVersion: 1,
        tombstoneId: TOMBSTONE_1,
      }).isOk(),
    ).toBe(true);
  });

  test("preserves both conflicting user-authored values deterministically", () => {
    const first: VersionedSyncRecord<string> = {
      metadata: change(),
      value: "first",
    };
    const second: VersionedSyncRecord<string> = {
      metadata: change({
        baseRevision: 0,
        changeId: CHANGE_2,
        changedAt: SECOND_TIME,
        contentDigest: "sha256:bbbbbbbb",
        replicaId: REPLICA_2,
      }),
      value: "second",
    };

    const forward = resolveSyncConflict(first, second);
    const reverse = resolveSyncConflict(second, first);
    expect(forward).toEqual(reverse);
    expect(forward.isOk() && forward.value).toMatchObject({
      first: { value: "first" },
      kind: "preserve_both",
      reason: "concurrent_user_changes",
      second: { value: "second" },
    });
  });

  test("merges identical content using deterministic metadata order", () => {
    const first: VersionedSyncRecord<string> = {
      metadata: change(),
      value: "same",
    };
    const second: VersionedSyncRecord<string> = {
      metadata: change({
        changeId: CHANGE_2,
        changedAt: SECOND_TIME,
        replicaId: REPLICA_2,
      }),
      value: "same",
    };
    const outcome = resolveSyncConflict(first, second);
    expect(outcome.isOk() && outcome.value).toMatchObject({
      kind: "merged_identical",
      selected: { metadata: { changeId: CHANGE_2 } },
    });
  });
});

test("Private Vault package sources do not import the sync package", async () => {
  const packagesDirectory = `${import.meta.dir}/../../..`;
  const violations: string[] = [];
  let scannedFileCount = 0;
  for await (const path of new Bun.Glob("*/src/**/*.ts").scan(packagesDirectory)) {
    if (path.startsWith("sync/")) continue;
    scannedFileCount += 1;
    const source = await Bun.file(`${packagesDirectory}/${path}`).text();
    if (source.includes("@lena/sync")) violations.push(path);
  }
  expect(scannedFileCount).toBeGreaterThan(0);
  expect(violations).toEqual([]);
});

test("consent request identifiers remain validated independently", () => {
  expect(parseSyncConsentRequestId(REQUEST_1).isOk()).toBe(true);
  expect(parseSyncConsentId(REQUEST_1).isOk()).toBe(true);
});
