import { err, LenaError, ok, type Result } from "@lena/core";
import { z } from "zod";

export const countryCodeSchema = z
  .string()
  .regex(/^[A-Za-z]{2}$/)
  .transform((value) => value.toUpperCase())
  .brand<"CountryCode">();

const GpsVersionSchema = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/);

export const gpsDetectorVersionSchema = GpsVersionSchema.brand<"GpsDetectorVersion">();
export const gpsPolicyVersionSchema = GpsVersionSchema.brand<"GpsPolicyVersion">();
export const gpsObservationIdSchema = z
  .string()
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/)
  .brand<"GpsObservationId">();

export type CountryCode = z.output<typeof countryCodeSchema>;
export type GpsDetectorVersion = z.output<typeof gpsDetectorVersionSchema>;
export type GpsObservationId = z.output<typeof gpsObservationIdSchema>;
export type GpsPolicyVersion = z.output<typeof gpsPolicyVersionSchema>;

export function parseCountryCode(value: unknown): Result<CountryCode, LenaError> {
  const parsed = countryCodeSchema.safeParse(value);
  return parsed.success
    ? ok(parsed.data)
    : err(
        new LenaError("invalid_input", "Country code is invalid", {
          boundary: "gps_country",
        }),
      );
}

export function parseGpsDetectorVersion(value: unknown): Result<GpsDetectorVersion, LenaError> {
  const parsed = gpsDetectorVersionSchema.safeParse(value);
  return parsed.success
    ? ok(parsed.data)
    : err(
        new LenaError("invalid_input", "GPS version is invalid", {
          boundary: "gps_detector_version",
        }),
      );
}

export function parseGpsPolicyVersion(value: unknown): Result<GpsPolicyVersion, LenaError> {
  const parsed = gpsPolicyVersionSchema.safeParse(value);
  return parsed.success
    ? ok(parsed.data)
    : err(
        new LenaError("invalid_input", "GPS version is invalid", {
          boundary: "gps_policy_version",
        }),
      );
}

export function parseGpsObservationId(value: unknown): Result<GpsObservationId, LenaError> {
  const parsed = gpsObservationIdSchema.safeParse(value);
  return parsed.success
    ? ok(parsed.data)
    : err(
        new LenaError("invalid_identifier", "GPS observation id is invalid", {
          boundary: "gps_observation",
        }),
      );
}
