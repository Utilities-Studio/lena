import { describe, expect, test } from "bun:test";
import { SQLiteSyncDialect, getTableConfig } from "drizzle-orm/sqlite-core";
import { sortBy } from "es-toolkit/compat";
import fc from "fast-check";
import {
  backupOutboxRowSchema,
  lenaBackupOutboxTable,
  lenaProcessedEffectsTable,
  lenaVaultDrizzleSchema,
  lenaVaultMetadataTable,
  lenaVerifiedBackupGenerationsTable,
  parseBackupOutboxRow,
  parseProcessedEffectRow,
  parseVaultMetadataRow,
  parseVerifiedBackupGenerationRow,
  processedEffectRowSchema,
  vaultMetadataRowSchema,
} from "../../src/index";

const IDS = Object.freeze({
  claim: "00000000-0000-4000-8000-000000000004",
  effect: "00000000-0000-4000-8000-000000000005",
  generation: "00000000-0000-4000-8000-000000000003",
  mutation: "00000000-0000-4000-8000-000000000002",
  vault: "00000000-0000-4000-8000-000000000000",
  vaultInstance: "00000000-0000-4000-8000-000000000001",
});
const CREATED_AT = "2026-01-01T00:00:00.000Z";
const COVERED_AT = "2026-01-01T00:00:01.000Z";
const CLAIMED_AT = "2026-01-01T00:00:02.000Z";
const COMPLETED_AT = "2026-01-01T00:00:03.000Z";

function renderChecks(table: Parameters<typeof getTableConfig>[0]): string {
  const dialect = new SQLiteSyncDialect();
  return getTableConfig(table)
    .checks.map((constraint) => dialect.sqlToQuery(constraint.value).sql)
    .join("\n");
}

describe("canonical Lena Drizzle schema", () => {
  test("owns one mapping with exact SQL table and column names", () => {
    expect(sortBy(Object.keys(lenaVaultDrizzleSchema), [(key) => key])).toEqual([
      "backupOutbox",
      "processedEffects",
      "vaultMetadata",
      "verifiedBackupGenerations",
    ]);

    expect(getTableConfig(lenaVaultMetadataTable).name).toBe("lena_vault_metadata");
    expect(getTableConfig(lenaVaultMetadataTable).columns.map((column) => column.name)).toEqual([
      "singleton_id",
      "vault_id",
      "vault_instance_id",
      "schema_version",
      "format_version",
      "encryption_envelope_version",
      "created_at",
    ]);
    expect(getTableConfig(lenaBackupOutboxTable).columns.map((column) => column.name)).toEqual([
      "commit_sequence",
      "mutation_id",
      "vault_id",
      "vault_instance_id",
      "state",
      "attempt_count",
      "claim_id",
      "generation_id",
      "created_at",
      "committed_at",
      "claimed_at",
      "covered_commit_at",
      "completed_at",
      "last_failure_code",
    ]);
    expect(getTableConfig(lenaProcessedEffectsTable).columns.map((column) => column.name)).toEqual([
      "effect_id",
      "effect_kind",
      "mutation_id",
      "vault_id",
      "vault_instance_id",
      "processed_at",
    ]);
    expect(
      getTableConfig(lenaVerifiedBackupGenerationsTable).columns.map((column) => column.name),
    ).toEqual([
      "generation_id",
      "vault_id",
      "vault_instance_id",
      "commit_sequence",
      "mutation_id",
      "committed_at",
      "verified_at",
    ]);
  });

  test("maps primary keys, defaults, enums, uniques, checks, and composite foreign keys", () => {
    const metadata = getTableConfig(lenaVaultMetadataTable);
    const outbox = getTableConfig(lenaBackupOutboxTable);
    const effects = getTableConfig(lenaProcessedEffectsTable);
    const verifiedGenerations = getTableConfig(lenaVerifiedBackupGenerationsTable);

    expect(lenaVaultMetadataTable.singletonId.primary).toBe(true);
    expect(lenaVaultMetadataTable.vaultInstanceId.isUnique).toBe(true);
    expect(metadata.uniqueConstraints[0]?.columns.map((column) => column.name)).toEqual([
      "vault_id",
      "vault_instance_id",
    ]);
    expect(lenaBackupOutboxTable.mutationId.primary).toBe(true);
    expect(lenaBackupOutboxTable.commitSequence.isUnique).toBe(true);
    expect(lenaBackupOutboxTable.attemptCount.default).toBe(0);
    expect(lenaBackupOutboxTable.state.enumValues).toEqual(["pending", "claimed", "satisfied"]);
    expect(lenaProcessedEffectsTable.effectId.primary).toBe(true);
    expect(lenaProcessedEffectsTable.effectKind.enumValues).toEqual(["backup-obligation"]);
    expect(lenaVerifiedBackupGenerationsTable.generationId.primary).toBe(true);
    expect(effects.uniqueConstraints[0]?.columns.map((column) => column.name)).toEqual([
      "vault_instance_id",
      "effect_kind",
      "mutation_id",
    ]);

    for (const config of [outbox, effects]) {
      const reference = config.foreignKeys[0]?.reference();
      expect(reference?.columns.map((column) => column.name)).toEqual([
        "vault_id",
        "vault_instance_id",
      ]);
      expect(reference?.foreignColumns.map((column) => column.name)).toEqual([
        "vault_id",
        "vault_instance_id",
      ]);
      expect(reference?.foreignTable).toBe(lenaVaultMetadataTable);
    }
    expect(verifiedGenerations.foreignKeys).toHaveLength(2);
    expect(
      verifiedGenerations.foreignKeys[1]?.reference().foreignColumns.map((column) => column.name),
    ).toEqual(["commit_sequence", "mutation_id", "vault_id", "vault_instance_id"]);

    const metadataChecks = renderChecks(lenaVaultMetadataTable);
    const outboxChecks = renderChecks(lenaBackupOutboxTable);
    const effectChecks = renderChecks(lenaProcessedEffectsTable);
    const verifiedGenerationChecks = renderChecks(lenaVerifiedBackupGenerationsTable);
    expect(metadataChecks).toContain("singleton_id");
    expect(metadataChecks).toContain("schema_version");
    expect(outboxChecks).toContain("state");
    expect(outboxChecks).toContain("covered_commit_at");
    expect(outboxChecks).toContain("completed_at");
    expect(outboxChecks).toContain("last_failure_code");
    expect(outboxChecks).toContain("commit_sequence");
    expect(outboxChecks).toContain("committed_at");
    expect(effectChecks).toContain("backup-obligation");
    expect(verifiedGenerationChecks).toContain("verified_at");
  });
});

