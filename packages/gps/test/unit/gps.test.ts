import { describe, expect, test } from "bun:test";
import { ok } from "@lena/core";
import { assert, integer, property } from "fast-check";

import {
  createGpsManualCorrection,
  createGpsTransitionState,
  createPersistableCountryObservation,
  measureEphemeralDistanceMeters,
  parseEphemeralCoordinateSample,
  parseEphemeralCountryBoundaryDataset,
  parseGpsAccuracyPolicy,
  parseGpsTransitionPolicy,
  parsePersistableCountryObservation,
  reduceGpsTransition,
  reduceGpsTransitionEvents,
  resolveCountry,
  type CountryResolution,
  type EphemeralCoordinateSample,
  type EphemeralCountryBoundaryDataset,
  type GpsTransitionPolicy,
  type PersistableCountryObservation,
} from "../../src/index";

const BASE_TIME = "2026-09-01T08:00:00.000Z";

function square(
  minimum: number,
  maximum: number,
): readonly Readonly<{ latitude: number; longitude: number }>[] {
  return [
    { latitude: minimum, longitude: minimum },
    { latitude: minimum, longitude: maximum },
    { latitude: maximum, longitude: maximum },
    { latitude: maximum, longitude: minimum },
  ];
}

function dataset(input: unknown): EphemeralCountryBoundaryDataset {
  const parsed = parseEphemeralCountryBoundaryDataset(input);
  if (parsed.isErr()) throw parsed.error;
  return parsed.value;
}

function sample(
  latitude: number,
  longitude: number,
  accuracy = 10,
  observedAt = BASE_TIME,
): EphemeralCoordinateSample {
  const parsed = parseEphemeralCoordinateSample({
    horizontalAccuracyMeters: accuracy,
    latitude,
    longitude,
    observedAt,
  });
  if (parsed.isErr()) throw parsed.error;
  return parsed.value;
}

const BASIC_DATASET = dataset({
  countries: [
    {
      countryCode: "AA",
      polygons: [{ holes: [square(4, 6)], outer: square(0, 10) }],
      priority: 0,
    },
  ],
  version: "synthetic-v1",
});

function resolution(inputSample: EphemeralCoordinateSample, countryCode = "BB"): CountryResolution {
  const synthetic = dataset({
    countries: [
      {
        countryCode,
        polygons: [{ outer: square(0, 10) }],
      },
    ],
    version: "synthetic-v1",
  });
  const result = resolveCountry(inputSample, synthetic);
  if (result === null) throw new Error("Expected synthetic resolution");
  return result;
}

function observation(
  countryCode: string,
  observationId: string,
  observedAt: string,
  confidence: "high" | "low" = "high",
): PersistableCountryObservation {
  const parsed = parsePersistableCountryObservation({
    accuracyClass: confidence === "high" ? "precise" : "coarse",
    boundaryDatasetVersion: "synthetic-v1",
    confidence,
    countryCode,
    detectorVersion: "resolver-v1",
    kind: "country_observation",
    observationId,
    observedAt,
    schemaVersion: 1,
  });
  if (parsed.isErr()) throw parsed.error;
  return parsed.value;
}

function transitionPolicy(): GpsTransitionPolicy {
  const parsed = parseGpsTransitionPolicy({
    acceptLowConfidence: false,
    minimumDwellMilliseconds: 60_000,
    minimumObservations: 3,
    version: "transition-v1",
  });
  if (parsed.isErr()) throw parsed.error;
  return parsed.value;
}

