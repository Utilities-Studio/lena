import { describe, expect, test } from "bun:test";
import {
  ok,
  parseEffectId,
  parseIsoTimestamp,
  parseMutationId,
  parseVaultId,
  parseVaultInstanceId,
} from "@lena/core";
import {
  classifyProcessedEffect,
  createProcessedEffectRecord,
  createVaultMutationReceipt,
  parseProcessedEffectRecord,
  parseVaultMutationReceipt,
  prepareAtomicVaultMutation,
} from "../../src/index";

const VAULT_ID_TEXT = "018f3f5a-1d2c-7abc-8def-0123456789ab";
const INSTANCE_ID_TEXT = "018f3f5a-1d2c-7abc-8def-1123456789ab";
const OTHER_INSTANCE_ID_TEXT = "018f3f5a-1d2c-7abc-8def-2123456789ab";
const MUTATION_ID_TEXT = "018f3f5a-1d2c-7abc-8def-3123456789ab";
const EFFECT_ID_TEXT = "018f3f5a-1d2c-7abc-8def-4123456789ab";
const CREATED_AT_TEXT = "2026-09-01T08:00:00.000Z";
const COMMITTED_AT_TEXT = "2026-09-01T08:00:01.000Z";

function mutationFixtures() {
  const vaultId = parseVaultId(VAULT_ID_TEXT);
  const vaultInstanceId = parseVaultInstanceId(INSTANCE_ID_TEXT);
  const otherVaultInstanceId = parseVaultInstanceId(OTHER_INSTANCE_ID_TEXT);
  const mutationId = parseMutationId(MUTATION_ID_TEXT);
  const effectId = parseEffectId(EFFECT_ID_TEXT);
  const createdAt = parseIsoTimestamp(CREATED_AT_TEXT);
  const committedAt = parseIsoTimestamp(COMMITTED_AT_TEXT);
  if (
    vaultId.isErr() ||
    vaultInstanceId.isErr() ||
    otherVaultInstanceId.isErr() ||
    mutationId.isErr() ||
    effectId.isErr() ||
    createdAt.isErr() ||
    committedAt.isErr()
  ) {
    throw new Error("Invalid mutation test fixture");
  }
  return {
    committedAt: committedAt.value,
    createdAt: createdAt.value,
    effectId: effectId.value,
    mutationId: mutationId.value,
    otherVaultInstanceId: otherVaultInstanceId.value,
    vaultId: vaultId.value,
    vaultInstanceId: vaultInstanceId.value,
  };
}

describe("atomic mutation and obligation contract", () => {
  test("binds a domain mutation, pending obligation, and receipt to one instance", () => {
    const fixture = mutationFixtures();
    const mutation = Object.freeze({ kind: "insert-entry", recordId: "local-record-1" });
    const plan = prepareAtomicVaultMutation({ ...fixture, mutation });

    expect(plan.mutation).toBe(mutation);
    expect(plan.backupObligation).toMatchObject({
      attemptCount: 0,
      mutationId: fixture.mutationId,
      state: "pending",
      vaultId: fixture.vaultId,
      vaultInstanceId: fixture.vaultInstanceId,
    });

    const receipt = createVaultMutationReceipt(plan, fixture.committedAt);
    expect(receipt.isOk()).toBe(true);
    if (receipt.isErr()) return;
    expect(parseVaultMutationReceipt(JSON.parse(JSON.stringify(receipt.value)))).toEqual(receipt);
  });

  test("rejects false obligation claims, unknown fields, and backwards commit time", () => {
    const fixture = mutationFixtures();
    const plan = prepareAtomicVaultMutation({ ...fixture, mutation: { kind: "update" } });
    expect(createVaultMutationReceipt(plan, fixture.createdAt).isOk()).toBe(true);

    expect(
      parseVaultMutationReceipt({
        backupObligationCreated: false,
        committedAt: fixture.committedAt,
        mutationId: fixture.mutationId,
        vaultId: fixture.vaultId,
        vaultInstanceId: fixture.vaultInstanceId,
      }).isOk(),
    ).toBe(false);
    expect(
      parseVaultMutationReceipt({
        backupObligationCreated: true,
        committedAt: fixture.committedAt,
        mutationId: fixture.mutationId,
        providerIdentity: "forbidden",
        vaultId: fixture.vaultId,
        vaultInstanceId: fixture.vaultInstanceId,
      }).isOk(),
    ).toBe(false);
  });
});

describe("processed effect idempotency", () => {
  test("distinguishes an unprocessed effect from an exact replay", () => {
    const fixture = mutationFixtures();
    const untrustedInput = {
      effectId: fixture.effectId,
      effectKind: "backup-obligation" as const,
      mutationId: fixture.mutationId,
      providerToken: "must-not-be-projected",
      processedAt: fixture.committedAt,
      vaultId: fixture.vaultId,
      vaultInstanceId: fixture.vaultInstanceId,
    };
    const record = createProcessedEffectRecord(untrustedInput);
    expect(record).not.toHaveProperty("providerToken");
    const expected = {
      effectId: fixture.effectId,
      effectKind: "backup-obligation" as const,
      mutationId: fixture.mutationId,
      vaultId: fixture.vaultId,
      vaultInstanceId: fixture.vaultInstanceId,
    };

    expect(classifyProcessedEffect(null, expected)).toEqual(ok({ status: "unprocessed" }));
    expect(classifyProcessedEffect(record, expected)).toEqual(
      ok({ record, status: "already-processed" }),
    );
    expect(parseProcessedEffectRecord(JSON.parse(JSON.stringify(record)))).toEqual(ok(record));
  });

  test("fails closed when an effect id is replayed for another instance", () => {
    const fixture = mutationFixtures();
    const record = createProcessedEffectRecord({
      effectId: fixture.effectId,
      effectKind: "backup-obligation",
      mutationId: fixture.mutationId,
      processedAt: fixture.committedAt,
      vaultId: fixture.vaultId,
      vaultInstanceId: fixture.vaultInstanceId,
    });

    expect(
      classifyProcessedEffect(record, {
        effectId: fixture.effectId,
        effectKind: "backup-obligation",
        mutationId: fixture.mutationId,
        vaultId: fixture.vaultId,
        vaultInstanceId: fixture.otherVaultInstanceId,
      }).isOk(),
    ).toBe(false);
    expect(parseProcessedEffectRecord({ ...record, effectKind: "provider-upload" }).isOk()).toBe(
      false,
    );
    expect(parseProcessedEffectRecord({ ...record, providerToken: "forbidden" }).isOk()).toBe(
      false,
    );
  });
});
