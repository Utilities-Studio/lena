import { z } from "zod";
import { LenaError } from "./errors";
import { err, ok, type Result } from "./result";

export const schemaVersionSchema = z.int().min(1).brand<"SchemaVersion">();

export type SchemaVersion = z.infer<typeof schemaVersionSchema>;

export const schemaCompatibilityRangeSchema = z
  .strictObject({
    maximum: schemaVersionSchema,
    minimum: schemaVersionSchema,
  })
  .superRefine((range, context) => {
    if (range.minimum > range.maximum) {
      context.addIssue({
        code: "custom",
        message: "minimum_exceeds_maximum",
        path: ["minimum"],
      });
    }
  })
  .readonly();

export type SchemaCompatibilityRange = z.infer<typeof schemaCompatibilityRangeSchema>;

export function parseSchemaVersion(value: unknown): Result<SchemaVersion, LenaError> {
  const parsed = schemaVersionSchema.safeParse(value);
  if (!parsed.success) {
    return err(new LenaError("invalid_input", "Schema version must be a positive safe integer"));
  }

  return ok(parsed.data);
}

export function createSchemaCompatibilityRange(
  minimum: SchemaVersion,
  maximum: SchemaVersion,
): Result<SchemaCompatibilityRange, LenaError> {
  const parsed = schemaCompatibilityRangeSchema.safeParse({ maximum, minimum });
  if (!parsed.success) {
    return err(
      new LenaError("invalid_input", "Minimum schema version exceeds maximum", {
        maximum,
        minimum,
      }),
    );
  }

  return ok(parsed.data);
}

export function isSchemaCompatible(
  version: SchemaVersion,
  range: SchemaCompatibilityRange,
): boolean {
  return version >= range.minimum && version <= range.maximum;
}
