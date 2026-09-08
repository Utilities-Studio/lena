import { err, LenaError, ok, type Result } from "@lena/core";
import { z } from "zod";

const SHA256_PATTERN = /^sha256:[0-9a-f]{64}$/;

export const sha256ChecksumSchema = z.string().regex(SHA256_PATTERN).brand<"Sha256Checksum">();

export type Sha256Checksum = z.infer<typeof sha256ChecksumSchema>;

export function parseSha256Checksum(value: unknown): Result<Sha256Checksum, LenaError> {
  const parsed = sha256ChecksumSchema.safeParse(value);
  if (!parsed.success) {
    return err(new LenaError("invalid_input"));
  }

  return ok(parsed.data);
}
