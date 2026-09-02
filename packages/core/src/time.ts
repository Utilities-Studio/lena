import { compareAsc, parseISO } from "date-fns";
import { z } from "zod";
import { LenaError } from "./errors";
import { err, ok, type Result } from "./result";

export const isoTimestampSchema = z.iso
  .datetime({ offset: false, precision: 3 })
  .brand<"IsoTimestamp">();

export type IsoTimestamp = z.infer<typeof isoTimestampSchema>;

export function parseIsoTimestamp(value: unknown): Result<IsoTimestamp, LenaError> {
  const parsed = isoTimestampSchema.safeParse(value);
  if (!parsed.success) {
    return err(new LenaError("invalid_timestamp"));
  }

  return ok(parsed.data);
}

export function compareIsoTimestamps(left: IsoTimestamp, right: IsoTimestamp): -1 | 0 | 1 {
  const comparison = compareAsc(parseISO(left), parseISO(right));
  return comparison < 0 ? -1 : comparison > 0 ? 1 : 0;
}
