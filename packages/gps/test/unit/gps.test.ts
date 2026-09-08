import { describe, expect, test } from 'bun:test'
import { ok } from '@lena-inc/core'
import { reverse as reverseArray } from 'es-toolkit/compat'
import { assert, integer, property } from 'fast-check'

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
	countryResolutionSchema,
	reduceGpsTransition,
	reduceGpsTransitionEvents,
	resolveCountry,
	type CountryResolution,
	type EphemeralCoordinateSample,
	type EphemeralCountryBoundaryDataset,
	type GpsTransitionPolicy,
	type PersistableCountryObservation
} from '../../src/index'

const BASE_TIME = '2026-09-01T08:00:00.000Z'
const OBSERVATION_1 = '11111111-1111-4111-8111-111111111111'
const OBSERVATION_2 = '22222222-2222-4222-8222-222222222222'
const OBSERVATION_3 = '33333333-3333-4333-8333-333333333333'
const OBSERVATION_4 = '44444444-4444-4444-8444-444444444444'
const OBSERVATION_AUTH = '55555555-5555-4555-8555-555555555555'
const OBSERVATION_COPY = '66666666-6666-4666-8666-666666666666'
const OBSERVATION_STALE = '77777777-7777-4777-8777-777777777777'
const MANUAL_CORRECTION = '88888888-8888-4888-8888-888888888888'

function square(
	minimum: number,
	maximum: number
): readonly Readonly<{ latitude: number; longitude: number }>[] {
	return [
		{ latitude: minimum, longitude: minimum },
		{ latitude: minimum, longitude: maximum },
		{ latitude: maximum, longitude: maximum },
		{ latitude: maximum, longitude: minimum }
	]
}

function dataset(input: unknown): EphemeralCountryBoundaryDataset {
	const parsed = parseEphemeralCountryBoundaryDataset(input)
	if (parsed.isErr()) throw parsed.error
	return parsed.value
}

function sample(
	latitude: number,
	longitude: number,
	accuracy = 10,
	observedAt = BASE_TIME
): EphemeralCoordinateSample {
	const parsed = parseEphemeralCoordinateSample({
		horizontalAccuracyMeters: accuracy,
		latitude,
		longitude,
		observedAt
	})
	if (parsed.isErr()) throw parsed.error
	return parsed.value
}

const BASIC_DATASET = dataset({
	countries: [
		{
			countryCode: 'AA',
			polygons: [{ holes: [square(4, 6)], outer: square(0, 10) }],
			priority: 0
		}
	],
	version: 'synthetic-v1'
})

function resolution(
	inputSample: EphemeralCoordinateSample,
	countryCode = 'BB'
): CountryResolution {
	const synthetic = dataset({
		countries: [
			{
				countryCode,
				polygons: [{ outer: square(0, 10) }]
			}
		],
		version: 'synthetic-v1'
	})
	const result = resolveCountry(inputSample, synthetic)
	if (result === null) throw new Error('Expected synthetic resolution')
	return result
}

function observation(
	countryCode: string,
	observationId: string,
	observedAt: string,
	confidence: 'high' | 'low' = 'high'
): PersistableCountryObservation {
	const parsed = parsePersistableCountryObservation({
		accuracyClass: confidence === 'high' ? 'precise' : 'coarse',
		boundaryDatasetVersion: 'synthetic-v1',
		confidence,
		countryCode,
		detectorVersion: 'resolver-v1',
		kind: 'country_observation',
		observationId,
		observedAt,
		schemaVersion: 1
	})
	if (parsed.isErr()) throw parsed.error
	return parsed.value
}

function transitionPolicy(): GpsTransitionPolicy {
	const parsed = parseGpsTransitionPolicy({
		acceptLowConfidence: false,
		minimumDwellMilliseconds: 60_000,
		minimumObservations: 3,
		version: 'transition-v1'
	})
	if (parsed.isErr()) throw parsed.error
	return parsed.value
}

