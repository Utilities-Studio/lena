import { PERSISTABLE_LENA_ERROR_CODES } from "./obligations";

export const LENA_VAULT_SCHEMA_VERSION = 2 as const;

const PERSISTABLE_ERROR_CODE_SQL = PERSISTABLE_LENA_ERROR_CODES.map((code) => `'${code}'`).join(
  ", ",
);

export const LENA_VAULT_SCHEMA_SQL = Object.freeze([
  `CREATE TABLE IF NOT EXISTS lena_vault_metadata (
    singleton_id INTEGER PRIMARY KEY CHECK (singleton_id = 1),
    vault_id TEXT NOT NULL,
    vault_instance_id TEXT NOT NULL UNIQUE,
    schema_version INTEGER NOT NULL CHECK (schema_version > 0),
    format_version INTEGER NOT NULL CHECK (format_version > 0),
    encryption_envelope_version INTEGER NOT NULL CHECK (encryption_envelope_version > 0),
    created_at TEXT NOT NULL,
    UNIQUE (vault_id, vault_instance_id)
  ) STRICT`,
  `CREATE TABLE IF NOT EXISTS lena_backup_outbox (
    mutation_id TEXT PRIMARY KEY,
    vault_id TEXT NOT NULL,
    vault_instance_id TEXT NOT NULL,
    state TEXT NOT NULL CHECK (state IN ('pending', 'claimed', 'satisfied')),
    attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
    claim_id TEXT,
    generation_id TEXT,
    created_at TEXT NOT NULL,
    claimed_at TEXT,
    covered_commit_at TEXT,
    completed_at TEXT,
    last_failure_code TEXT CHECK (
      last_failure_code IS NULL OR last_failure_code IN (${PERSISTABLE_ERROR_CODE_SQL})
    ),
    CHECK (
      (
        state = 'pending'
        AND claim_id IS NULL
        AND generation_id IS NULL
        AND claimed_at IS NULL
        AND covered_commit_at IS NULL
        AND completed_at IS NULL
        AND (
          (attempt_count = 0 AND last_failure_code IS NULL)
          OR (attempt_count > 0 AND last_failure_code IS NOT NULL)
        )
      )
      OR (
        state = 'claimed'
        AND attempt_count > 0
        AND claim_id IS NOT NULL
        AND generation_id IS NULL
        AND claimed_at IS NOT NULL
        AND claimed_at >= created_at
        AND covered_commit_at IS NULL
        AND completed_at IS NULL
        AND last_failure_code IS NULL
      )
      OR (
        state = 'satisfied'
        AND attempt_count > 0
        AND claim_id IS NOT NULL
        AND generation_id IS NOT NULL
        AND claimed_at IS NOT NULL
        AND claimed_at >= created_at
        AND covered_commit_at IS NOT NULL
        AND covered_commit_at >= created_at
        AND covered_commit_at <= claimed_at
        AND completed_at IS NOT NULL
        AND completed_at >= claimed_at
        AND completed_at >= covered_commit_at
        AND last_failure_code IS NULL
      )
    ),
    FOREIGN KEY (vault_id, vault_instance_id)
      REFERENCES lena_vault_metadata (vault_id, vault_instance_id)
  ) STRICT`,
  `CREATE TABLE IF NOT EXISTS lena_processed_effects (
    effect_id TEXT PRIMARY KEY,
    effect_kind TEXT NOT NULL CHECK (effect_kind = 'backup-obligation'),
    mutation_id TEXT NOT NULL,
    vault_id TEXT NOT NULL,
    vault_instance_id TEXT NOT NULL,
    processed_at TEXT NOT NULL,
    UNIQUE (vault_instance_id, effect_kind, mutation_id),
    FOREIGN KEY (vault_id, vault_instance_id)
      REFERENCES lena_vault_metadata (vault_id, vault_instance_id)
  ) STRICT`,
]);

export const LENA_REQUIRED_PRAGMAS = Object.freeze(["PRAGMA foreign_keys = ON"]);

export const LENA_OPTIONAL_WAL_PRAGMA = "PRAGMA journal_mode = WAL" as const;
