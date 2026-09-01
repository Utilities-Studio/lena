import { compareAsc, isValid, parseISO } from "date-fns";
import { z } from "zod";
import { LenaError } from "./errors";
import { err, ok, type Result } from "./result";

const ISO_UTC_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

export const isoTimestampSchema = z
  .string()
  .regex(ISO_UTC_PATTERN)
  .refine((value) => {
    const parsed = parseISO(value);
    return isValid(parsed) && parsed.toISOString() === value;
  })
  .brand<"IsoTimestamp">();

export type IsoTimestamp = z.infer<typeof isoTimestampSchema>;

export function parseIsoTimestamp(value: unknown): Result<IsoTimestamp, LenaError> {
  const parsed = isoTimestampSchema.safeParse(value);
  if (!parsed.success) {
    return err(new LenaError("invalid_timestamp", "Timestamp must be canonical UTC"));
  }

  return ok(parsed.data);
}

export function compareIsoTimestamps(left: IsoTimestamp, right: IsoTimestamp): -1 | 0 | 1 {
  const comparison = compareAsc(parseISO(left), parseISO(right));
  return comparison < 0 ? -1 : comparison > 0 ? 1 : 0;
}