describe('ephemeral country resolution', () => {
	test('measures branded samples symmetrically across generated positions', () => {
		assert(
			property(
				integer({ min: -900_000, max: 900_000 }),
				integer({ min: -1_800_000, max: 1_800_000 }),
				integer({ min: -900_000, max: 900_000 }),
				integer({ min: -1_800_000, max: 1_800_000 }),
				(fromLatitude, fromLongitude, toLatitude, toLongitude) => {
					const from = sample(fromLatitude / 10_000, fromLongitude / 10_000)
					const to = sample(toLatitude / 10_000, toLongitude / 10_000)
					const forward = measureEphemeralDistanceMeters(from, to)
					const reverse = measureEphemeralDistanceMeters(to, from)
					return (
						forward !== null &&
						reverse !== null &&
						Number.isFinite(forward) &&
						Math.abs(forward - reverse) < 1e-7
					)
				}
			)
		)
	})

	test('rejects every generated latitude beyond the supported range', () => {
		assert(
			property(integer({ min: 91, max: 1_000_000 }), (latitude) =>
				parseEphemeralCoordinateSample({
					horizontalAccuracyMeters: 10,
					latitude,
					longitude: 0,
					observedAt: BASE_TIME
				}).isErr()
			)
		)
	})

	test('includes outer boundaries and excludes polygon holes', () => {
		expect(
			String(resolveCountry(sample(0, 5), BASIC_DATASET)?.countryCode)
		).toBe('AA')
		expect(resolveCountry(sample(5, 5), BASIC_DATASET)).toBeNull()
	})

	test('resolves antimeridian polygons on both sides', () => {
		const antimeridian = dataset({
			countries: [
				{
					countryCode: 'AM',
					polygons: [
						{
							outer: [
								{ latitude: -10, longitude: 170 },
								{ latitude: -10, longitude: -170 },
								{ latitude: 10, longitude: -170 },
								{ latitude: 10, longitude: 170 }
							]
						}
					]
				}
			],
			version: 'antimeridian-v1'
		})
		expect(
			String(resolveCountry(sample(0, 179), antimeridian)?.countryCode)
		).toBe('AM')
		expect(
			String(resolveCountry(sample(0, -179), antimeridian)?.countryCode)
		).toBe('AM')
	})

	test('selects overlaps by audited priority and reports no-country', () => {
		const overlapping = dataset({
			countries: [
				{
					countryCode: 'AA',
					polygons: [{ outer: square(0, 10) }],
					priority: 1
				},
				{
					countryCode: 'BB',
					polygons: [{ outer: square(0, 10) }],
					priority: 2
				}
			],
			version: 'overlap-v1'
		})
		expect(resolveCountry(sample(5, 5), overlapping)).toMatchObject({
			countryCode: 'BB',
			match: 'overlap',
			matchedCountryCount: 2
		})
		expect(resolveCountry(sample(-20, -20), overlapping)).toBeNull()
	})

	test('accepts schema-valid samples and rejects datasets without a built index', () => {
		const genuineSample = sample(2, 2)
		expect(
			String(resolveCountry({ ...genuineSample }, BASIC_DATASET)?.countryCode)
		).toBe('AA')
		expect(resolveCountry(genuineSample, { ...BASIC_DATASET })).toBeNull()
	})
})

