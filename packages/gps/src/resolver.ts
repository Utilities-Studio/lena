import turfBbox from '@turf/bbox'
import booleanPointInPolygon from '@turf/boolean-point-in-polygon'
import turfDistance from '@turf/distance'
import { point as turfPoint, polygon as turfPolygon } from '@turf/helpers'
import {
	err,
	isoTimestampSchema,
	LenaError,
	ok,
	type Result
} from '@lena-inc/core'
import { orderBy, sumBy, uniqBy } from 'es-toolkit'
import Flatbush from 'flatbush'
import { z } from 'zod'

import { countryCodeSchema, gpsDetectorVersionSchema } from './identifiers'

const resolutionSamples = new WeakMap<object, EphemeralCoordinateSample>()
const indexedBoundaryDatasets = new WeakMap<object, BoundarySpatialIndex>()

export function isCountryResolutionForSample(
	resolution: unknown,
	sample: EphemeralCoordinateSample
): resolution is CountryResolution {
	return (
		typeof resolution === 'object' &&
		resolution !== null &&
		resolutionSamples.get(resolution) === sample
	)
}

const DATASET_LIMITS = Object.freeze({
	countries: 512,
	holesPerPolygon: 1_024,
	pointsPerRing: 250_000,
	polygonsPerCountry: 10_000,
	totalPoints: 2_000_000
})

const latitudeSchema = z.number().min(-90).max(90)
const longitudeSchema = z.number().min(-180).max(180)
const safePrioritySchema = z.int().min(-1_000_000).max(1_000_000)

export const ephemeralCoordinateSampleInputSchema = z
	.strictObject({
		horizontalAccuracyMeters: z.number().min(0).max(100_000),
		latitude: latitudeSchema,
		longitude: longitudeSchema,
		observedAt: isoTimestampSchema
	})
	.readonly()

export const ephemeralBoundaryPointSchema = z
	.strictObject({
		latitude: latitudeSchema,
		longitude: longitudeSchema
	})
	.readonly()

const boundaryRingSchema = z
	.array(ephemeralBoundaryPointSchema)
	.min(3)
	.max(DATASET_LIMITS.pointsPerRing)
	.readonly()

const countryPolygonSchema = z
	.strictObject({
		holes: z
			.array(boundaryRingSchema)
			.max(DATASET_LIMITS.holesPerPolygon)
			.readonly()
			.optional()
			.default([]),
		outer: boundaryRingSchema
	})
	.readonly()

const countryBoundarySchema = z
	.strictObject({
		countryCode: countryCodeSchema,
		polygons: z
			.array(countryPolygonSchema)
			.min(1)
			.max(DATASET_LIMITS.polygonsPerCountry)
			.readonly(),
		priority: safePrioritySchema.optional().default(0)
	})
	.readonly()

export const ephemeralCountryBoundaryDatasetInputSchema = z
	.strictObject({
		countries: z
			.array(countryBoundarySchema)
			.min(1)
			.max(DATASET_LIMITS.countries)
			.readonly(),
		version: gpsDetectorVersionSchema
	})
	.readonly()

export type EphemeralCoordinateSample = z.output<
	typeof ephemeralCoordinateSampleInputSchema
>
export type EphemeralBoundaryPoint = z.output<
	typeof ephemeralBoundaryPointSchema
>
export type EphemeralCountryPolygon = z.output<typeof countryPolygonSchema>
export type EphemeralCountryBoundary = z.output<typeof countryBoundarySchema>
export type EphemeralCountryBoundaryDataset = z.output<
	typeof ephemeralCountryBoundaryDatasetInputSchema
>

export const countryResolutionSchema = z
	.strictObject({
		boundaryDatasetVersion: gpsDetectorVersionSchema,
		countryCode: countryCodeSchema,
		match: z.enum(['overlap', 'unambiguous']),
		matchedCountryCount: z.number().int().safe().positive()
	})
	.readonly()

export type CountryResolution = z.output<typeof countryResolutionSchema>

interface IndexedCountryPolygon {
	readonly country: EphemeralCountryBoundary
	readonly geometry: ReturnType<typeof turfPolygon>
	readonly referenceLongitude: number
}

interface BoundarySpatialIndex {
	readonly index: Flatbush
	readonly polygons: readonly IndexedCountryPolygon[]
}

export function parseEphemeralCoordinateSample(
	input: unknown
): Result<EphemeralCoordinateSample, LenaError> {
	const parsed = ephemeralCoordinateSampleInputSchema.safeParse(input)
	if (!parsed.success) {
		return err(
			new LenaError('invalid_input', { boundary: 'gps_coordinate_sample' })
		)
	}

	return ok(parsed.data)
}

function isDegenerateRing(ring: readonly EphemeralBoundaryPoint[]): boolean {
	return (
		uniqBy(ring, ({ latitude, longitude }) => `${latitude}:${longitude}`)
			.length < 3
	)
}

