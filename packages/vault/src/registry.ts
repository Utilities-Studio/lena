import {
  err,
  isoTimestampSchema,
  LenaError,
  ok,
  schemaVersionSchema,
  vaultIdSchema,
  vaultInstanceIdSchema,
  type Result,
  type VaultInstanceId,
} from "@lena/core";
import { uniq } from "es-toolkit";
import { z } from "zod";
import type { VaultMetadata } from "./metadata";
import {
  consumeVaultActivationToken,
  consumeVaultRetirementToken,
  consumeVaultValidationToken,
  isVaultActivationToken,
  isVaultRetirementToken,
  isVaultValidationToken,
  type VaultActivationToken,
  type VaultRetirementToken,
  type VaultValidationToken,
} from "./registry-evidence";
import {
  getRuntimeActiveVaultInstance,
  preserveRuntimeActiveVaultInstance,
  setRuntimeActiveVaultInstance,
} from "./registry-runtime";

export type {
  VaultActivationToken,
  VaultRetirementToken,
  VaultValidationToken,
} from "./registry-evidence";

export const VAULT_REGISTRY_FORMAT_VERSION = 1 as const;

const WINDOWS_ABSOLUTE_PATTERN = /^[a-z]:[\\/]/iu;
const URI_SCHEME_PATTERN = /^[a-z][a-z0-9+.-]*:/iu;
const ENCODED_PATH_SEPARATOR_OR_DOT_PATTERN = /%(?:2e|2f|5c)/iu;

function containsControlCharacter(value: string): boolean {
  for (const character of value) {
    const codePoint = character.codePointAt(0);
    if (
      codePoint !== undefined &&
      (codePoint <= 0x1f || (codePoint >= 0x7f && codePoint <= 0x9f))
    ) {
      return true;
    }
  }

  return false;
}

export const vaultLocatorSchema = z
  .string()
  .min(1)
  .max(512)
  .refine((value) => value === value.trim())
  .refine((value) => !containsControlCharacter(value))
  .refine((value) => !value.startsWith("/") && !value.startsWith("\\"))
  .refine((value) => !WINDOWS_ABSOLUTE_PATTERN.test(value))
  .refine((value) => !URI_SCHEME_PATTERN.test(value))
  .refine((value) => !value.includes("\\"))
  .refine((value) => !ENCODED_PATH_SEPARATOR_OR_DOT_PATTERN.test(value))
  .refine((value) =>
    value.split("/").every((segment) => segment.length > 0 && segment !== "." && segment !== ".."),
  );

export const vaultRegistryEntryStateSchema = z.enum(["ready", "retired", "staging"]);

export const vaultRegistryEntrySchema = z
  .strictObject({
    createdAt: isoTimestampSchema,
    locator: vaultLocatorSchema,
    schemaVersion: schemaVersionSchema,
    state: vaultRegistryEntryStateSchema,
    vaultId: vaultIdSchema,
    vaultInstanceId: vaultInstanceIdSchema,
  })
  .readonly();

const vaultRegistryEntryStructureSchema = z.strictObject({
  createdAt: z.unknown(),
  locator: z.unknown(),
  schemaVersion: z.unknown(),
  state: z.unknown(),
  vaultId: z.unknown(),
  vaultInstanceId: z.unknown(),
});

export type VaultRegistryEntryState = z.infer<typeof vaultRegistryEntryStateSchema>;
export type VaultRegistryEntry = z.infer<typeof vaultRegistryEntrySchema>;

export const vaultRegistrySchema = z
  .strictObject({
    activeVaultInstanceId: vaultInstanceIdSchema.nullable(),
    entries: z.array(vaultRegistryEntrySchema).readonly(),
    formatVersion: z.literal(VAULT_REGISTRY_FORMAT_VERSION),
  })
  .superRefine((registry, context) => {
    const instanceIds = registry.entries.map((entry) => entry.vaultInstanceId);
    if (uniq(instanceIds).length !== instanceIds.length) {
      context.addIssue({ code: "custom", message: "duplicate_vault_instance", path: ["entries"] });
    }

    const locators = registry.entries.map((entry) => entry.locator);
    if (uniq(locators).length !== locators.length) {
      context.addIssue({ code: "custom", message: "duplicate_vault_locator", path: ["entries"] });
    }

    if (
      registry.activeVaultInstanceId !== null &&
      !registry.entries.some(
        (entry) =>
          entry.vaultInstanceId === registry.activeVaultInstanceId && entry.state === "ready",
      )
    ) {
      context.addIssue({ code: "custom", message: "active_vault_not_ready", path: ["entries"] });
    }
  })
  .readonly();

const vaultRegistryStructureSchema = z.strictObject({
  activeVaultInstanceId: z.unknown(),
  entries: z.unknown(),
  formatVersion: z.unknown(),
});