describe('coordinate-free observations', () => {
	test('classifies accuracy and persists only the minimized shape', () => {
		const accuracyPolicy = parseGpsAccuracyPolicy({
			preciseMaximumMeters: 50,
			usableMaximumMeters: 500
		})
		if (accuracyPolicy.isErr()) throw accuracyPolicy.error
		const inputSample = sample(2, 2, 25)
		const created = createPersistableCountryObservation({
			accuracyPolicy: accuracyPolicy.value,
			detectorVersion: 'resolver-v1',
			observationId: OBSERVATION_1,
			resolution: resolution(inputSample),
			sample: inputSample
		})
		if (created.isErr() || created.value === null)
			throw new Error('Expected value')

		expect({
			...created.value,
			boundaryDatasetVersion: String(created.value.boundaryDatasetVersion),
			countryCode: String(created.value.countryCode),
			detectorVersion: String(created.value.detectorVersion),
			observationId: String(created.value.observationId),
			observedAt: String(created.value.observedAt)
		}).toEqual({
			accuracyClass: 'precise',
			boundaryDatasetVersion: 'synthetic-v1',
			confidence: 'high',
			countryCode: 'BB',
			detectorVersion: 'resolver-v1',
			kind: 'country_observation',
			observationId: OBSERVATION_1,
			observedAt: BASE_TIME,
			schemaVersion: 1
		})
	})

	test('drops unusable accuracy and rejects extra persisted fields', () => {
		const accuracyPolicy = parseGpsAccuracyPolicy({
			preciseMaximumMeters: 50,
			usableMaximumMeters: 500
		})
		if (accuracyPolicy.isErr()) throw accuracyPolicy.error
		const inputSample = sample(2, 2, 501)
		const created = createPersistableCountryObservation({
			accuracyPolicy: accuracyPolicy.value,
			detectorVersion: 'resolver-v1',
			observationId: OBSERVATION_2,
			resolution: resolution(inputSample),
			sample: inputSample
		})
		expect(created).toEqual(ok(null))

		const valid = observation('BB', OBSERVATION_3, BASE_TIME)
		expect(
			parsePersistableCountryObservation({ ...valid, latitude: 1 }).isOk()
		).toBe(false)
		expect(
			parsePersistableCountryObservation({
				...valid,
				accuracyClass: 'coarse',
				confidence: 'high'
			}).isOk()
		).toBe(false)
	})

	test('rejects forged, serialized, and sample-swapped country resolutions', () => {
		const accuracyPolicy = parseGpsAccuracyPolicy({
			preciseMaximumMeters: 50,
			usableMaximumMeters: 500
		})
		if (accuracyPolicy.isErr()) throw accuracyPolicy.error
		const originalSample = sample(2, 2, 25)
		const genuine = resolveCountry(originalSample, BASIC_DATASET)
		if (genuine === null) throw new Error('Expected resolution')
		const base = {
			accuracyPolicy: accuracyPolicy.value,
			detectorVersion: 'resolver-v1',
			observationId: OBSERVATION_AUTH,
			sample: originalSample
		}

		expect(
			createPersistableCountryObservation({
				...base,
				resolution: { ...genuine }
			}).isOk()
		).toBe(false)
		expect(
			createPersistableCountryObservation({
				...base,
				resolution: countryResolutionSchema.parse(
					JSON.parse(JSON.stringify(genuine))
				)
			}).isOk()
		).toBe(false)
		expect(
			createPersistableCountryObservation({
				...base,
				resolution: genuine,
				sample: sample(2, 2, 25)
			}).isOk()
		).toBe(false)
	})
})