describe("ephemeral country resolution", () => {
  test("measures branded samples symmetrically across generated positions", () => {
    assert(
      property(
        integer({ min: -900_000, max: 900_000 }),
        integer({ min: -1_800_000, max: 1_800_000 }),
        integer({ min: -900_000, max: 900_000 }),
        integer({ min: -1_800_000, max: 1_800_000 }),
        (fromLatitude, fromLongitude, toLatitude, toLongitude) => {
          const from = sample(fromLatitude / 10_000, fromLongitude / 10_000);
          const to = sample(toLatitude / 10_000, toLongitude / 10_000);
          const forward = measureEphemeralDistanceMeters(from, to);
          const reverse = measureEphemeralDistanceMeters(to, from);
          return (
            forward !== null &&
            reverse !== null &&
            Number.isFinite(forward) &&
            Math.abs(forward - reverse) < 1e-7
          );
        },
      ),
    );
  });

  test("rejects every generated latitude beyond the supported range", () => {
    assert(
      property(integer({ min: 91, max: 1_000_000 }), (latitude) =>
        parseEphemeralCoordinateSample({
          horizontalAccuracyMeters: 10,
          latitude,
          longitude: 0,
          observedAt: BASE_TIME,
        }).isErr(),
      ),
    );
  });

  test("includes outer boundaries and excludes polygon holes", () => {
    expect(resolveCountry(sample(0, 5), BASIC_DATASET)?.countryCode).toBe("AA");
    expect(resolveCountry(sample(5, 5), BASIC_DATASET)).toBeNull();
  });

  test("resolves antimeridian polygons on both sides", () => {
    const antimeridian = dataset({
      countries: [
        {
          countryCode: "AM",
          polygons: [
            {
              outer: [
                { latitude: -10, longitude: 170 },
                { latitude: -10, longitude: -170 },
                { latitude: 10, longitude: -170 },
                { latitude: 10, longitude: 170 },
              ],
            },
          ],
        },
      ],
      version: "antimeridian-v1",
    });
    expect(resolveCountry(sample(0, 179), antimeridian)?.countryCode).toBe("AM");
    expect(resolveCountry(sample(0, -179), antimeridian)?.countryCode).toBe("AM");
  });

  test("selects overlaps by audited priority and reports no-country", () => {
    const overlapping = dataset({
      countries: [
        {
          countryCode: "AA",
          polygons: [{ outer: square(0, 10) }],
          priority: 1,
        },
        {
          countryCode: "BB",
          polygons: [{ outer: square(0, 10) }],
          priority: 2,
        },
      ],
      version: "overlap-v1",
    });
    expect(resolveCountry(sample(5, 5), overlapping)).toMatchObject({
      countryCode: "BB",
      match: "overlap",
      matchedCountryCount: 2,
    });
    expect(resolveCountry(sample(-20, -20), overlapping)).toBeNull();
  });

  test("rejects structurally forged samples and boundary datasets", () => {
    const genuineSample = sample(2, 2);
    expect(
      resolveCountry({ ...genuineSample } as EphemeralCoordinateSample, BASIC_DATASET),
    ).toBeNull();
    expect(
      resolveCountry(genuineSample, { ...BASIC_DATASET } as EphemeralCountryBoundaryDataset),
    ).toBeNull();
  });
});

describe("coordinate-free observations", () => {
  test("classifies accuracy and persists only the minimized shape", () => {
    const accuracyPolicy = parseGpsAccuracyPolicy({
      preciseMaximumMeters: 50,
      usableMaximumMeters: 500,
    });
    if (accuracyPolicy.isErr()) throw accuracyPolicy.error;
    const inputSample = sample(2, 2, 25);
    const created = createPersistableCountryObservation({
      accuracyPolicy: accuracyPolicy.value,
      detectorVersion: "resolver-v1",
      observationId: "observation-1",
      resolution: resolution(inputSample),
      sample: inputSample,
    });
    if (created.isErr() || created.value === null) throw new Error("Expected value");

    expect(created.value).toEqual({
      accuracyClass: "precise",
      boundaryDatasetVersion: "synthetic-v1",
      confidence: "high",
      countryCode: "BB",
      detectorVersion: "resolver-v1",
      kind: "country_observation",
      observationId: "observation-1",
      observedAt: BASE_TIME,
      schemaVersion: 1,
    });
  });

  test("drops unusable accuracy and rejects extra persisted fields", () => {
    const accuracyPolicy = parseGpsAccuracyPolicy({
      preciseMaximumMeters: 50,
      usableMaximumMeters: 500,
    });
    if (accuracyPolicy.isErr()) throw accuracyPolicy.error;
    const inputSample = sample(2, 2, 501);
    const created = createPersistableCountryObservation({
      accuracyPolicy: accuracyPolicy.value,
      detectorVersion: "resolver-v1",
      observationId: "observation-2",
      resolution: resolution(inputSample),
      sample: inputSample,
    });
    expect(created).toEqual(ok(null));

    const valid = observation("BB", "observation-3", BASE_TIME);
    expect(parsePersistableCountryObservation({ ...valid, latitude: 1 }).isOk()).toBe(false);
    expect(
      parsePersistableCountryObservation({
        ...valid,
        accuracyClass: "coarse",
        confidence: "high",
      }).isOk(),
    ).toBe(false);
  });

  test("rejects forged, serialized, and sample-swapped country resolutions", () => {
    const accuracyPolicy = parseGpsAccuracyPolicy({
      preciseMaximumMeters: 50,
      usableMaximumMeters: 500,
    });
    if (accuracyPolicy.isErr()) throw accuracyPolicy.error;
    const originalSample = sample(2, 2, 25);
    const genuine = resolveCountry(originalSample, BASIC_DATASET);
    if (genuine === null) throw new Error("Expected resolution");
    const base = {
      accuracyPolicy: accuracyPolicy.value,
      detectorVersion: "resolver-v1",
      observationId: "observation-auth",
      sample: originalSample,
    };

    expect(
      createPersistableCountryObservation({
        ...base,
        resolution: { ...genuine } as CountryResolution,
      }).isOk(),
    ).toBe(false);
    expect(
      createPersistableCountryObservation({
        ...base,
        resolution: JSON.parse(JSON.stringify(genuine)) as CountryResolution,
      }).isOk(),
    ).toBe(false);
    expect(
      createPersistableCountryObservation({
        ...base,
        resolution: genuine,
        sample: sample(2, 2, 25),
      }).isOk(),
    ).toBe(false);
  });
});

