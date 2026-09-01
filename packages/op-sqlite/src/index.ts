import {
  createVaultDatabaseOpenSequence,
  validatePrivateVaultDatabaseCapabilities,
  type VaultDatabaseCapabilities,
  type VaultDatabaseOpenStep,
} from "@lena/vault";
import { pick } from "es-toolkit";

const VAULT_DATABASE_CAPABILITY_KEYS = [
  "consistentSnapshot",
  "exclusiveTransactions",
  "foreignKeys",
  "fts5",
  "integrityCheck",
  "sqlCipher",
  "sqliteVec",
  "wal",
] as const satisfies readonly (keyof VaultDatabaseCapabilities)[];

export const OP_SQLITE_RUNTIME_STATUS = "dependency-gated" as const;

export interface OpSqliteBuildCapabilities extends VaultDatabaseCapabilities {
  readonly libsqlRemoteMode: boolean;
}

export interface OpSqliteReadiness {
  readonly contractRequirementsSatisfied: boolean;
  readonly derivedFeatures: Readonly<{
    fts5: boolean;
    sqliteVec: boolean;
    wal: boolean;
  }>;
  readonly missingCapability: string | null;
  readonly openSequence: readonly VaultDatabaseOpenStep[];
  /** Always false until an approved native adapter exists and device gates pass. */
  readonly runtimeReady: false;
  readonly status: typeof OP_SQLITE_RUNTIME_STATUS;
}

export function assessOpSqliteReadiness(
  capabilities: OpSqliteBuildCapabilities,
): OpSqliteReadiness {
  const derivedFeatures = Object.freeze({
    fts5: capabilities.fts5,
    sqliteVec: capabilities.sqliteVec,
    wal: capabilities.wal,
  });
  const openSequence = createVaultDatabaseOpenSequence(capabilities);
  if (capabilities.libsqlRemoteMode) {
    return Object.freeze({
      contractRequirementsSatisfied: false,
      derivedFeatures,
      missingCapability: "libsqlRemoteMode must be disabled",
      openSequence,
      runtimeReady: false,
      status: OP_SQLITE_RUNTIME_STATUS,
    });
  }

  const validated = validatePrivateVaultDatabaseCapabilities(
    pick(capabilities, VAULT_DATABASE_CAPABILITY_KEYS),
  );
  return Object.freeze({
    contractRequirementsSatisfied: validated.isOk(),
    derivedFeatures,
    missingCapability: validated.isOk()
      ? null
      : String(validated.error.details["capability"] ?? "unknown"),
    openSequence,
    runtimeReady: false,
    status: OP_SQLITE_RUNTIME_STATUS,
  });
}