/**
 * Runtime evidence is module-local. Parsing this persisted schema creates only
 * a reopen hint; it never registers the result in runtime activation state.
 */
export type VaultRegistry = z.infer<typeof vaultRegistrySchema>;

function preserveRuntimeActivation(source: VaultRegistry, target: VaultRegistry): VaultRegistry {
  preserveRuntimeActiveVaultInstance(source, target);
  return target;
}

export function validateVaultLocator(value: unknown): Result<string, LenaError> {
  const parsed = vaultLocatorSchema.safeParse(value);
  if (!parsed.success) {
    return err(new LenaError("invalid_input", "Vault locator must be a safe relative path"));
  }

  return ok(parsed.data);
}

export function parseVaultRegistryEntry(value: unknown): Result<VaultRegistryEntry, LenaError> {
  const structure = vaultRegistryEntryStructureSchema.safeParse(value);
  if (!structure.success) {
    return err(
      new LenaError("invalid_input", "Persisted record has missing or unexpected fields", {
        boundary: "vault_registry_entry",
      }),
    );
  }

  const parsed = vaultRegistryEntrySchema.safeParse(structure.data);
  if (parsed.success) return ok(parsed.data);

  const failedField = parsed.error.issues[0]?.path[0];
  if (failedField === "createdAt") {
    return err(new LenaError("invalid_timestamp", "Timestamp must be canonical UTC"));
  }
  if (failedField === "vaultId" || failedField === "vaultInstanceId") {
    const kind = failedField === "vaultId" ? "VaultId" : "VaultInstanceId";
    return err(new LenaError("invalid_identifier", `Invalid ${kind}`, { kind }));
  }
  if (failedField === "locator") {
    return err(new LenaError("invalid_input", "Vault locator must be a safe relative path"));
  }
  if (failedField === "state") {
    return err(new LenaError("invalid_input", "Invalid vault registry entry state"));
  }

  return err(
    new LenaError("invalid_input", "Persisted record has missing or unexpected fields", {
      boundary: "vault_registry_entry",
    }),
  );
}

export function createEmptyVaultRegistry(): VaultRegistry {
  return Object.freeze({
    activeVaultInstanceId: null,
    entries: Object.freeze([]),
    formatVersion: VAULT_REGISTRY_FORMAT_VERSION,
  });
}

export function addVaultRegistryEntry(
  registry: VaultRegistry,
  entry: VaultRegistryEntry,
): Result<VaultRegistry, LenaError> {
  const parsedEntry = parseVaultRegistryEntry(entry);
  if (parsedEntry.isErr()) return err(parsedEntry.error);

  if (parsedEntry.value.state !== "staging") {
    return err(
      new LenaError("invalid_state_transition", "New vault instances must begin in staging"),
    );
  }

  return appendVaultRegistryEntry(registry, parsedEntry.value);
}

function appendVaultRegistryEntry(
  registry: VaultRegistry,
  entry: VaultRegistryEntry,
): Result<VaultRegistry, LenaError> {
  if (registry.entries.some((item) => item.vaultInstanceId === entry.vaultInstanceId)) {
    return err(new LenaError("already_exists", "Vault instance is already registered"));
  }

  if (registry.entries.some((item) => item.locator === entry.locator)) {
    return err(new LenaError("already_exists", "Vault locator is already registered"));
  }

  return ok(
    preserveRuntimeActivation(
      registry,
      Object.freeze({
        ...registry,
        entries: Object.freeze([...registry.entries, entry]),
      }),
    ),
  );
}

function evidenceMatchesEntry(
  evidence: VaultActivationToken | VaultRetirementToken | VaultValidationToken,
  entry: VaultRegistryEntry,
): boolean {
  return (
    evidence.entryCreatedAt === entry.createdAt &&
    evidence.locator === entry.locator &&
    evidence.schemaVersion === entry.schemaVersion &&
    evidence.vaultId === entry.vaultId &&
    evidence.vaultInstanceId === entry.vaultInstanceId
  );
}

function retirementReplacementMatchesEntry(
  evidence: VaultRetirementToken,
  entry: VaultRegistryEntry,
): boolean {
  return (
    evidence.replacementEntryCreatedAt === entry.createdAt &&
    evidence.replacementLocator === entry.locator &&
    evidence.replacementSchemaVersion === entry.schemaVersion &&
    evidence.replacementVaultId === entry.vaultId &&
    evidence.replacementVaultInstanceId === entry.vaultInstanceId
  );
}

