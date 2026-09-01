import { describe, expect, test } from "bun:test";
import {
  parseEffectId,
  parseGenerationId,
  parseIsoTimestamp,
  parseMutationId,
  parseSchemaVersion,
  parseVaultId,
  parseVaultInstanceId,
} from "@lena/core";
import {
  activateRegisteredVault,
  addVaultRegistryEntry,
  claimBackupObligation,
  createBackupObligation,
  createEmptyVaultRegistry,
  createVaultMetadata,
  getActiveVaultEntry,
  markStagingVaultReady,
  parseVaultMetadata,
  parseVaultMutationReceipt,
  planVaultMigrations,
  releaseBackupObligation,
  satisfyBackupObligation,
  updateRegisteredVaultState,
  type ClaimedBackupObligation,
} from "../../src/index";
import { createBackupCoverageTokenFromAdapter } from "../../src/backup-coverage";
import {
  createVaultActivationTokenFromAdapter,
  createVaultValidationTokenFromAdapter,
} from "../../src/registry-evidence";

const VAULT_UUID = "018f3f5a-1d2c-7abc-8def-0123456789ab";
const MUTATION_UUID = "018f3f5a-1d2c-7abc-8def-1123456789ab";
const EFFECT_UUID = "018f3f5a-1d2c-7abc-8def-2123456789ab";
const GENERATION_UUID = "018f3f5a-1d2c-7abc-8def-3123456789ab";
const VAULT_INSTANCE_UUID = "018f3f5a-1d2c-7abc-8def-4123456789ab";
const NOW_TEXT = "2026-09-01T08:15:30.000Z";

function fixtures() {
  const vaultId = parseVaultId(VAULT_UUID);
  const mutationId = parseMutationId(MUTATION_UUID);
  const effectId = parseEffectId(EFFECT_UUID);
  const generationId = parseGenerationId(GENERATION_UUID);
  const now = parseIsoTimestamp(NOW_TEXT);
  const schemaVersion = parseSchemaVersion(1);
  const vaultInstanceId = parseVaultInstanceId(VAULT_INSTANCE_UUID);
  if (
    vaultId.isErr() ||
    mutationId.isErr() ||
    effectId.isErr() ||
    generationId.isErr() ||
    now.isErr() ||
    schemaVersion.isErr() ||
    vaultInstanceId.isErr()
  ) {
    throw new Error("Invalid test fixture");
  }
  return {
    effectId: effectId.value,
    generationId: generationId.value,
    mutationId: mutationId.value,
    now: now.value,
    schemaVersion: schemaVersion.value,
    vaultId: vaultId.value,
    vaultInstanceId: vaultInstanceId.value,
  };
}

function coverageFor(claimed: ClaimedBackupObligation) {
  const { generationId, now } = fixtures();
  const mutationReceipt = parseVaultMutationReceipt({
    backupObligationCreated: true,
    committedAt: now,
    mutationId: claimed.mutationId,
    vaultId: claimed.vaultId,
    vaultInstanceId: claimed.vaultInstanceId,
  });
  if (mutationReceipt.isErr()) throw mutationReceipt.error;
  return createBackupCoverageTokenFromAdapter({
    generationId,
    mutationReceipt: mutationReceipt.value,
    obligation: claimed,
    verifiedAt: now,
  });
}

describe("vault metadata", () => {
  test("round trips validated metadata", () => {
    const { now, schemaVersion, vaultId, vaultInstanceId } = fixtures();
    const metadata = createVaultMetadata({
      createdAt: now,
      encryptionEnvelopeVersion: 1,
      schemaVersion,
      vaultId,
      vaultInstanceId,
    });
    expect(metadata.isOk()).toBe(true);
    if (metadata.isErr()) return;
    expect(parseVaultMetadata(metadata.value)).toEqual(metadata);
  });

  test("contains no account, payment, or provider identity", () => {
    const { now, schemaVersion, vaultId, vaultInstanceId } = fixtures();
    const metadata = createVaultMetadata({
      createdAt: now,
      encryptionEnvelopeVersion: 1,
      schemaVersion,
      vaultId,
      vaultInstanceId,
    });
    if (metadata.isErr()) return;
    const serialized = JSON.stringify(metadata.value);
    expect(serialized).not.toContain("email");
    expect(serialized).not.toContain("payment");
    expect(serialized).not.toContain("provider");
  });
});

