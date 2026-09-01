import { err, LenaError, ok, parseIsoTimestamp, type IsoTimestamp, type Result } from "@lena/core";
import { z } from "zod";

import {
  countryCodeSchema,
  gpsDetectorVersionSchema,
  gpsObservationIdSchema,
  type CountryCode,
  type GpsDetectorVersion,
  type GpsObservationId,
} from "./identifiers";

const persistableObservationBrand: unique symbol = Symbol("PersistableCountryObservation");
const persistableObservations = new WeakSet<object>();

export interface PersistableCountryObservation {
  readonly [persistableObservationBrand]: true;
  readonly accuracyClass: "coarse" | "precise";
  readonly boundaryDatasetVersion: GpsDetectorVersion;
  readonly confidence: "high" | "low";
  readonly countryCode: CountryCode;
  readonly detectorVersion: GpsDetectorVersion;
  readonly kind: "country_observation";
  readonly observationId: GpsObservationId;
  readonly observedAt: IsoTimestamp;
  readonly schemaVersion: 1;
}

const observationEnvelopeSchema = z
  .object({
    kind: z.literal("country_observation"),
    schemaVersion: z.literal(1),
  })
  .passthrough();

export const persistableCountryObservationSchema = z
  .strictObject({
    accuracyClass: z.enum(["coarse", "precise"]),
    boundaryDatasetVersion: gpsDetectorVersionSchema,
    confidence: z.enum(["high", "low"]),
    countryCode: countryCodeSchema,
    detectorVersion: gpsDetectorVersionSchema,
    kind: z.literal("country_observation"),
    observationId: gpsObservationIdSchema,
    observedAt: z.string(),
    schemaVersion: z.literal(1),
  })
  .refine(({ accuracyClass, confidence }) => accuracyClass === "precise" || confidence === "low", {
    path: ["confidence"],
  });

export function isPersistableCountryObservation(
  input: unknown,
): input is PersistableCountryObservation {
  return typeof input === "object" && input !== null && persistableObservations.has(input);
}

export function parsePersistableCountryObservation(
  input: unknown,
): Result<PersistableCountryObservation, LenaError> {
  if (typeof input !== "object" || input === null) {
    return err(
      new LenaError("invalid_input", "GPS observation shape is invalid", {
        boundary: "gps_persistable_observation",
      }),
    );
  }

  if (!observationEnvelopeSchema.safeParse(input).success) {
    return err(
      new LenaError("incompatible_schema", "GPS observation version is invalid", {
        boundary: "gps_persistable_observation",
      }),
    );
  }

  const parsed = persistableCountryObservationSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new LenaError("invalid_input", "GPS observation shape is invalid", {
        boundary: "gps_persistable_observation",
      }),
    );
  }

  const observedAt = parseIsoTimestamp(parsed.data.observedAt);
  if (observedAt.isErr()) {
    return err(observedAt.error);
  }

  const observation = {
    ...parsed.data,
    observedAt: observedAt.value,
  } as Record<PropertyKey, unknown>;
  Object.defineProperty(observation, persistableObservationBrand, {
    configurable: false,
    enumerable: false,
    value: true,
    writable: false,
  });
  const verifiedObservation = Object.freeze(
    observation,
  ) as unknown as PersistableCountryObservation;
  persistableObservations.add(verifiedObservation);
  return ok(verifiedObservation);
}