export function markStagingVaultReady(
  registry: VaultRegistry,
  evidence: VaultValidationToken,
): Result<VaultRegistry, LenaError> {
  if (!isVaultValidationToken(evidence)) {
    return err(
      new LenaError("authentication_required", "Vault readiness lacks validation evidence", {
        boundary: "vault_registry",
      }),
    );
  }
  const entry = registry.entries.find(
    (candidate) => candidate.vaultInstanceId === evidence.vaultInstanceId,
  );
  if (entry === undefined) {
    return err(new LenaError("not_found", "Vault instance is not registered"));
  }
  if (entry.state !== "staging" || !evidenceMatchesEntry(evidence, entry)) {
    return err(
      new LenaError("invalid_state_transition", "Validation evidence does not match staging vault"),
    );
  }
  if (!consumeVaultValidationToken(evidence)) {
    return err(new LenaError("conflict", "Vault validation evidence was already consumed"));
  }

  const entries = registry.entries.map((candidate) =>
    candidate.vaultInstanceId === entry.vaultInstanceId
      ? Object.freeze({ ...candidate, state: "ready" as const })
      : candidate,
  );
  return ok(
    preserveRuntimeActivation(
      registry,
      Object.freeze({ ...registry, entries: Object.freeze(entries) }),
    ),
  );
}

export function activateRegisteredVault(
  registry: VaultRegistry,
  evidence: VaultActivationToken,
): Result<VaultRegistry, LenaError> {
  if (!isVaultActivationToken(evidence)) {
    return err(
      new LenaError("authentication_required", "Vault activation lacks validation evidence", {
        boundary: "vault_registry",
      }),
    );
  }
  const entry = registry.entries.find((item) => item.vaultInstanceId === evidence.vaultInstanceId);
  if (!entry) {
    return err(new LenaError("not_found", "Vault instance is not registered"));
  }

  if (entry.state !== "ready" || !evidenceMatchesEntry(evidence, entry)) {
    return err(
      new LenaError("invalid_state_transition", "Only a ready vault instance can become active", {
        state: entry.state,
      }),
    );
  }
  if (!consumeVaultActivationToken(evidence)) {
    return err(new LenaError("conflict", "Vault activation evidence was already consumed"));
  }

  const activated = Object.freeze({
    ...registry,
    activeVaultInstanceId: entry.vaultInstanceId,
  });
  setRuntimeActiveVaultInstance(activated, entry.vaultInstanceId);
  return ok(activated);
}

export function updateRegisteredVaultState(
  registry: VaultRegistry,
  vaultInstanceId: VaultInstanceId,
  state: VaultRegistryEntryState,
): Result<VaultRegistry, LenaError> {
  const parsedState = vaultRegistryEntryStateSchema.safeParse(state);
  if (!parsedState.success) {
    return err(new LenaError("invalid_input", "Invalid vault registry entry state"));
  }
  const index = registry.entries.findIndex((item) => item.vaultInstanceId === vaultInstanceId);
  if (index < 0) {
    return err(new LenaError("not_found", "Vault instance is not registered"));
  }

  const current = registry.entries[index];
  if (current === undefined) {
    return err(new LenaError("internal", "Registered vault lookup failed"));
  }
  if (current.state === parsedState.data) return ok(registry);
  return err(
    new LenaError(
      "invalid_state_transition",
      "Vault registry state changes require dedicated evidence",
    ),
  );
}

export function retireRegisteredVault(
  registry: VaultRegistry,
  evidence: VaultRetirementToken,
): Result<VaultRegistry, LenaError> {
  if (!isVaultRetirementToken(evidence)) {
    return err(
      new LenaError("authentication_required", "Vault retirement lacks cleanup authorization", {
        boundary: "vault_registry",
      }),
    );
  }

  const retiringEntry = registry.entries.find(
    (entry) => entry.vaultInstanceId === evidence.vaultInstanceId,
  );
  const replacementEntry = registry.entries.find(
    (entry) => entry.vaultInstanceId === evidence.replacementVaultInstanceId,
  );
  if (retiringEntry === undefined || replacementEntry === undefined) {
    return err(new LenaError("not_found", "Vault retirement instance is not registered"));
  }
  if (retiringEntry.state !== "ready" || !evidenceMatchesEntry(evidence, retiringEntry)) {
    return err(
      new LenaError("invalid_state_transition", "Retirement evidence does not match ready vault"),
    );
  }
  if (
    replacementEntry.state !== "ready" ||
    !retirementReplacementMatchesEntry(evidence, replacementEntry)
  ) {
    return err(
      new LenaError(
        "invalid_state_transition",
        "Retirement replacement does not match a ready vault",
      ),
    );
  }

  const runtimeActiveVaultInstanceId = getRuntimeActiveVaultInstance(registry);
  if (
    runtimeActiveVaultInstanceId !== replacementEntry.vaultInstanceId ||
    registry.activeVaultInstanceId !== replacementEntry.vaultInstanceId
  ) {
    return err(
      new LenaError(
        "invalid_state_transition",
        "Retirement requires its exact replacement to be runtime-active",
      ),
    );
  }
  if (!consumeVaultRetirementToken(evidence)) {
    return err(new LenaError("conflict", "Vault retirement evidence was already consumed"));
  }

  const entries = registry.entries.map((entry) =>
    entry.vaultInstanceId === retiringEntry.vaultInstanceId
      ? Object.freeze({ ...entry, state: "retired" as const })
      : entry,
  );
  const retired = Object.freeze({ ...registry, entries: Object.freeze(entries) });
  setRuntimeActiveVaultInstance(retired, replacementEntry.vaultInstanceId);
  return ok(retired);
}

