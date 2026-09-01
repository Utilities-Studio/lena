import { describe, expect, test } from "bun:test";
import {
  createSchemaCompatibilityRange,
  err,
  isSchemaCompatible,
  LenaError,
  ok,
  parseGenerationId,
  parseIsoTimestamp,
  parseSchemaVersion,
  parseVaultId,
  parseVaultInstanceId,
  sanitizeDiagnosticDetails,
} from "../../src/index";

const UUID = "018f3f5a-1d2c-7abc-8def-0123456789ab";

describe("identifiers", () => {
  test("parses and normalizes a UUID-shaped vault id", () => {
    const parsed = parseVaultId(UUID.toUpperCase());
    expect(parsed).toEqual(ok(UUID));
  });

  test("keeps identifier kinds as separate parsers", () => {
    expect(parseVaultId(UUID).isOk()).toBe(true);
    expect(parseGenerationId(UUID).isOk()).toBe(true);
  });

  test("separates a logical vault from its physical instances", () => {
    const vault = parseVaultId("018f3f5a-1d2c-7abc-8def-0123456789ab");
    const instance = parseVaultInstanceId("018f3f5a-1d2c-7abc-8def-1123456789ab");
    expect(vault.isOk()).toBe(true);
    expect(instance.isOk()).toBe(true);
  });

  test("rejects non-random-looking identifiers", () => {
    const parsed = parseVaultId("user@example.com");
    expect(parsed.isOk()).toBe(false);
    if (parsed.isErr()) {
      expect(parsed.error.code).toBe("invalid_identifier");
    }
  });
});

describe("timestamps", () => {
  test("accepts canonical UTC", () => {
    expect(parseIsoTimestamp("2026-09-01T08:15:30.000Z").isOk()).toBe(true);
  });

  test("rejects offsets and impossible dates", () => {
    expect(parseIsoTimestamp("2026-09-01T12:15:30+04:00").isOk()).toBe(false);
    expect(parseIsoTimestamp("2026-02-30T00:00:00.000Z").isOk()).toBe(false);
  });
});

describe("schema compatibility", () => {
  test("includes both boundaries", () => {
    const minimum = parseSchemaVersion(2);
    const maximum = parseSchemaVersion(5);
    const current = parseSchemaVersion(5);
    expect(minimum.isOk() && maximum.isOk() && current.isOk()).toBe(true);
    if (minimum.isErr() || maximum.isErr() || current.isErr()) return;

    const range = createSchemaCompatibilityRange(minimum.value, maximum.value);
    expect(range.isOk()).toBe(true);
    if (range.isErr()) return;
    expect(isSchemaCompatible(current.value, range.value)).toBe(true);
  });

  test("rejects zero and reversed ranges", () => {
    expect(parseSchemaVersion(0).isOk()).toBe(false);
    const two = parseSchemaVersion(2);
    const five = parseSchemaVersion(5);
    if (two.isErr() || five.isErr()) return;
    expect(createSchemaCompatibilityRange(five.value, two.value).isOk()).toBe(false);
  });
});

describe("safe errors and results", () => {
  test("allowlists diagnostic keys and token-shaped values", () => {
    const details = sanitizeDiagnosticDetails({
      boundary: "backup_manifest",
      content: "private journal text",
      latitude: 25.2048,
      retryable: true,
      token: "secret-token",
    });
    expect(details).toEqual({ boundary: "backup_manifest", retryable: true });
  });

  test("serializes a code-owned message with no cause, stack, or unsafe input", () => {
    const serialized = new LenaError("not_found", "Sensitive journal text", {
      boundary: "backup_generation",
      token: "provider-secret",
    }).toJSON();
    expect(serialized).toEqual({
      code: "not_found",
      details: { boundary: "backup_generation" },
      message: "The resource was not found",
      name: "LenaError",
    });
    expect(JSON.stringify(serialized)).not.toContain("Sensitive journal text");
    expect(JSON.stringify(serialized)).not.toContain("provider-secret");
    expect("stack" in serialized).toBe(false);
    expect("cause" in serialized).toBe(false);
  });

  test("maps success without changing errors", () => {
    expect(ok(2).map((value) => value * 3)).toEqual(ok(6));
    const error = new LenaError("invalid_input", "Bad value");
    expect(err(error).map(() => 1)).toEqual(err(error));
  });
});