describe("review-first transition reducer", () => {
  test("emits one idempotent proposal only after count and dwell", () => {
    const initial = createGpsTransitionState("AA");
    if (initial.isErr()) throw initial.error;
    const events = [
      observation("BB", "observation-1", "2026-09-01T08:00:00.000Z"),
      observation("BB", "observation-2", "2026-09-01T08:00:30.000Z"),
      observation("BB", "observation-3", "2026-09-01T08:01:00.000Z"),
      observation("BB", "observation-3", "2026-09-01T08:01:00.000Z"),
      observation("BB", "observation-4", "2026-09-01T08:02:00.000Z"),
    ].map((value) => ({ observation: value, type: "observation" as const }));

    const reduction = reduceGpsTransitionEvents(initial.value, events, transitionPolicy());
    expect(reduction.effects).toHaveLength(1);
    expect(reduction.effects[0]).toMatchObject({
      fromCountry: "AA",
      kind: "country_transition_proposed",
      supportingObservationCount: 3,
      toCountry: "BB",
    });
    expect(reduction.state.currentCountry).toBe("AA");
  });

  test("sorts replay deterministically and ignores stale input", () => {
    const initial = createGpsTransitionState("AA");
    if (initial.isErr()) throw initial.error;
    const events = [
      observation("BB", "observation-1", "2026-09-01T08:00:00.000Z"),
      observation("BB", "observation-2", "2026-09-01T08:00:30.000Z"),
      observation("BB", "observation-3", "2026-09-01T08:01:00.000Z"),
    ].map((value) => ({ observation: value, type: "observation" as const }));
    const forward = reduceGpsTransitionEvents(initial.value, events, transitionPolicy());
    const reverse = reduceGpsTransitionEvents(
      initial.value,
      events.toReversed(),
      transitionPolicy(),
    );
    expect(forward).toEqual(reverse);
  });

  test("clears a bouncing candidate and ignores low confidence", () => {
    const initial = createGpsTransitionState("AA");
    if (initial.isErr()) throw initial.error;
    const first = reduceGpsTransition(
      initial.value,
      {
        observation: observation("BB", "observation-1", "2026-09-01T08:00:00.000Z"),
        type: "observation",
      },
      transitionPolicy(),
    );
    const bounced = reduceGpsTransition(
      first.state,
      {
        observation: observation("AA", "observation-2", "2026-09-01T08:00:30.000Z"),
        type: "observation",
      },
      transitionPolicy(),
    );
    expect(bounced.state.candidate).toBeNull();

    const low = reduceGpsTransition(
      bounced.state,
      {
        observation: observation("BB", "observation-3", "2026-09-01T08:01:00.000Z", "low"),
        type: "observation",
      },
      transitionPolicy(),
    );
    expect(low.state.candidate).toBeNull();
  });

  test("ignores a structurally forged persisted observation", () => {
    const initial = createGpsTransitionState("AA");
    if (initial.isErr()) throw initial.error;
    const genuine = observation("BB", "observation-forged", BASE_TIME);
    const forged = { ...genuine } as PersistableCountryObservation;
    const reduced = reduceGpsTransition(
      initial.value,
      { observation: forged, type: "observation" },
      transitionPolicy(),
    );
    expect(reduced.state).toBe(initial.value);
    expect(reduced.effects).toEqual([]);
  });

  test("manual correction wins and never creates canonical automatic data", () => {
    const initial = createGpsTransitionState("AA");
    if (initial.isErr()) throw initial.error;
    const candidate = reduceGpsTransition(
      initial.value,
      {
        observation: observation("BB", "observation-1", "2026-09-01T08:00:00.000Z"),
        type: "observation",
      },
      transitionPolicy(),
    );
    const correction = createGpsManualCorrection({
      correctedAt: "2026-09-01T08:00:30.000Z",
      correctionId: "manual-1",
      countryCode: "BB",
    });
    if (correction.isErr()) throw correction.error;
    const corrected = reduceGpsTransition(
      candidate.state,
      { correction: correction.value, type: "manual_correction" },
      transitionPolicy(),
    );
    expect(corrected.state).toMatchObject({
      candidate: null,
      currentCountry: "BB",
      currentCountrySource: "manual",
    });

    const stale = reduceGpsTransition(
      corrected.state,
      {
        observation: observation("AA", "observation-stale", "2026-09-01T08:00:15.000Z"),
        type: "observation",
      },
      transitionPolicy(),
    );
    expect(stale).toEqual({ effects: [], state: corrected.state });
  });
});

test("the durable observation source declares no raw coordinate fields", async () => {
  const source = await Bun.file(`${import.meta.dir}/../../src/persistable-observation.ts`).text();
  expect(source).not.toMatch(/latitude|longitude|coordinates/i);
});
