import { describe, expect, test } from "bun:test";
import { LENA_VAULT_SCHEMA_SQL, PERSISTABLE_LENA_ERROR_CODES } from "../../src/index";

describe("Lena-owned SQL contract", () => {
  test("binds metadata, outbox, and processed effects to a physical vault instance", () => {
    const metadataSql = LENA_VAULT_SCHEMA_SQL[0] ?? "";
    const outboxSql = LENA_VAULT_SCHEMA_SQL[1] ?? "";
    const effectsSql = LENA_VAULT_SCHEMA_SQL[2] ?? "";

    expect(metadataSql).toContain("vault_instance_id TEXT NOT NULL UNIQUE");
    expect(outboxSql).toContain("FOREIGN KEY (vault_id, vault_instance_id)");
    expect(effectsSql).toContain("FOREIGN KEY (vault_id, vault_instance_id)");
    expect(effectsSql).toContain("mutation_id TEXT NOT NULL");
  });

  test("enforces state-specific outbox columns and enumerated failure codes", () => {
    const outboxSql = LENA_VAULT_SCHEMA_SQL[1] ?? "";

    expect(outboxSql).toContain("state = 'pending'");
    expect(outboxSql).toContain("state = 'claimed'");
    expect(outboxSql).toContain("state = 'satisfied'");
    expect(outboxSql).toContain("claim_id IS NULL");
    expect(outboxSql).toContain("claim_id IS NOT NULL");
    expect(outboxSql).toContain("generation_id IS NOT NULL");
    expect(outboxSql).toContain("covered_commit_at IS NOT NULL");
    expect(outboxSql).toContain("covered_commit_at <= claimed_at");
    expect(outboxSql).toContain("completed_at >= claimed_at");
    expect(outboxSql).toContain("completed_at >= covered_commit_at");
    for (const code of PERSISTABLE_LENA_ERROR_CODES) {
      expect(outboxSql).toContain(`'${code}'`);
    }
  });
});