describe('review-first transition reducer', () => {
	test('emits one idempotent proposal only after count and dwell', () => {
		const initial = createGpsTransitionState('AA')
		if (initial.isErr()) throw initial.error
		const events = [
			observation('BB', OBSERVATION_1, '2026-09-01T08:00:00.000Z'),
			observation('BB', OBSERVATION_2, '2026-09-01T08:00:30.000Z'),
			observation('BB', OBSERVATION_3, '2026-09-01T08:01:00.000Z'),
			observation('BB', OBSERVATION_3, '2026-09-01T08:01:00.000Z'),
			observation('BB', OBSERVATION_4, '2026-09-01T08:02:00.000Z')
		].map((value) => ({ observation: value, type: 'observation' as const }))

		const reduction = reduceGpsTransitionEvents(
			initial.value,
			events,
			transitionPolicy()
		)
		expect(reduction.effects).toHaveLength(1)
		expect(reduction.effects[0]).toMatchObject({
			fromCountry: 'AA',
			kind: 'country_transition_proposed',
			supportingObservationCount: 3,
			toCountry: 'BB'
		})
		expect(String(reduction.state.currentCountry)).toBe('AA')
	})

	test('sorts replay deterministically and ignores stale input', () => {
		const initial = createGpsTransitionState('AA')
		if (initial.isErr()) throw initial.error
		const events = [
			observation('BB', OBSERVATION_1, '2026-09-01T08:00:00.000Z'),
			observation('BB', OBSERVATION_2, '2026-09-01T08:00:30.000Z'),
			observation('BB', OBSERVATION_3, '2026-09-01T08:01:00.000Z')
		].map((value) => ({ observation: value, type: 'observation' as const }))
		const forward = reduceGpsTransitionEvents(
			initial.value,
			events,
			transitionPolicy()
		)
		const reversed = reduceGpsTransitionEvents(
			initial.value,
			reverseArray([...events]),
			transitionPolicy()
		)
		expect(forward).toEqual(reversed)
	})

	test('clears a bouncing candidate and ignores low confidence', () => {
		const initial = createGpsTransitionState('AA')
		if (initial.isErr()) throw initial.error
		const first = reduceGpsTransition(
			initial.value,
			{
				observation: observation(
					'BB',
					OBSERVATION_1,
					'2026-09-01T08:00:00.000Z'
				),
				type: 'observation'
			},
			transitionPolicy()
		)
		const bounced = reduceGpsTransition(
			first.state,
			{
				observation: observation(
					'AA',
					OBSERVATION_2,
					'2026-09-01T08:00:30.000Z'
				),
				type: 'observation'
			},
			transitionPolicy()
		)
		expect(bounced.state.candidate).toBeNull()

		const low = reduceGpsTransition(
			bounced.state,
			{
				observation: observation(
					'BB',
					OBSERVATION_3,
					'2026-09-01T08:01:00.000Z',
					'low'
				),
				type: 'observation'
			},
			transitionPolicy()
		)
		expect(low.state.candidate).toBeNull()
	})

	test('accepts a strict coordinate-free observation after structural copying', () => {
		const initial = createGpsTransitionState('AA')
		if (initial.isErr()) throw initial.error
		const genuine = observation('BB', OBSERVATION_COPY, BASE_TIME)
		const forged = { ...genuine }
		const reduced = reduceGpsTransition(
			initial.value,
			{ observation: forged, type: 'observation' },
			transitionPolicy()
		)
		expect(String(reduced.state.candidate?.countryCode)).toBe('BB')
		expect(reduced.effects).toEqual([])
	})

	test('manual correction wins and never creates canonical automatic data', () => {
		const initial = createGpsTransitionState('AA')
		if (initial.isErr()) throw initial.error
		const candidate = reduceGpsTransition(
			initial.value,
			{
				observation: observation(
					'BB',
					OBSERVATION_1,
					'2026-09-01T08:00:00.000Z'
				),
				type: 'observation'
			},
			transitionPolicy()
		)
		const correction = createGpsManualCorrection({
			correctedAt: '2026-09-01T08:00:30.000Z',
			correctionId: MANUAL_CORRECTION,
			countryCode: 'BB'
		})
		if (correction.isErr()) throw correction.error
		const corrected = reduceGpsTransition(
			candidate.state,
			{ correction: correction.value, type: 'manual_correction' },
			transitionPolicy()
		)
		expect(corrected.state).toMatchObject({
			candidate: null,
			currentCountry: 'BB',
			currentCountrySource: 'manual'
		})

		const stale = reduceGpsTransition(
			corrected.state,
			{
				observation: observation(
					'AA',
					OBSERVATION_STALE,
					'2026-09-01T08:00:15.000Z'
				),
				type: 'observation'
			},
			transitionPolicy()
		)
		expect(stale).toEqual({ effects: [], state: corrected.state })
	})
})

test('the durable observation source declares no raw coordinate fields', async () => {
	const source = await Bun.file(
		`${import.meta.dir}/../../src/persistable-observation.ts`
	).text()
	expect(source).not.toMatch(/latitude|longitude|coordinates/i)
})
