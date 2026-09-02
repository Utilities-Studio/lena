import { take } from "es-toolkit";
import { z } from "zod";
import { err, ok, type Result } from "./result";

export const lenaErrorCodeSchema = z.enum([
  "already_exists",
  "authentication_required",
  "cancelled",
  "conflict",
  "incompatible_schema",
  "insufficient_space",
  "integrity_failed",
  "internal",
  "invalid_identifier",
  "invalid_input",
  "invalid_state_transition",
  "invalid_timestamp",
  "limit_exceeded",
  "not_found",
  "quota_exceeded",
  "temporarily_unavailable",
  "unsupported",
  "wrong_key_or_corrupt",
]);

export type LenaErrorCode = z.infer<typeof lenaErrorCodeSchema>;

const MAX_DIAGNOSTIC_KEYS = 16;
const SAFE_DIAGNOSTIC_TOKEN = /^[A-Za-z][A-Za-z0-9._:-]{0,63}$/;
const safeDiagnosticTokenSchema = z.string().regex(SAFE_DIAGNOSTIC_TOKEN);
const safeDiagnosticNumberSchema = z.number().finite().nullable();

export const safeDiagnosticDetailsSchema = z
  .strictObject({
    actual: safeDiagnosticNumberSchema.optional(),
    boundary: safeDiagnosticTokenSchema.optional(),
    capability: safeDiagnosticTokenSchema.optional(),
    current: safeDiagnosticNumberSchema.optional(),
    downloadedBytes: safeDiagnosticNumberSchema.optional(),
    event: safeDiagnosticTokenSchema.optional(),
    expected: safeDiagnosticNumberSchema.optional(),
    expectedBytes: safeDiagnosticNumberSchema.optional(),
    formatVersion: safeDiagnosticNumberSchema.optional(),
    from: safeDiagnosticNumberSchema.optional(),
    identityField: safeDiagnosticTokenSchema.optional(),
    kind: safeDiagnosticTokenSchema.optional(),
    maximum: safeDiagnosticNumberSchema.optional(),
    minimum: safeDiagnosticNumberSchema.optional(),
    missingFrom: safeDiagnosticNumberSchema.optional(),
    modality: safeDiagnosticTokenSchema.optional(),
    reason: safeDiagnosticTokenSchema.optional(),
    registrySchemaVersion: safeDiagnosticNumberSchema.optional(),
    retryable: z.boolean().optional(),
    state: safeDiagnosticTokenSchema.optional(),
    target: safeDiagnosticNumberSchema.optional(),
    to: safeDiagnosticNumberSchema.optional(),
    vaultSchemaVersion: safeDiagnosticNumberSchema.optional(),
  })
  .readonly();

export type SafeDiagnosticDetails = z.infer<typeof safeDiagnosticDetailsSchema>;
export type SafeDiagnosticValue = Exclude<
  SafeDiagnosticDetails[keyof SafeDiagnosticDetails],
  undefined
>;
const SAFE_STRING_DETAIL_KEYS: ReadonlySet<string> = new Set([
  "boundary",
  "capability",
  "event",
  "identityField",
  "kind",
  "modality",
  "reason",
  "state",
]);
const SAFE_NUMBER_DETAIL_KEYS: ReadonlySet<string> = new Set([
  "actual",
  "current",
  "downloadedBytes",
  "expected",
  "expectedBytes",
  "formatVersion",
  "from",
  "maximum",
  "minimum",
  "missingFrom",
  "registrySchemaVersion",
  "target",
  "to",
  "vaultSchemaVersion",
]);

const SAFE_ERROR_MESSAGES = {
  already_exists: "The resource already exists",
  authentication_required: "Authentication is required",
  cancelled: "The operation was cancelled",
  conflict: "The operation conflicts with current state",
  incompatible_schema: "The data schema is incompatible",
  insufficient_space: "Storage space is insufficient",
  integrity_failed: "Integrity verification failed",
  internal: "An internal error occurred",
  invalid_identifier: "An identifier is invalid",
  invalid_input: "Input is invalid",
  invalid_state_transition: "The state transition is invalid",
  invalid_timestamp: "A timestamp is invalid",
  limit_exceeded: "A safety limit was exceeded",
  not_found: "The resource was not found",
  quota_exceeded: "The storage quota was exceeded",
  temporarily_unavailable: "The operation is temporarily unavailable",
  unsupported: "The operation is unsupported",
  wrong_key_or_corrupt: "The key is wrong or the data is corrupt",
} as const satisfies Readonly<Record<LenaErrorCode, string>>;

const EMPTY_SAFE_DIAGNOSTIC_DETAILS = safeDiagnosticDetailsSchema.parse({});

export class LenaError extends Error {
  readonly code: LenaErrorCode;
  readonly details: SafeDiagnosticDetails;

  constructor(code: LenaErrorCode, details: Readonly<Record<string, unknown>> = {}) {
    super(SAFE_ERROR_MESSAGES[code]);
    this.name = "LenaError";
    this.code = code;
    this.details = sanitizeDiagnosticDetails(details);
  }

  toJSON(): Readonly<{
    code: LenaErrorCode;
    details: SafeDiagnosticDetails;
    message: string;
    name: "LenaError";
  }> {
    return {
      code: this.code,
      details: this.details,
      message: this.message,
      name: "LenaError",
    };
  }
}

export function sanitizeDiagnosticDetails(
  details: Readonly<Record<string, unknown>>,
): SafeDiagnosticDetails {
  const entries = take(Object.entries(details), MAX_DIAGNOSTIC_KEYS);
  const safeEntries: [string, SafeDiagnosticValue][] = [];
  for (const [key, value] of entries) {
    if (
      typeof value === "string" &&
      SAFE_STRING_DETAIL_KEYS.has(key) &&
      SAFE_DIAGNOSTIC_TOKEN.test(value)
    ) {
      safeEntries.push([key, value]);
      continue;
    }
    if (typeof value === "number" && SAFE_NUMBER_DETAIL_KEYS.has(key) && Number.isFinite(value)) {
      safeEntries.push([key, value]);
      continue;
    }
    if (typeof value === "boolean" && key === "retryable") {
      safeEntries.push([key, value]);
      continue;
    }
    if (value === null && SAFE_NUMBER_DETAIL_KEYS.has(key)) {
      safeEntries.push([key, value]);
    }
  }

  const parsed = safeDiagnosticDetailsSchema.safeParse(Object.fromEntries(safeEntries));
  return parsed.success ? parsed.data : EMPTY_SAFE_DIAGNOSTIC_DETAILS;
}

export function expectRecord(
  value: unknown,
  boundary: string,
): Result<Record<string, unknown>, LenaError> {
  const parsed = unknownRecordSchema.safeParse(value);
  if (!parsed.success) {
    return err(new LenaError("invalid_input", { boundary }));
  }

  return ok(parsed.data);
}

export const unknownRecordSchema = z.custom<Record<string, unknown>>(
  (value) => typeof value === "object" && value !== null && !Array.isArray(value),
);