describe("Lena-owned database row schemas", () => {
  test("validate metadata and processed-effect rows without exposing raw Zod errors", () => {
    const metadata = {
      createdAt: CREATED_AT,
      encryptionEnvelopeVersion: 1,
      formatVersion: 1,
      schemaVersion: 2,
      singletonId: 1,
      vaultId: IDS.vault,
      vaultInstanceId: IDS.vaultInstance,
    };
    const effect = {
      effectId: IDS.effect,
      effectKind: "backup-obligation",
      mutationId: IDS.mutation,
      processedAt: COMPLETED_AT,
      vaultId: IDS.vault,
      vaultInstanceId: IDS.vaultInstance,
    };

    expect(vaultMetadataRowSchema.safeParse(metadata).success).toBe(true);
    expect(parseVaultMetadataRow(metadata).isOk()).toBe(true);
    expect(parseVaultMetadataRow({ ...metadata, singletonId: 2 }).isErr()).toBe(true);
    expect(parseVaultMetadataRow({ ...metadata, providerToken: "forbidden" }).isErr()).toBe(true);
    expect(processedEffectRowSchema.safeParse(effect).success).toBe(true);
    expect(parseProcessedEffectRow(effect).isOk()).toBe(true);
    expect(parseProcessedEffectRow({ ...effect, effectKind: "provider-upload" }).isErr()).toBe(
      true,
    );
  });

  test("enforces every outbox state and its chronology", () => {
    const common = {
      committedAt: CREATED_AT,
      commitSequence: 1,
      createdAt: CREATED_AT,
      mutationId: IDS.mutation,
      vaultId: IDS.vault,
      vaultInstanceId: IDS.vaultInstance,
    };
    const pending = {
      ...common,
      attemptCount: 0,
      claimedAt: null,
      claimId: null,
      completedAt: null,
      coveredCommitAt: null,
      generationId: null,
      lastFailureCode: null,
      state: "pending",
    };
    const claimed = {
      ...pending,
      attemptCount: 1,
      claimedAt: CLAIMED_AT,
      claimId: IDS.claim,
      state: "claimed",
    };
    const satisfied = {
      ...claimed,
      completedAt: COMPLETED_AT,
      coveredCommitAt: COVERED_AT,
      generationId: IDS.generation,
      state: "satisfied",
    };

    expect(parseBackupOutboxRow(pending).isOk()).toBe(true);
    expect(parseBackupOutboxRow(claimed).isOk()).toBe(true);
    expect(parseBackupOutboxRow(satisfied).isOk()).toBe(true);
    expect(parseBackupOutboxRow({ ...pending, attemptCount: 1 }).isErr()).toBe(true);
    expect(
      parseBackupOutboxRow({ ...claimed, claimedAt: "2025-12-31T23:59:59.000Z" }).isErr(),
    ).toBe(true);
    expect(parseBackupOutboxRow({ ...satisfied, coveredCommitAt: COMPLETED_AT }).isErr()).toBe(
      true,
    );
    expect(backupOutboxRowSchema.safeParse({ ...satisfied, receipt: "forbidden" }).success).toBe(
      false,
    );
  });

  test("binds verified generations to an exact committed snapshot watermark", () => {
    const row = {
      committedAt: CREATED_AT,
      commitSequence: 1,
      generationId: IDS.generation,
      mutationId: IDS.mutation,
      vaultId: IDS.vault,
      vaultInstanceId: IDS.vaultInstance,
      verifiedAt: COMPLETED_AT,
    };
    expect(parseVerifiedBackupGenerationRow(row).isOk()).toBe(true);
    expect(
      parseVerifiedBackupGenerationRow({ ...row, verifiedAt: "2025-12-31T23:59:59.000Z" }).isErr(),
    ).toBe(true);
    expect(parseVerifiedBackupGenerationRow({ ...row, receipt: "forbidden" }).isErr()).toBe(true);
  });

  test("property: pending retry rows require failure evidence exactly after an attempt", () => {
    fc.assert(
      fc.property(fc.nat({ max: 1_000 }), (attemptCount) => {
        const valid = {
          attemptCount,
          claimedAt: null,
          claimId: null,
          completedAt: null,
          coveredCommitAt: null,
          committedAt: CREATED_AT,
          commitSequence: 1,
          createdAt: CREATED_AT,
          generationId: null,
          lastFailureCode: attemptCount === 0 ? null : "temporarily_unavailable",
          mutationId: IDS.mutation,
          state: "pending",
          vaultId: IDS.vault,
          vaultInstanceId: IDS.vaultInstance,
        };

        expect(parseBackupOutboxRow(valid).isOk()).toBe(true);
        expect(
          parseBackupOutboxRow({
            ...valid,
            lastFailureCode: attemptCount === 0 ? "temporarily_unavailable" : null,
          }).isErr(),
        ).toBe(true);
      }),
    );
  });
});
