import { describe, expect, test } from "bun:test";
import {
  err,
  LenaError,
  ok,
  parseGenerationId,
  parseIsoTimestamp,
  parseSchemaVersion,
  parseVaultId,
  parseVaultInstanceId,
  sanitizeDiagnosticDetails,
} from "../../src/index";

const UUID = "018f3f5a-1d2c-4abc-8def-0123456789ab";

describe("identifiers", () => {
  test("parses and normalizes a UUID-shaped vault id", () => {
    const parsed = parseVaultId(UUID.toUpperCase());
    if (parsed.isErr()) throw parsed.error;
    expect(String(parsed.value)).toBe(UUID);
  });

  test("keeps identifier kinds as separate parsers", () => {
    expect(parseVaultId(UUID).isOk()).toBe(true);
    expect(parseGenerationId(UUID).isOk()).toBe(true);
  });

  test("separates a logical vault from its physical instances", () => {
    const vault = parseVaultId("018f3f5a-1d2c-4abc-8def-0123456789ab");
    const instance = parseVaultInstanceId("018f3f5a-1d2c-4abc-8def-1123456789ab");
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

  test("rejects UUID versions not produced by Expo Crypto randomUUID", () => {
    expect(parseVaultId("018f3f5a-1d2c-7abc-8def-0123456789ab").isErr()).toBe(true);
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
  test("accepts only positive safe integer schema versions", () => {
    expect(parseSchemaVersion(1).isOk()).toBe(true);
    expect(parseSchemaVersion(0).isOk()).toBe(false);
    expect(parseSchemaVersion(1.5).isOk()).toBe(false);
    expect(parseSchemaVersion(Number.MAX_SAFE_INTEGER + 1).isOk()).toBe(false);
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
    const serialized = new LenaError("not_found", {
      boundary: "backup_generation",
      token: "provider-secret",
    }).toJSON();
    expect(serialized).toEqual({
      code: "not_found",
      details: { boundary: "backup_generation" },
      message: "The resource was not found",
      name: "LenaError",
    });
    expect(JSON.stringify(serialized)).not.toContain("provider-secret");
    expect("stack" in serialized).toBe(false);
    expect("cause" in serialized).toBe(false);
  });

  test("maps success without changing errors", () => {
    expect(ok(2).map((value) => value * 3)).toEqual(ok(6));
    const error = new LenaError("invalid_input");
    expect(err(error).map(() => 1)).toEqual(err(error));
  });
});
