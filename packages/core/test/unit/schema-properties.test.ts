import { describe, expect, test } from "bun:test";
import fc from "fast-check";
import {
  compareIsoTimestamps,
  isoTimestampSchema,
  parseIsoTimestamp,
  parseSchemaVersion,
  parseVaultId,
  schemaVersionSchema,
  vaultIdSchema,
} from "../../src/index";

describe("core schema properties", () => {
  test("identifier schemas normalize and round trip UUIDs", () => {
    fc.assert(
      fc.property(fc.uuid({ version: 4 }), (uuid) => {
        const parsed = parseVaultId(uuid.toUpperCase());
        if (parsed.isErr()) throw parsed.error;
        const parsedValue = parsed.value;
        const schemaValue = vaultIdSchema.parse(uuid.toUpperCase());
        expect(schemaValue).toBe(parsedValue);
        expect(String(parsedValue)).toBe(uuid.toLowerCase());
        expect(parseVaultId(JSON.parse(JSON.stringify(parsedValue)))).toEqual(parsed);
      }),
    );
  });

  test("canonical timestamps round trip and retain chronological ordering", () => {
    const dates = fc.date({
      max: new Date("2099-12-31T23:59:59.999Z"),
      min: new Date("2000-01-01T00:00:00.000Z"),
      noInvalidDate: true,
    });

    fc.assert(
      fc.property(dates, dates, (leftDate, rightDate) => {
        const left = parseIsoTimestamp(leftDate.toISOString());
        const right = parseIsoTimestamp(rightDate.toISOString());
        if (left.isErr()) throw left.error;
        if (right.isErr()) throw right.error;
        const leftValue = left.value;
        const rightValue = right.value;
        const expectedOrder =
          leftDate.getTime() === rightDate.getTime()
            ? 0
            : leftDate.getTime() < rightDate.getTime()
              ? -1
              : 1;

        expect(isoTimestampSchema.safeParse(leftValue).success).toBe(true);
        expect(parseIsoTimestamp(JSON.parse(JSON.stringify(leftValue)))).toEqual(left);
        expect(compareIsoTimestamps(leftValue, rightValue)).toBe(expectedOrder);
      }),
    );
  });

  test("schema versions round trip", () => {
    fc.assert(
      fc.property(fc.integer({ max: 1_000_000, min: 1 }), (value) => {
        const parsed = parseSchemaVersion(value);
        if (parsed.isErr()) throw parsed.error;
        const version = parsed.value;
        expect(Number(schemaVersionSchema.parse(JSON.parse(JSON.stringify(version))))).toBe(
          Number(version),
        );
      }),
    );
  });
});
