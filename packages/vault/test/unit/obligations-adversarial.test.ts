import { describe, expect, test } from "bun:test";
import {
  ok,
  parseEffectId,
  parseGenerationId,
  parseIsoTimestamp,
  parseMutationId,
  parseVaultId,
  parseVaultInstanceId,
} from "@lena/core";
import * as vaultRoot from "../../src/index";
import {
  claimBackupObligation,
  createBackupObligation,
  parseBackupObligation,
  recoverStaleClaimedBackupObligation,
  releaseBackupObligation,
  type ClaimedBackupObligation,
} from "../../src/index";

const VAULT_ID_TEXT = "018f3f5a-1d2c-4abc-8def-0123456789ab";
const INSTANCE_ID_TEXT = "018f3f5a-1d2c-4abc-8def-1123456789ab";
const MUTATION_ID_TEXT = "018f3f5a-1d2c-4abc-8def-2123456789ab";
const EFFECT_ID_TEXT = "018f3f5a-1d2c-4abc-8def-3123456789ab";
const GENERATION_ID_TEXT = "018f3f5a-1d2c-4abc-8def-4123456789ab";
const CREATED_AT_TEXT = "2026-09-01T08:00:00.000Z";
const COMMITTED_AT_TEXT = "2026-09-01T08:02:00.000Z";
const CLAIMED_AT_TEXT = "2026-09-01T08:05:00.000Z";
const COMPLETED_AT_TEXT = "2026-09-01T08:10:00.000Z";

function obligationFixtures() {
  const vaultId = parseVaultId(VAULT_ID_TEXT);
  const vaultInstanceId = parseVaultInstanceId(INSTANCE_ID_TEXT);
  const mutationId = parseMutationId(MUTATION_ID_TEXT);
  const effectId = parseEffectId(EFFECT_ID_TEXT);
  const generationId = parseGenerationId(GENERATION_ID_TEXT);
  const createdAt = parseIsoTimestamp(CREATED_AT_TEXT);
  const committedAt = parseIsoTimestamp(COMMITTED_AT_TEXT);
  const claimedAt = parseIsoTimestamp(CLAIMED_AT_TEXT);
  const completedAt = parseIsoTimestamp(COMPLETED_AT_TEXT);
  if (
    vaultId.isErr() ||
    vaultInstanceId.isErr() ||
    mutationId.isErr() ||
    effectId.isErr() ||
    generationId.isErr() ||
    createdAt.isErr() ||
    committedAt.isErr() ||
    claimedAt.isErr() ||
    completedAt.isErr()
  ) {
    throw new Error("Invalid obligation test fixture");
  }
  return {
    claimedAt: claimedAt.value,
    committedAt: committedAt.value,
    commitSequence: 1,
    completedAt: completedAt.value,
    createdAt: createdAt.value,
    effectId: effectId.value,
    generationId: generationId.value,
    mutationId: mutationId.value,
    vaultId: vaultId.value,
    vaultInstanceId: vaultInstanceId.value,
  };
}

function claimedObligation(): ClaimedBackupObligation {
  const fixture = obligationFixtures();
  const pending = createBackupObligation(fixture);
  const claimed = claimBackupObligation(pending, fixture.effectId, fixture.claimedAt);
  if (claimed.isErr()) throw claimed.error;
  return claimed.value;
}

test("vault does not expose an in-memory backup-completion authority", () => {
  expect("createBackupCoverageTokenFromAdapter" in vaultRoot).toBe(false);
  expect("satisfyBackupObligation" in vaultRoot).toBe(false);
});

describe("persisted backup obligations", () => {
  test("round trips pending and claimed states with physical instance identity", () => {
    const fixture = obligationFixtures();
    const pending = createBackupObligation(fixture);
    expect(parseBackupObligation(JSON.parse(JSON.stringify(pending)))).toEqual(ok(pending));
    const claimed = claimBackupObligation(pending, fixture.effectId, fixture.claimedAt);
    if (claimed.isErr()) throw claimed.error;
    expect(parseBackupObligation(JSON.parse(JSON.stringify(claimed.value)))).toEqual(claimed);
  });

  test("rejects incoherent fields, unknown fields, and arbitrary failure codes", () => {
    const fixture = obligationFixtures();
    const pending = createBackupObligation(fixture);
    const claimed = claimBackupObligation(pending, fixture.effectId, fixture.claimedAt);
    if (claimed.isErr()) throw claimed.error;
    const released = releaseBackupObligation(
      claimed.value,
      fixture.effectId,
      "temporarily_unavailable",
    );
    if (released.isErr()) throw released.error;

    expect(parseBackupObligation({ ...pending, attemptCount: 1 }).isOk()).toBe(false);
    expect(parseBackupObligation({ ...pending, claimId: fixture.effectId }).isOk()).toBe(false);
    expect(
      parseBackupObligation({ ...claimed.value, generationId: fixture.generationId }).isOk(),
    ).toBe(false);
    expect(parseBackupObligation({ ...claimed.value, providerToken: "forbidden" }).isOk()).toBe(
      false,
    );
    expect(
      parseBackupObligation({
        ...released.value,
        lastFailureCode: "provider-response-body",
      }).isOk(),
    ).toBe(false);
  });
});

describe("stale claim recovery", () => {
  test("requeues only a claim at or before the supplied stale cutoff", () => {
    const fixture = obligationFixtures();
    const claimed = claimedObligation();
    expect(
      recoverStaleClaimedBackupObligation(
        claimed,
        fixture.createdAt,
        "temporarily_unavailable",
      ).isOk(),
    ).toBe(false);

    const recovered = recoverStaleClaimedBackupObligation(
      claimed,
      fixture.claimedAt,
      "temporarily_unavailable",
    );
    expect(recovered.isOk()).toBe(true);
    if (recovered.isErr()) throw recovered.error;
    expect(recovered.value).toMatchObject({
      attemptCount: 1,
      lastFailureCode: "temporarily_unavailable",
      state: "pending",
      vaultInstanceId: fixture.vaultInstanceId,
    });
  });
});

test("the vault package does not import the backup package", async () => {
  const sourceDirectory = `${import.meta.dir}/../../src`;
  const sources: string[] = [];
  for await (const path of new Bun.Glob("*.ts").scan(sourceDirectory)) {
    sources.push(await Bun.file(`${sourceDirectory}/${path}`).text());
  }
  expect(sources.join("\n")).not.toMatch(/from\s+["']@lena\/backup/);
});
