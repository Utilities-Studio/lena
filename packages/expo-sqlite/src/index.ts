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

export const EXPO_SQLITE_RUNTIME_STATUS = "dependency-gated" as const;

export interface ExpoSqliteBuildCapabilities extends VaultDatabaseCapabilities {
  readonly asyncDatabaseBackup: boolean;
  readonly expoGo: boolean;
}

export interface ExpoSqliteReadiness {
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
  readonly status: typeof EXPO_SQLITE_RUNTIME_STATUS;
}

export function assessExpoSqliteReadiness(
  capabilities: ExpoSqliteBuildCapabilities,
): ExpoSqliteReadiness {
  const derivedFeatures = Object.freeze({
    fts5: capabilities.fts5,
    sqliteVec: capabilities.sqliteVec,
    wal: capabilities.wal,
  });
  const openSequence = createVaultDatabaseOpenSequence(capabilities);
  if (capabilities.expoGo) {
    return Object.freeze({
      contractRequirementsSatisfied: false,
      derivedFeatures,
      missingCapability: "Expo Go cannot provide the SQLCipher runtime",
      openSequence,
      runtimeReady: false,
      status: EXPO_SQLITE_RUNTIME_STATUS,
    });
  }
  if (!capabilities.asyncDatabaseBackup) {
    return Object.freeze({
      contractRequirementsSatisfied: false,
      derivedFeatures,
      missingCapability: "asyncDatabaseBackup",
      openSequence,
      runtimeReady: false,
      status: EXPO_SQLITE_RUNTIME_STATUS,
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
    status: EXPO_SQLITE_RUNTIME_STATUS,
  });
}
