import { describe, expect, test } from "bun:test";
import fc from "fast-check";
import {
  compareIsoTimestamps,
  isoTimestampSchema,
  parseIsoTimestamp,
  parseSchemaVersion,
  parseVaultId,
  schemaCompatibilityRangeSchema,
  schemaVersionSchema,
  vaultIdSchema,
} from "../../src/index";

describe("core schema properties", () => {
  test("identifier schemas normalize and round trip UUIDs", () => {
    fc.assert(
      fc.property(fc.uuid(), (uuid) => {
        const parsed = parseVaultId(uuid.toUpperCase());
        const schemaParsed = vaultIdSchema.safeParse(uuid.toUpperCase());

        expect(parsed.isOk()).toBe(true);
        expect(schemaParsed.success).toBe(true);
        if (parsed.isErr() || !schemaParsed.success) return;
        expect(parsed.value).toBe(uuid.toLowerCase());
        expect(schemaParsed.data).toBe(parsed.value);
        expect(parseVaultId(JSON.parse(JSON.stringify(parsed.value)))).toEqual(parsed);
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
        expect(left.isOk()).toBe(true);
        expect(right.isOk()).toBe(true);
        if (left.isErr() || right.isErr()) return;

        expect(isoTimestampSchema.safeParse(left.value).success).toBe(true);
        expect(parseIsoTimestamp(JSON.parse(JSON.stringify(left.value)))).toEqual(left);
        expect(compareIsoTimestamps(left.value, right.value)).toBe(
          Math.sign(leftDate.getTime() - rightDate.getTime()),
        );
      }),
    );
  });

  test("schema versions and compatibility ranges round trip", () => {
    fc.assert(
      fc.property(
        fc.integer({ max: 1_000_000, min: 1 }),
        fc.integer({ max: 1_000_000, min: 0 }),
        (minimumValue, width) => {
          const maximumValue = Math.min(minimumValue + width, Number.MAX_SAFE_INTEGER);
          const minimum = parseSchemaVersion(minimumValue);
          const maximum = parseSchemaVersion(maximumValue);
          expect(minimum.isOk()).toBe(true);
          expect(maximum.isOk()).toBe(true);
          if (minimum.isErr() || maximum.isErr()) return;

          expect(schemaVersionSchema.safeParse(minimum.value).success).toBe(true);
          const range = schemaCompatibilityRangeSchema.safeParse({
            maximum: maximum.value,
            minimum: minimum.value,
          });
          expect(range.success).toBe(true);
          if (!range.success) return;
          expect(
            schemaCompatibilityRangeSchema.safeParse(JSON.parse(JSON.stringify(range.data)))
              .success,
          ).toBe(true);
        },
      ),
    );
  });
});
