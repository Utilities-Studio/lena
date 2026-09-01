import booleanPointInPolygon from "@turf/boolean-point-in-polygon";
import turfDistance from "@turf/distance";
import { point as turfPoint, polygon as turfPolygon } from "@turf/helpers";
import { err, LenaError, ok, parseIsoTimestamp, type IsoTimestamp, type Result } from "@lena/core";
import { orderBy, sumBy, uniqBy } from "es-toolkit";
import { z } from "zod";

import {
  countryCodeSchema,
  gpsDetectorVersionSchema,
  type CountryCode,
  type GpsDetectorVersion,
} from "./identifiers";

const coordinateSampleBrand: unique symbol = Symbol("EphemeralCoordinateSample");
const coordinateSamples = new WeakSet<object>();

export interface EphemeralCoordinateSample {
  readonly [coordinateSampleBrand]: true;
  readonly horizontalAccuracyMeters: number;
  readonly latitude: number;
  readonly longitude: number;
  readonly observedAt: IsoTimestamp;
}

export interface EphemeralBoundaryPoint {
  readonly latitude: number;
  readonly longitude: number;
}

export interface EphemeralCountryPolygon {
  readonly holes: readonly (readonly EphemeralBoundaryPoint[])[];
  readonly outer: readonly EphemeralBoundaryPoint[];
}

export interface EphemeralCountryBoundary {
  readonly countryCode: CountryCode;
  readonly polygons: readonly EphemeralCountryPolygon[];
  readonly priority: number;
}

const countryBoundaryDatasetBrand: unique symbol = Symbol("EphemeralCountryBoundaryDataset");
const countryBoundaryDatasets = new WeakSet<object>();

export interface EphemeralCountryBoundaryDataset {
  readonly [countryBoundaryDatasetBrand]: true;
  readonly countries: readonly EphemeralCountryBoundary[];
  readonly version: GpsDetectorVersion;
}

const countryResolutionBrand: unique symbol = Symbol("CountryResolution");
const countryResolutions = new WeakSet<object>();
const resolutionSamples = new WeakMap<object, EphemeralCoordinateSample>();

export interface CountryResolution {
  readonly [countryResolutionBrand]: true;
  readonly boundaryDatasetVersion: GpsDetectorVersion;
  readonly countryCode: CountryCode;
  readonly match: "overlap" | "unambiguous";
  readonly matchedCountryCount: number;
}

export function isCountryResolutionForSample(
  resolution: unknown,
  sample: EphemeralCoordinateSample,
): resolution is CountryResolution {
  return (
    typeof resolution === "object" &&
    resolution !== null &&
    countryResolutions.has(resolution) &&
    resolutionSamples.get(resolution) === sample
  );
}

const DATASET_LIMITS = Object.freeze({
  countries: 512,
  holesPerPolygon: 1_024,
  pointsPerRing: 250_000,
  polygonsPerCountry: 10_000,
  totalPoints: 2_000_000,
});

const latitudeSchema = z.number().min(-90).max(90);
const longitudeSchema = z.number().min(-180).max(180);
const safePrioritySchema = z.number().refine(Number.isSafeInteger).min(-1_000_000).max(1_000_000);

export const ephemeralCoordinateSampleInputSchema = z.object({
  horizontalAccuracyMeters: z.number().min(0).max(100_000),
  latitude: latitudeSchema,
  longitude: longitudeSchema,
  observedAt: z.string(),
});

export const ephemeralBoundaryPointSchema = z.object({
  latitude: latitudeSchema,
  longitude: longitudeSchema,
});

const boundaryRingSchema = z
  .array(ephemeralBoundaryPointSchema)
  .min(3)
  .max(DATASET_LIMITS.pointsPerRing);

const countryPolygonSchema = z.object({
  holes: z.array(boundaryRingSchema).max(DATASET_LIMITS.holesPerPolygon).optional().default([]),
  outer: boundaryRingSchema,
});

const countryBoundarySchema = z.object({
  countryCode: countryCodeSchema,
  polygons: z.array(countryPolygonSchema).min(1).max(DATASET_LIMITS.polygonsPerCountry),
  priority: safePrioritySchema.optional().default(0),
});

export const ephemeralCountryBoundaryDatasetInputSchema = z.object({
  countries: z.array(countryBoundarySchema).min(1).max(DATASET_LIMITS.countries),
  version: gpsDetectorVersionSchema,
});

export function parseEphemeralCoordinateSample(
  input: unknown,
): Result<EphemeralCoordinateSample, LenaError> {
  const parsed = ephemeralCoordinateSampleInputSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new LenaError("invalid_input", "GPS coordinate sample is invalid", {
        boundary: "gps_coordinate_sample",
      }),
    );
  }

  const observedAt = parseIsoTimestamp(parsed.data.observedAt);
  if (observedAt.isErr()) {
    return err(observedAt.error);
  }

  const sample = {
    ...parsed.data,
    observedAt: observedAt.value,
  } as Record<PropertyKey, unknown>;
  Object.defineProperty(sample, coordinateSampleBrand, {
    configurable: false,
    enumerable: false,
    value: true,
    writable: false,
  });
  const verifiedSample = Object.freeze(sample) as unknown as EphemeralCoordinateSample;
  coordinateSamples.add(verifiedSample);
  return ok(verifiedSample);
}

