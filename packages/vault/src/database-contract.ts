import { err, LenaError, ok, type Result } from "@lena/core";
import { z } from "zod";

export const vaultDatabaseCapabilitiesSchema = z
  .strictObject({
    consistentSnapshot: z.boolean(),
    exclusiveTransactions: z.boolean(),
    foreignKeys: z.boolean(),
    /** Derived-search capability. It never gates canonical vault access. */
    fts5: z.boolean(),
    integrityCheck: z.boolean(),
    sqlCipher: z.boolean(),
    /** Derived-search capability. It never gates canonical vault access. */
    sqliteVec: z.boolean(),
    /** Optional performance mode. The adapter enables it only where safe. */
    wal: z.boolean(),
  })
  .readonly();

export type VaultDatabaseCapabilities = z.infer<typeof vaultDatabaseCapabilitiesSchema>;

export const vaultDatabaseNameSchema = z.string().regex(/^[a-z0-9][a-z0-9_-]{0,62}\.db$/);

export type VaultDatabaseOpenStep =
  | "open-with-key"
  | "cipher-integrity-check"
  | "enable-foreign-keys"
  | "enable-wal"
  | "read-vault-metadata"
  | "apply-transactional-migrations"
  | "application-integrity-check"
  | "ready";

export const REQUIRED_VAULT_OPEN_SEQUENCE: readonly VaultDatabaseOpenStep[] = Object.freeze([
  "open-with-key",
  "cipher-integrity-check",
  "enable-foreign-keys",
  "read-vault-metadata",
  "apply-transactional-migrations",
  "application-integrity-check",
  "ready",
]);

export function createVaultDatabaseOpenSequence(
  capabilities: Pick<VaultDatabaseCapabilities, "wal">,
): readonly VaultDatabaseOpenStep[] {
  if (!capabilities.wal) return REQUIRED_VAULT_OPEN_SEQUENCE;

  return Object.freeze([
    "open-with-key",
    "cipher-integrity-check",
    "enable-foreign-keys",
    "enable-wal",
    "read-vault-metadata",
    "apply-transactional-migrations",
    "application-integrity-check",
    "ready",
  ]);
}

export function validatePrivateVaultDatabaseCapabilities(
  capabilities: VaultDatabaseCapabilities,
): Result<VaultDatabaseCapabilities, LenaError> {
  const parsed = vaultDatabaseCapabilitiesSchema.safeParse(capabilities);
  if (!parsed.success) {
    const capability = parsed.error.issues[0]?.path[0];
    return err(
      new LenaError("unsupported", {
        capability: typeof capability === "string" ? capability : "capability_shape",
      }),
    );
  }

  const required: readonly (keyof VaultDatabaseCapabilities)[] = [
    "consistentSnapshot",
    "exclusiveTransactions",
    "foreignKeys",
    "integrityCheck",
    "sqlCipher",
  ];
  const missing = required.find((capability) => !parsed.data[capability]);
  if (missing) {
    return err(
      new LenaError("unsupported", {
        capability: missing,
      }),
    );
  }

  return ok(parsed.data);
}

export function validateVaultDatabaseName(value: string): Result<string, LenaError> {
  const parsed = vaultDatabaseNameSchema.safeParse(value);
  if (!parsed.success) {
    return err(new LenaError("invalid_input"));
  }

  return ok(parsed.data);
}