export function parseEphemeralCountryBoundaryDataset(
	input: unknown
): Result<EphemeralCountryBoundaryDataset, LenaError> {
	const parsed = ephemeralCountryBoundaryDatasetInputSchema.safeParse(input)
	if (!parsed.success) {
		return err(
			new LenaError('invalid_input', { boundary: 'gps_boundary_dataset' })
		)
	}

	if (
		uniqBy(parsed.data.countries, ({ countryCode }) => countryCode).length !==
		parsed.data.countries.length
	) {
		return err(new LenaError('conflict', { boundary: 'gps_boundary_dataset' }))
	}

	const containsDegenerateRing = parsed.data.countries.some(({ polygons }) =>
		polygons.some(
			({ holes, outer }) =>
				isDegenerateRing(outer) || holes.some((hole) => isDegenerateRing(hole))
		)
	)
	if (containsDegenerateRing) {
		return err(
			new LenaError('invalid_input', { boundary: 'gps_boundary_dataset' })
		)
	}

	const pointCount = sumBy(parsed.data.countries, ({ polygons }) =>
		sumBy(
			polygons,
			({ holes, outer }) => outer.length + sumBy(holes, (hole) => hole.length)
		)
	)
	if (pointCount > DATASET_LIMITS.totalPoints) {
		return err(
			new LenaError('limit_exceeded', { boundary: 'gps_boundary_dataset' })
		)
	}

	const countries = parsed.data.countries.map(
		({ countryCode, polygons, priority }) =>
			Object.freeze({
				countryCode,
				polygons: Object.freeze(
					polygons.map(({ holes, outer }) =>
						Object.freeze({
							holes: Object.freeze(holes.map((hole) => Object.freeze(hole))),
							outer: Object.freeze(outer)
						})
					)
				),
				priority
			})
	)
	const dataset = Object.freeze({
		countries: Object.freeze(countries),
		version: parsed.data.version
	})
	indexedBoundaryDatasets.set(dataset, buildBoundarySpatialIndex(dataset))
	return ok(dataset)
}

function unwrapLongitude(longitude: number, reference: number): number {
	let result = longitude
	while (result - reference > 180) result -= 360
	while (result - reference < -180) result += 360
	return result
}

function toClosedTurfRing(
	ring: readonly EphemeralBoundaryPoint[],
	referenceLongitude: number
): [number, number][] {
	const positions: [number, number][] = ring.map(({ latitude, longitude }) => [
		unwrapLongitude(longitude, referenceLongitude),
		latitude
	])
	const first = positions[0]
	return first === undefined ? positions : [...positions, [first[0], first[1]]]
}

function buildBoundarySpatialIndex(
	dataset: EphemeralCountryBoundaryDataset
): BoundarySpatialIndex {
	const entries: Array<{
		bounds: readonly [number, number, number, number]
		polygon: IndexedCountryPolygon
	}> = []
	for (const country of dataset.countries) {
		for (const polygon of country.polygons) {
			const referenceLongitude = polygon.outer[0]?.longitude ?? 0
			const geometry = turfPolygon([
				toClosedTurfRing(polygon.outer, referenceLongitude),
				...polygon.holes.map((hole) =>
					toClosedTurfRing(hole, referenceLongitude)
				)
			])
			const indexedPolygon = Object.freeze({
				country,
				geometry,
				referenceLongitude
			})
			const [
				minimumLongitude,
				minimumLatitude,
				maximumLongitude,
				maximumLatitude
			] = turfBbox(geometry)
			const bounds = [
				minimumLongitude,
				minimumLatitude,
				maximumLongitude,
				maximumLatitude
			] as const
			entries.push({ bounds, polygon: indexedPolygon })
			if (bounds[0] < -180) {
				entries.push({
					bounds: [bounds[0] + 360, bounds[1], bounds[2] + 360, bounds[3]],
					polygon: indexedPolygon
				})
			}
			if (bounds[2] > 180) {
				entries.push({
					bounds: [bounds[0] - 360, bounds[1], bounds[2] - 360, bounds[3]],
					polygon: indexedPolygon
				})
			}
		}
	}
	const index = new Flatbush(entries.length)
	for (const { bounds } of entries) {
		index.add(...bounds)
	}
	index.finish()
	return Object.freeze({
		index,
		polygons: Object.freeze(entries.map(({ polygon }) => polygon))
	})
}

export function measureEphemeralDistanceMeters(
	from: EphemeralCoordinateSample,
	to: EphemeralCoordinateSample
): number | null {
	if (
		!ephemeralCoordinateSampleInputSchema.safeParse(from).success ||
		!ephemeralCoordinateSampleInputSchema.safeParse(to).success
	) {
		return null
	}

	return (
		turfDistance([from.longitude, from.latitude], [to.longitude, to.latitude], {
			units: 'kilometers'
		}) * 1_000
	)
}

export function resolveCountry(
	sample: EphemeralCoordinateSample,
	dataset: EphemeralCountryBoundaryDataset
): CountryResolution | null {
	const parsedSample = ephemeralCoordinateSampleInputSchema.safeParse(sample)
	const spatial = indexedBoundaryDatasets.get(dataset)
	if (!parsedSample.success || spatial === undefined) {
		return null
	}

	const candidates = uniqBy(
		spatial.index
			.search(
				parsedSample.data.longitude,
				parsedSample.data.latitude,
				parsedSample.data.longitude,
				parsedSample.data.latitude
			)
			.map((index) => spatial.polygons[index])
			.filter(
				(candidate): candidate is IndexedCountryPolygon =>
					candidate !== undefined
			),
		(candidate) => candidate
	)
	const matches = orderBy(
		uniqBy(
			candidates
				.filter((candidate) =>
					booleanPointInPolygon(
						turfPoint([
							unwrapLongitude(
								parsedSample.data.longitude,
								candidate.referenceLongitude
							),
							parsedSample.data.latitude
						]),
						candidate.geometry
					)
				)
				.map(({ country }) => country),
			({ countryCode }) => countryCode
		),
		[({ priority }) => priority, ({ countryCode }) => countryCode],
		['desc', 'asc']
	)
	const selected = matches[0]
	if (selected === undefined) {
		return null
	}

	const resolution = Object.freeze({
		boundaryDatasetVersion: dataset.version,
		countryCode: selected.countryCode,
		match: matches.length === 1 ? 'unambiguous' : 'overlap',
		matchedCountryCount: matches.length
	})
	resolutionSamples.set(resolution, sample)
	return resolution
}