function isDegenerateRing(ring: readonly EphemeralBoundaryPoint[]): boolean {
  return uniqBy(ring, ({ latitude, longitude }) => `${latitude}:${longitude}`).length < 3;
}

export function parseEphemeralCountryBoundaryDataset(
  input: unknown,
): Result<EphemeralCountryBoundaryDataset, LenaError> {
  const parsed = ephemeralCountryBoundaryDatasetInputSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new LenaError("invalid_input", "GPS boundary dataset is invalid", {
        boundary: "gps_boundary_dataset",
      }),
    );
  }

  if (
    uniqBy(parsed.data.countries, ({ countryCode }) => countryCode).length !==
    parsed.data.countries.length
  ) {
    return err(
      new LenaError("conflict", "GPS country boundary is duplicated", {
        boundary: "gps_boundary_dataset",
      }),
    );
  }

  const containsDegenerateRing = parsed.data.countries.some(({ polygons }) =>
    polygons.some(
      ({ holes, outer }) => isDegenerateRing(outer) || holes.some((hole) => isDegenerateRing(hole)),
    ),
  );
  if (containsDegenerateRing) {
    return err(
      new LenaError("invalid_input", "GPS polygon ring is degenerate", {
        boundary: "gps_boundary_dataset",
      }),
    );
  }

  const pointCount = sumBy(parsed.data.countries, ({ polygons }) =>
    sumBy(polygons, ({ holes, outer }) => outer.length + sumBy(holes, (hole) => hole.length)),
  );
  if (pointCount > DATASET_LIMITS.totalPoints) {
    return err(
      new LenaError("limit_exceeded", "GPS boundary dataset is too large", {
        boundary: "gps_boundary_dataset",
      }),
    );
  }

  const countries = parsed.data.countries.map(({ countryCode, polygons, priority }) =>
    Object.freeze({
      countryCode,
      polygons: Object.freeze(
        polygons.map(({ holes, outer }) =>
          Object.freeze({
            holes: Object.freeze(holes.map((hole) => Object.freeze(hole))),
            outer: Object.freeze(outer),
          }),
        ),
      ),
      priority,
    }),
  );
  const dataset = {
    countries: Object.freeze(countries),
    version: parsed.data.version,
  } as Record<PropertyKey, unknown>;
  Object.defineProperty(dataset, countryBoundaryDatasetBrand, {
    configurable: false,
    enumerable: false,
    value: true,
    writable: false,
  });
  const verifiedDataset = Object.freeze(dataset) as unknown as EphemeralCountryBoundaryDataset;
  countryBoundaryDatasets.add(verifiedDataset);
  return ok(verifiedDataset);
}

function unwrapLongitude(longitude: number, reference: number): number {
  let result = longitude;
  while (result - reference > 180) result -= 360;
  while (result - reference < -180) result += 360;
  return result;
}

function toClosedTurfRing(
  ring: readonly EphemeralBoundaryPoint[],
  referenceLongitude: number,
): [number, number][] {
  const positions: [number, number][] = ring.map(({ latitude, longitude }) => [
    unwrapLongitude(longitude, referenceLongitude),
    latitude,
  ]);
  const first = positions[0];
  return first === undefined ? positions : [...positions, [first[0], first[1]]];
}

function ringContains(
  sample: EphemeralCoordinateSample,
  ring: readonly EphemeralBoundaryPoint[],
): boolean {
  const target = turfPoint([sample.longitude, sample.latitude]);
  const area = turfPolygon([toClosedTurfRing(ring, sample.longitude)]);
  return booleanPointInPolygon(target, area);
}

function polygonContains(
  sample: EphemeralCoordinateSample,
  polygon: EphemeralCountryPolygon,
): boolean {
  return (
    ringContains(sample, polygon.outer) && !polygon.holes.some((hole) => ringContains(sample, hole))
  );
}

export function measureEphemeralDistanceMeters(
  from: EphemeralCoordinateSample,
  to: EphemeralCoordinateSample,
): number | null {
  if (!coordinateSamples.has(from) || !coordinateSamples.has(to)) {
    return null;
  }

  return (
    turfDistance([from.longitude, from.latitude], [to.longitude, to.latitude], {
      units: "kilometers",
    }) * 1_000
  );
}

export function resolveCountry(
  sample: EphemeralCoordinateSample,
  dataset: EphemeralCountryBoundaryDataset,
): CountryResolution | null {
  if (!coordinateSamples.has(sample) || !countryBoundaryDatasets.has(dataset)) {
    return null;
  }

  const matches = orderBy(
    dataset.countries.filter((country) =>
      country.polygons.some((candidate) => polygonContains(sample, candidate)),
    ),
    [({ priority }) => priority, ({ countryCode }) => countryCode],
    ["desc", "asc"],
  );
  const selected = matches[0];
  if (selected === undefined) {
    return null;
  }

  const resolution = {
    boundaryDatasetVersion: dataset.version,
    countryCode: selected.countryCode,
    match: matches.length === 1 ? "unambiguous" : "overlap",
    matchedCountryCount: matches.length,
  } as Record<PropertyKey, unknown>;
  Object.defineProperty(resolution, countryResolutionBrand, {
    configurable: false,
    enumerable: false,
    value: true,
    writable: false,
  });
  const verifiedResolution = Object.freeze(resolution) as unknown as CountryResolution;
  countryResolutions.add(verifiedResolution);
  resolutionSamples.set(verifiedResolution, sample);
  return verifiedResolution;
}
