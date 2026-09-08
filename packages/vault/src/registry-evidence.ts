import {
  compareIsoTimestamps,
  err,
  LenaError,
  ok,
  parseIsoTimestamp,
  type IsoTimestamp,
  type Result,
  type SchemaVersion,
  type VaultId,
  type VaultInstanceId,
} from "@lena/core";

import type { VaultMetadata } from "./metadata";
import type { VaultRegistry, VaultRegistryEntry } from "./registry";
import { getRuntimeActiveVaultInstance } from "./registry-runtime";

interface VaultRegistryEvidenceFields {
  readonly encryptionEnvelopeVersion: number;
  readonly entryCreatedAt: IsoTimestamp;
  readonly locator: string;
  readonly metadataCreatedAt: IsoTimestamp;
  readonly metadataFormatVersion: number;
  readonly schemaVersion: SchemaVersion;
  readonly validatedAt: IsoTimestamp;
  readonly vaultId: VaultId;
  readonly vaultInstanceId: VaultInstanceId;
}

interface VaultRetirementEvidenceFields extends VaultRegistryEvidenceFields {
  readonly cleanupAuthorizedAt: IsoTimestamp;
  readonly replacementEntryCreatedAt: IsoTimestamp;
  readonly replacementLocator: string;
  readonly replacementSchemaVersion: SchemaVersion;
  readonly replacementVaultId: VaultId;
  readonly replacementVaultInstanceId: VaultInstanceId;
}

const vaultValidationTokenBrand: unique symbol = Symbol("VaultValidationToken");
const vaultActivationTokenBrand: unique symbol = Symbol("VaultActivationToken");
const vaultRetirementTokenBrand: unique symbol = Symbol("VaultRetirementToken");
const issuedVaultValidationTokens = new WeakSet();
const issuedVaultActivationTokens = new WeakSet();
const issuedVaultRetirementTokens = new WeakSet();
const consumedVaultValidationTokens = new WeakSet();
const consumedVaultActivationTokens = new WeakSet();
const consumedVaultRetirementTokens = new WeakSet();

export type VaultValidationToken = Readonly<
  VaultRegistryEvidenceFields & {
    readonly [vaultValidationTokenBrand]: true;
  }
>;

export type VaultActivationToken = Readonly<
  VaultRegistryEvidenceFields & {
    readonly [vaultActivationTokenBrand]: true;
  }
>;

export type VaultRetirementToken = Readonly<
  VaultRetirementEvidenceFields & {
    readonly [vaultRetirementTokenBrand]: true;
  }
>;

export function isVaultValidationToken(input: unknown): input is VaultValidationToken {
  return (
    typeof input === "object" &&
    input !== null &&
    issuedVaultValidationTokens.has(input) &&
    !consumedVaultValidationTokens.has(input) &&
    (input as { readonly [vaultValidationTokenBrand]?: unknown })[vaultValidationTokenBrand] ===
      true
  );
}

export function isVaultActivationToken(input: unknown): input is VaultActivationToken {
  return (
    typeof input === "object" &&
    input !== null &&
    issuedVaultActivationTokens.has(input) &&
    !consumedVaultActivationTokens.has(input) &&
    (input as { readonly [vaultActivationTokenBrand]?: unknown })[vaultActivationTokenBrand] ===
      true
  );
}

export function isVaultRetirementToken(input: unknown): input is VaultRetirementToken {
  return (
    typeof input === "object" &&
    input !== null &&
    issuedVaultRetirementTokens.has(input) &&
    !consumedVaultRetirementTokens.has(input) &&
    (input as { readonly [vaultRetirementTokenBrand]?: unknown })[vaultRetirementTokenBrand] ===
      true
  );
}

export function consumeVaultValidationToken(token: VaultValidationToken): boolean {
  if (!isVaultValidationToken(token)) return false;
  consumedVaultValidationTokens.add(token);
  return true;
}

export function consumeVaultActivationToken(token: VaultActivationToken): boolean {
  if (!isVaultActivationToken(token)) return false;
  consumedVaultActivationTokens.add(token);
  return true;
}

export function consumeVaultRetirementToken(token: VaultRetirementToken): boolean {
  if (!isVaultRetirementToken(token)) return false;
  consumedVaultRetirementTokens.add(token);
  return true;
}

function validatedEvidenceFields(
  input: Readonly<{
    entry: VaultRegistryEntry;
    metadata: VaultMetadata;
    requiredState: "ready" | "staging";
    validatedAt: IsoTimestamp;
  }>,
): Result<VaultRegistryEvidenceFields, LenaError> {
  const validatedAt = parseIsoTimestamp(input.validatedAt);
  if (validatedAt.isErr()) return err(validatedAt.error);
  if (input.entry.state !== input.requiredState) {
    return err(
      new LenaError("invalid_state_transition", {
        boundary: "vault_registry_adapter",
        state: input.entry.state,
      }),
    );
  }
  if (
    input.metadata.vaultId !== input.entry.vaultId ||
    input.metadata.vaultInstanceId !== input.entry.vaultInstanceId
  ) {
    return err(
      new LenaError("integrity_failed", {
        boundary: "vault_registry_adapter",
      }),
    );
  }
  if (input.metadata.schemaVersion !== input.entry.schemaVersion) {
    return err(
      new LenaError("incompatible_schema", {
        boundary: "vault_registry_adapter",
      }),
    );
  }
  if (
    compareIsoTimestamps(validatedAt.value, input.entry.createdAt) < 0 ||
    compareIsoTimestamps(validatedAt.value, input.metadata.createdAt) < 0
  ) {
    return err(
      new LenaError("invalid_timestamp", {
        boundary: "vault_registry_adapter",
      }),
    );
  }

  return ok(
    Object.freeze({
      encryptionEnvelopeVersion: input.metadata.encryptionEnvelopeVersion,
      entryCreatedAt: input.entry.createdAt,
      locator: input.entry.locator,
      metadataCreatedAt: input.metadata.createdAt,
      metadataFormatVersion: input.metadata.formatVersion,
      schemaVersion: input.entry.schemaVersion,
      validatedAt: validatedAt.value,
      vaultId: input.entry.vaultId,
      vaultInstanceId: input.entry.vaultInstanceId,
    }),
  );
}

