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
  parseVaultMutationReceipt,
  recoverStaleClaimedBackupObligation,
  releaseBackupObligation,
  satisfyBackupObligation,
  type BackupCoverageToken,
  type ClaimedBackupObligation,
  type VaultMutationReceipt,
} from "../../src/index";
import {
  createBackupCoverageTokenFromAdapter,
  isBackupCoverageToken,
} from "../../src/backup-coverage";

const VAULT_ID_TEXT = "018f3f5a-1d2c-7abc-8def-0123456789ab";
const INSTANCE_ID_TEXT = "018f3f5a-1d2c-7abc-8def-1123456789ab";
const MUTATION_ID_TEXT = "018f3f5a-1d2c-7abc-8def-2123456789ab";
const EFFECT_ID_TEXT = "018f3f5a-1d2c-7abc-8def-3123456789ab";
const GENERATION_ID_TEXT = "018f3f5a-1d2c-7abc-8def-4123456789ab";
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
    completedAt: completedAt.value,
    createdAt: createdAt.value,
    effectId: effectId.value,
    generationId: generationId.value,
    mutationId: mutationId.value,
    vaultId: vaultId.value,
    vaultInstanceId: vaultInstanceId.value,
  };
}

function receiptFor(
  obligation: ClaimedBackupObligation,
  committedAt = obligationFixtures().committedAt,
): VaultMutationReceipt {
  const receipt = parseVaultMutationReceipt({
    backupObligationCreated: true,
    committedAt,
    mutationId: obligation.mutationId,
    vaultId: obligation.vaultId,
    vaultInstanceId: obligation.vaultInstanceId,
  });
  if (receipt.isErr()) throw receipt.error;
  return receipt.value;
}

function coverageFor(
  obligation: ClaimedBackupObligation,
  overrides: Readonly<{
    mutationReceipt?: VaultMutationReceipt;
    verifiedAt?: ReturnType<typeof obligationFixtures>["completedAt"];
  }> = {},
) {
  const fixture = obligationFixtures();
  return createBackupCoverageTokenFromAdapter({
    generationId: fixture.generationId,
    mutationReceipt: overrides.mutationReceipt ?? receiptFor(obligation),
    obligation,
    verifiedAt: overrides.verifiedAt ?? fixture.completedAt,
  });
}

function claimedObligation(): ClaimedBackupObligation {
  const fixture = obligationFixtures();
  const pending = createBackupObligation(fixture);
  const claimed = claimBackupObligation(pending, fixture.effectId, fixture.claimedAt);
  if (claimed.isErr()) throw claimed.error;
  return claimed.value;
}

describe("adapter-bound backup coverage", () => {
  test("does not export any public coverage-token minter", () => {
    expect("createBackupObligationSatisfactionEvidence" in vaultRoot).toBe(false);
    expect("createBackupCoverageTokenFromAdapter" in vaultRoot).toBe(false);
  });

  test("cannot be structurally forged, spread, or revived from JSON", () => {
    const claimed = claimedObligation();
    const coverage = coverageFor(claimed);
    if (coverage.isErr()) throw coverage.error;
    expect(isBackupCoverageToken(coverage.value)).toBe(true);

    const spread = { ...coverage.value } as BackupCoverageToken;
    const serialized = JSON.parse(JSON.stringify(coverage.value)) as BackupCoverageToken;
    expect(isBackupCoverageToken(spread)).toBe(false);
    expect(isBackupCoverageToken(serialized)).toBe(false);
    expect(satisfyBackupObligation(claimed, spread).isOk()).toBe(false);
    expect(satisfyBackupObligation(claimed, serialized).isOk()).toBe(false);
  });

  test("binds and persists exact vault, mutation, attempt, generation, and commit coverage", () => {
    const fixture = obligationFixtures();
    const claimed = claimedObligation();
    const coverage = coverageFor(claimed);
    if (coverage.isErr()) throw coverage.error;
    expect(coverage.value).toMatchObject({
      attemptCount: claimed.attemptCount,
      claimId: claimed.claimId,
      coveredCommitAt: fixture.committedAt,
      generationId: fixture.generationId,
      mutationId: fixture.mutationId,
      verifiedAt: fixture.completedAt,
      vaultId: fixture.vaultId,
      vaultInstanceId: fixture.vaultInstanceId,
    });

    const satisfied = satisfyBackupObligation(claimed, coverage.value);
    if (satisfied.isErr()) throw satisfied.error;
    expect(satisfied.value.coveredCommitAt).toBe(fixture.committedAt);
    expect(parseBackupObligation(JSON.parse(JSON.stringify(satisfied.value)))).toEqual(satisfied);
  });

  test("rejects a mismatched receipt and invalid commit or verification chronology", () => {
    const fixture = obligationFixtures();
    const claimed = claimedObligation();
    const otherMutation = parseMutationId("018f3f5a-1d2c-7abc-8def-5123456789ab");
    const beforeCommit = parseIsoTimestamp("2026-09-01T07:59:00.000Z");
    const afterClaim = parseIsoTimestamp("2026-09-01T08:06:00.000Z");
    if (otherMutation.isErr() || beforeCommit.isErr() || afterClaim.isErr())
      throw new Error("Bad fixture");

    const wrongReceipt = parseVaultMutationReceipt({
      backupObligationCreated: true,
      committedAt: fixture.committedAt,
      mutationId: otherMutation.value,
      vaultId: fixture.vaultId,
      vaultInstanceId: fixture.vaultInstanceId,
    });
    if (wrongReceipt.isErr()) throw wrongReceipt.error;
    expect(coverageFor(claimed, { mutationReceipt: wrongReceipt.value }).isOk()).toBe(false);
    expect(
      coverageFor(claimed, { mutationReceipt: receiptFor(claimed, beforeCommit.value) }).isOk(),
    ).toBe(false);
    expect(
      coverageFor(claimed, { mutationReceipt: receiptFor(claimed, afterClaim.value) }).isOk(),
    ).toBe(false);
    expect(coverageFor(claimed, { verifiedAt: fixture.createdAt }).isOk()).toBe(false);
  });

  test("rejects coverage issued for another mutation and a stale retry attempt", () => {
    const fixture = obligationFixtures();
    const claimed = claimedObligation();
    const otherMutation = parseMutationId("018f3f5a-1d2c-7abc-8def-5123456789ab");
    if (otherMutation.isErr()) throw otherMutation.error;
    const otherPending = createBackupObligation({
      ...fixture,
      mutationId: otherMutation.value,
    });
    const otherClaim = claimBackupObligation(otherPending, fixture.effectId, fixture.claimedAt);
    if (otherClaim.isErr()) throw otherClaim.error;
    const otherCoverage = coverageFor(otherClaim.value);
    if (otherCoverage.isErr()) throw otherCoverage.error;
    expect(satisfyBackupObligation(claimed, otherCoverage.value).isOk()).toBe(false);

    const staleCoverage = coverageFor(claimed);
    if (staleCoverage.isErr()) throw staleCoverage.error;
    const released = releaseBackupObligation(claimed, fixture.effectId, "temporarily_unavailable");
    if (released.isErr()) throw released.error;
    const retried = claimBackupObligation(released.value, fixture.effectId, fixture.claimedAt);
    if (retried.isErr()) throw retried.error;
    expect(satisfyBackupObligation(retried.value, staleCoverage.value).isOk()).toBe(false);
  });
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