export function getActiveVaultEntry(registry: VaultRegistry): VaultRegistryEntry | null {
  const runtimeActiveVaultInstanceId = getRuntimeActiveVaultInstance(registry);
  if (runtimeActiveVaultInstanceId === undefined) return null;
  return (
    registry.entries.find((entry) => entry.vaultInstanceId === runtimeActiveVaultInstanceId) ?? null
  );
}

export function getSelectedVaultEntryForReopen(registry: VaultRegistry): VaultRegistryEntry | null {
  if (registry.activeVaultInstanceId === null) return null;
  return (
    registry.entries.find((entry) => entry.vaultInstanceId === registry.activeVaultInstanceId) ??
    null
  );
}

export function parseVaultRegistry(value: unknown): Result<VaultRegistry, LenaError> {
  const structure = vaultRegistryStructureSchema.safeParse(value);
  if (!structure.success) {
    return err(
      new LenaError("invalid_input", "Persisted record has missing or unexpected fields", {
        boundary: "vault_registry",
      }),
    );
  }

  if (structure.data.formatVersion !== VAULT_REGISTRY_FORMAT_VERSION) {
    return err(new LenaError("unsupported", "Unsupported vault registry format"));
  }

  if (!Array.isArray(structure.data.entries)) {
    return err(new LenaError("invalid_input", "Vault registry entries must be an array"));
  }
  for (const entry of structure.data.entries) {
    if (!vaultRegistryEntryStructureSchema.safeParse(entry).success) {
      return err(
        new LenaError("invalid_input", "Persisted record has missing or unexpected fields", {
          boundary: "vault_registry_entry",
        }),
      );
    }
  }

  const parsed = vaultRegistrySchema.safeParse(structure.data);
  if (parsed.success) return ok(parsed.data);

  const invariant = parsed.error.issues.find((issue) => issue.code === "custom")?.message;
  if (invariant === "duplicate_vault_instance") {
    return err(new LenaError("already_exists", "Vault instance is already registered"));
  }
  if (invariant === "duplicate_vault_locator") {
    return err(new LenaError("already_exists", "Vault locator is already registered"));
  }
  if (invariant === "active_vault_not_ready") {
    return err(new LenaError("invalid_state_transition", "Persisted active vault is not ready"));
  }

  const issue = parsed.error.issues[0];
  const failedField = issue?.path.at(-1);
  if (failedField === "createdAt") {
    return err(new LenaError("invalid_timestamp", "Timestamp must be canonical UTC"));
  }
  if (
    failedField === "vaultId" ||
    failedField === "vaultInstanceId" ||
    failedField === "activeVaultInstanceId"
  ) {
    const kind = failedField === "vaultId" ? "VaultId" : "VaultInstanceId";
    return err(new LenaError("invalid_identifier", `Invalid ${kind}`, { kind }));
  }
  if (issue?.path[0] === "entries" && issue.path.length === 1) {
    return err(new LenaError("invalid_input", "Vault registry entries must be an array"));
  }

  return err(
    new LenaError("invalid_input", "Persisted record has missing or unexpected fields", {
      boundary: "vault_registry",
    }),
  );
}

export function validateVaultMetadataAgainstRegistryEntry(
  metadata: VaultMetadata,
  entry: VaultRegistryEntry,
): Result<VaultRegistryEntry, LenaError> {
  if (metadata.vaultId !== entry.vaultId) {
    return err(
      new LenaError("integrity_failed", "Vault metadata does not match registry identity", {
        identityField: "vaultId",
      }),
    );
  }

  if (metadata.vaultInstanceId !== entry.vaultInstanceId) {
    return err(
      new LenaError("integrity_failed", "Vault metadata does not match registry identity", {
        identityField: "vaultInstanceId",
      }),
    );
  }

  if (metadata.schemaVersion !== entry.schemaVersion) {
    return err(
      new LenaError("incompatible_schema", "Vault metadata does not match registry schema", {
        registrySchemaVersion: entry.schemaVersion,
        vaultSchemaVersion: metadata.schemaVersion,
      }),
    );
  }

  return ok(entry);
}