describe("vault registry", () => {
  test("activates only a registered ready vault", () => {
    const { now, schemaVersion, vaultId, vaultInstanceId } = fixtures();
    const added = addVaultRegistryEntry(createEmptyVaultRegistry(), {
      createdAt: now,
      locator: "vaults/primary.sqlite",
      schemaVersion,
      state: "staging",
      vaultId,
      vaultInstanceId,
    });
    expect(added.isOk()).toBe(true);
    if (added.isErr()) return;
    const entry = added.value.entries[0];
    if (entry === undefined) return;
    const metadata = createVaultMetadata({
      createdAt: now,
      encryptionEnvelopeVersion: 1,
      schemaVersion,
      vaultId,
      vaultInstanceId,
    });
    if (metadata.isErr()) return;
    const validation = createVaultValidationTokenFromAdapter({
      entry,
      metadata: metadata.value,
      validatedAt: now,
    });
    if (validation.isErr()) return;
    const ready = markStagingVaultReady(added.value, validation.value);
    if (ready.isErr()) return;
    const readyEntry = ready.value.entries[0];
    if (readyEntry === undefined) return;
    const activation = createVaultActivationTokenFromAdapter({
      entry: readyEntry,
      metadata: metadata.value,
      validatedAt: now,
    });
    if (activation.isErr()) return;
    const active = activateRegisteredVault(ready.value, activation.value);
    expect(active.isOk()).toBe(true);
    if (active.isErr()) return;
    expect(getActiveVaultEntry(active.value)?.vaultId).toBe(vaultId);
    expect(updateRegisteredVaultState(active.value, vaultInstanceId, "retired").isOk()).toBe(false);
  });

  test("rejects duplicate registration", () => {
    const { now, schemaVersion, vaultId, vaultInstanceId } = fixtures();
    const entry = {
      createdAt: now,
      locator: "vaults/primary.sqlite",
      schemaVersion,
      state: "staging" as const,
      vaultId,
      vaultInstanceId,
    };
    const first = addVaultRegistryEntry(createEmptyVaultRegistry(), entry);
    if (first.isErr()) return;
    expect(addVaultRegistryEntry(first.value, entry).isOk()).toBe(false);
  });
});

describe("migration planning", () => {
  test("plans a complete consecutive chain", () => {
    const one = parseSchemaVersion(1);
    const two = parseSchemaVersion(2);
    const three = parseSchemaVersion(3);
    if (one.isErr() || two.isErr() || three.isErr()) return;
    const plan = planVaultMigrations(one.value, three.value, [
      { from: one.value, id: "001-one-to-two", to: two.value },
      { from: two.value, id: "002-two-to-three", to: three.value },
    ]);
    expect(plan.isOk()).toBe(true);
    if (plan.isErr()) return;
    expect(plan.value.map((item) => item.id)).toEqual(["001-one-to-two", "002-two-to-three"]);
  });

  test("rejects migration gaps and downgrades", () => {
    const one = parseSchemaVersion(1);
    const two = parseSchemaVersion(2);
    const three = parseSchemaVersion(3);
    if (one.isErr() || two.isErr() || three.isErr()) return;
    expect(planVaultMigrations(one.value, three.value, []).isOk()).toBe(false);
    expect(planVaultMigrations(three.value, one.value, []).isOk()).toBe(false);
    expect(
      planVaultMigrations(one.value, three.value, [
        { from: one.value, id: "bad-skip", to: three.value },
      ]).isOk(),
    ).toBe(false);
  });
});

describe("durable backup obligations", () => {
  test("claims, releases, retries, and satisfies by matching claim", () => {
    const { effectId, mutationId, now, vaultId, vaultInstanceId } = fixtures();
    const pending = createBackupObligation({
      createdAt: now,
      mutationId,
      vaultId,
      vaultInstanceId,
    });
    const claimed = claimBackupObligation(pending, effectId, now);
    expect(claimed.isOk()).toBe(true);
    if (claimed.isErr()) return;
    const released = releaseBackupObligation(claimed.value, effectId, "temporarily_unavailable");
    expect(released.isOk()).toBe(true);
    if (released.isErr()) return;
    expect(released.value.attemptCount).toBe(1);
    const retried = claimBackupObligation(released.value, effectId, now);
    if (retried.isErr()) return;
    const evidence = coverageFor(retried.value);
    if (evidence.isErr()) return;
    const satisfied = satisfyBackupObligation(retried.value, evidence.value);
    expect(satisfied.isOk()).toBe(true);
    if (satisfied.isErr()) return;
    expect(satisfied.value.state).toBe("satisfied");
    expect(satisfied.value.attemptCount).toBe(2);
  });

  test("does not satisfy a pending or mismatched claim", () => {
    const { effectId, mutationId, now, vaultId, vaultInstanceId } = fixtures();
    const pending = createBackupObligation({
      createdAt: now,
      mutationId,
      vaultId,
      vaultInstanceId,
    });
    const claimed = claimBackupObligation(pending, effectId, now);
    if (claimed.isErr()) return;
    const evidence = coverageFor(claimed.value);
    if (evidence.isErr()) return;
    expect(satisfyBackupObligation(pending, evidence.value).isOk()).toBe(false);
  });
});