/** Internal native-adapter boundary after staging open and integrity validation. */
export function createVaultValidationTokenFromAdapter(
  input: Readonly<{
    entry: VaultRegistryEntry;
    metadata: VaultMetadata;
    validatedAt: IsoTimestamp;
  }>,
): Result<VaultValidationToken, LenaError> {
  const fields = validatedEvidenceFields({ ...input, requiredState: "staging" });
  if (fields.isErr()) return err(fields.error);
  const tokenFields: VaultValidationToken = {
    ...fields.value,
    [vaultValidationTokenBrand]: true,
  };
  const token = Object.freeze(tokenFields);
  issuedVaultValidationTokens.add(token);
  return ok(token);
}

/** Internal native-adapter boundary after reopening and validating a ready instance. */
export function createVaultActivationTokenFromAdapter(
  input: Readonly<{
    entry: VaultRegistryEntry;
    metadata: VaultMetadata;
    validatedAt: IsoTimestamp;
  }>,
): Result<VaultActivationToken, LenaError> {
  const fields = validatedEvidenceFields({ ...input, requiredState: "ready" });
  if (fields.isErr()) return err(fields.error);
  const tokenFields: VaultActivationToken = {
    ...fields.value,
    [vaultActivationTokenBrand]: true,
  };
  const token = Object.freeze(tokenFields);
  issuedVaultActivationTokens.add(token);
  return ok(token);
}

/**
 * Internal cleanup-authority boundary. The adapter performs separate policy,
 * retention, and rollback checks before calling this function. The timestamp
 * records that decision; it is not authority by itself. Both issuance and
 * consumption require the exact replacement to be runtime-active.
 */
export function createVaultRetirementTokenFromAdapter(
  input: Readonly<{
    cleanupAuthorizedAt: IsoTimestamp;
    registry: VaultRegistry;
    replacementEntry: VaultRegistryEntry;
    retiringEntry: VaultRegistryEntry;
    retiringMetadata: VaultMetadata;
    validatedAt: IsoTimestamp;
  }>,
): Result<VaultRetirementToken, LenaError> {
  const fields = validatedEvidenceFields({
    entry: input.retiringEntry,
    metadata: input.retiringMetadata,
    requiredState: "ready",
    validatedAt: input.validatedAt,
  });
  if (fields.isErr()) return err(fields.error);

  const cleanupAuthorizedAt = parseIsoTimestamp(input.cleanupAuthorizedAt);
  if (cleanupAuthorizedAt.isErr()) return err(cleanupAuthorizedAt.error);
  if (
    input.replacementEntry.state !== "ready" ||
    input.replacementEntry.vaultId !== input.retiringEntry.vaultId ||
    input.replacementEntry.vaultInstanceId === input.retiringEntry.vaultInstanceId
  ) {
    return err(new LenaError("invalid_state_transition", { boundary: "vault_registry_adapter" }));
  }
  if (
    !input.registry.entries.includes(input.retiringEntry) ||
    !input.registry.entries.includes(input.replacementEntry) ||
    getRuntimeActiveVaultInstance(input.registry) !== input.replacementEntry.vaultInstanceId ||
    input.registry.activeVaultInstanceId !== input.replacementEntry.vaultInstanceId
  ) {
    return err(new LenaError("invalid_state_transition", { boundary: "vault_registry_adapter" }));
  }
  if (
    compareIsoTimestamps(cleanupAuthorizedAt.value, fields.value.validatedAt) < 0 ||
    compareIsoTimestamps(cleanupAuthorizedAt.value, input.replacementEntry.createdAt) < 0
  ) {
    return err(
      new LenaError("invalid_timestamp", {
        boundary: "vault_registry_adapter",
      }),
    );
  }

  const tokenFields: VaultRetirementToken = {
    ...fields.value,
    [vaultRetirementTokenBrand]: true,
    cleanupAuthorizedAt: cleanupAuthorizedAt.value,
    replacementEntryCreatedAt: input.replacementEntry.createdAt,
    replacementLocator: input.replacementEntry.locator,
    replacementSchemaVersion: input.replacementEntry.schemaVersion,
    replacementVaultId: input.replacementEntry.vaultId,
    replacementVaultInstanceId: input.replacementEntry.vaultInstanceId,
  };
  const token = Object.freeze(tokenFields);
  issuedVaultRetirementTokens.add(token);
  return ok(token);
}
