import {
  err,
  isSchemaCompatible,
  LenaError,
  ok,
  type Result,
  type SchemaCompatibilityRange,
  type VaultId,
} from "@lena/core";
import { orderBy } from "es-toolkit";
import type { GenerationManifest } from "./manifest";
import { isRuntimeVerifiedGeneration, type VerifiedGeneration } from "./transport";

export type BackupSource = "google-drive" | "icloud" | "local" | "manual";

/**
 * A local, post-download candidate. Remote adapters must verify the encrypted
 * object and decrypt its authenticated manifest locally before constructing it.
 * The manifest must never be copied into provider metadata for discovery.
 */
export interface GenerationCandidate {
  readonly available: boolean;
  readonly manifest: GenerationManifest;
  readonly source: BackupSource;
  readonly verification: VerifiedGeneration | null;
}

declare const validatedRestoreCandidateBrand: unique symbol;

export type ValidatedRestoreCandidate = Readonly<
  GenerationCandidate & {
    readonly [validatedRestoreCandidateBrand]: "ValidatedRestoreCandidate";
    readonly verification: VerifiedGeneration;
  }
>;

const runtimeValidatedRestoreCandidates = new WeakSet<object>();

export function isRuntimeValidatedRestoreCandidate(
  value: unknown,
): value is ValidatedRestoreCandidate {
  return (
    typeof value === "object" && value !== null && runtimeValidatedRestoreCandidates.has(value)
  );
}

const SOURCE_ORDER: Readonly<Record<BackupSource, number>> = Object.freeze({
  "google-drive": 2,
  icloud: 1,
  local: 0,
  manual: 3,
});

export function orderGenerationCandidates(
  candidates: readonly GenerationCandidate[],
): readonly GenerationCandidate[] {
  return Object.freeze(
    orderBy(
      candidates,
      [
        (candidate) => candidate.manifest.completedAt,
        (candidate) => candidate.manifest.generationId,
        (candidate) => SOURCE_ORDER[candidate.source],
      ],
      ["desc", "asc", "asc"],
    ),
  );
}

export function validateRestoreCandidate(
  candidate: GenerationCandidate,
  supportedSchema: SchemaCompatibilityRange,
  expectedVaultId: VaultId,
): Result<ValidatedRestoreCandidate, LenaError> {
  if (!candidate.available) {
    return err(new LenaError("temporarily_unavailable", "Backup unavailable"));
  }
  if (candidate.manifest.vaultId !== expectedVaultId) {
    return err(new LenaError("conflict", "Backup belongs to another vault"));
  }
  const verification = candidate.verification;
  if (verification === null || !isRuntimeVerifiedGeneration(verification)) {
    return err(new LenaError("integrity_failed", "Backup has not been verified"));
  }
  if (
    verification.vaultId !== candidate.manifest.vaultId ||
    verification.generationId !== candidate.manifest.generationId
  ) {
    return err(new LenaError("integrity_failed", "Backup verification does not match manifest"));
  }
  const remoteSource = candidate.source === "google-drive" || candidate.source === "icloud";
  if (
    (remoteSource &&
      (verification.kind !== "remote" || verification.provider !== candidate.source)) ||
    (!remoteSource && (verification.kind !== "local" || verification.provider !== null))
  ) {
    return err(new LenaError("integrity_failed", "Backup verification belongs to another source"));
  }
  if (!isSchemaCompatible(candidate.manifest.schemaVersion, supportedSchema)) {
    return err(
      new LenaError("incompatible_schema", "Backup schema is not supported by this application"),
    );
  }

  const validated = Object.freeze({ ...candidate, verification }) as ValidatedRestoreCandidate;
  runtimeValidatedRestoreCandidates.add(validated);
  return ok(validated);
}
