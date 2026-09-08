import {
	err,
	isoTimestampSchema,
	LenaError,
	ok,
	type Result
} from '@lena-inc/core'
import { z } from 'zod'

import {
	countryCodeSchema,
	gpsDetectorVersionSchema,
	gpsObservationIdSchema
} from './identifiers'

export const persistableCountryObservationSchema = z
	.strictObject({
		accuracyClass: z.enum(['coarse', 'precise']),
		boundaryDatasetVersion: gpsDetectorVersionSchema,
		confidence: z.enum(['high', 'low']),
		countryCode: countryCodeSchema,
		detectorVersion: gpsDetectorVersionSchema,
		kind: z.literal('country_observation'),
		observationId: gpsObservationIdSchema,
		observedAt: isoTimestampSchema,
		schemaVersion: z.literal(1)
	})
	.refine(
		({ accuracyClass, confidence }) =>
			accuracyClass === 'precise' || confidence === 'low',
		{
			path: ['confidence']
		}
	)
	.readonly()

export type PersistableCountryObservation = z.output<
	typeof persistableCountryObservationSchema
>

export function isPersistableCountryObservation(
	input: unknown
): input is PersistableCountryObservation {
	return persistableCountryObservationSchema.safeParse(input).success
}

export function parsePersistableCountryObservation(
	input: unknown
): Result<PersistableCountryObservation, LenaError> {
	const parsed = persistableCountryObservationSchema.safeParse(input)
	if (!parsed.success) {
		return err(
			new LenaError('invalid_input', {
				boundary: 'gps_persistable_observation'
			})
		)
	}
	return ok(parsed.data)
}
