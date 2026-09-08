import { err, LenaError, ok, type Result } from "@lena/core";
import { z } from "zod";

import { parseGpsDetectorVersion, parseGpsObservationId } from "./identifiers";
import {
  parsePersistableCountryObservation,
  type PersistableCountryObservation,
} from "./persistable-observation";
import {
  isCountryResolutionForSample,
  type CountryResolution,
  type EphemeralCoordinateSample,
} from "./resolver";

export const gpsAccuracyPolicySchema = z
  .strictObject({
    preciseMaximumMeters: z.number().min(0).max(100_000),
    usableMaximumMeters: z.number().min(0).max(100_000),
  })
  .refine(
    ({ preciseMaximumMeters, usableMaximumMeters }) => usableMaximumMeters >= preciseMaximumMeters,
    { path: ["usableMaximumMeters"] },
  )
  .readonly();

export type GpsAccuracyPolicy = z.output<typeof gpsAccuracyPolicySchema>;

export function parseGpsAccuracyPolicy(input: unknown): Result<GpsAccuracyPolicy, LenaError> {
  const parsed = gpsAccuracyPolicySchema.safeParse(input);
  if (!parsed.success) {
    return err(new LenaError("invalid_input", { boundary: "gps_accuracy_policy" }));
  }

  return ok(Object.freeze(parsed.data));
}

export function createPersistableCountryObservation(
  input: Readonly<{
    accuracyPolicy: GpsAccuracyPolicy;
    detectorVersion: unknown;
    observationId: unknown;
    resolution: CountryResolution;
    sample: EphemeralCoordinateSample;
  }>,
): Result<PersistableCountryObservation | null, LenaError> {
  const observationId = parseGpsObservationId(input.observationId);
  if (observationId.isErr()) {
    return err(observationId.error);
  }

  const detectorVersion = parseGpsDetectorVersion(input.detectorVersion);
  if (detectorVersion.isErr()) {
    return err(detectorVersion.error);
  }

  if (!isCountryResolutionForSample(input.resolution, input.sample)) {
    return err(new LenaError("authentication_required", { boundary: "gps_country_observation" }));
  }

  if (input.sample.horizontalAccuracyMeters > input.accuracyPolicy.usableMaximumMeters) {
    return ok(null);
  }

  const accuracyClass =
    input.sample.horizontalAccuracyMeters <= input.accuracyPolicy.preciseMaximumMeters
      ? "precise"
      : "coarse";
  const confidence =
    accuracyClass === "precise" && input.resolution.match === "unambiguous" ? "high" : "low";

  return parsePersistableCountryObservation(
    Object.freeze({
      accuracyClass,
      boundaryDatasetVersion: input.resolution.boundaryDatasetVersion,
      confidence,
      countryCode: input.resolution.countryCode,
      detectorVersion: detectorVersion.value,
      kind: "country_observation" as const,
      observationId: observationId.value,
      observedAt: input.sample.observedAt,
      schemaVersion: 1 as const,
    }),
  );
}
