import {
	compareIsoTimestamps,
	err,
	LenaError,
	ok,
	parseIsoTimestamp,
	type IsoTimestamp,
	type Result
} from '@lena-inc/core'
import { differenceInMilliseconds } from 'date-fns'
import { orderBy } from 'es-toolkit'
import { match } from 'ts-pattern'
import { z } from 'zod'

import {
	countryCodeSchema,
	gpsObservationIdSchema,
	gpsPolicyVersionSchema,
	parseCountryCode,
	type CountryCode,
	type GpsObservationId,
	type GpsPolicyVersion
} from './identifiers'
import {
	isPersistableCountryObservation,
	type PersistableCountryObservation
} from './persistable-observation'

export const gpsTransitionEffectIdSchema = z
	.string()
	.min(1)
	.max(1_024)
	.brand<'GpsTransitionEffectId'>()

export type GpsTransitionEffectId = z.output<typeof gpsTransitionEffectIdSchema>

export const gpsTransitionPolicySchema = z
	.object({
		acceptLowConfidence: z.boolean(),
		minimumDwellMilliseconds: z
			.number()
			.int()
			.min(0)
			.max(31 * 24 * 60 * 60 * 1_000),
		minimumObservations: z.number().int().min(1).max(10_000),
		version: gpsPolicyVersionSchema
	})
	.readonly()

export type GpsTransitionPolicy = z.output<typeof gpsTransitionPolicySchema>

export interface GpsTransitionCandidate {
	readonly countryCode: CountryCode
	readonly firstObservationId: GpsObservationId
	readonly firstObservedAt: IsoTimestamp
	readonly lastObservationId: GpsObservationId
	readonly lastObservedAt: IsoTimestamp
	readonly observationCount: number
	readonly policyVersion: GpsPolicyVersion
	readonly proposalEffectId: GpsTransitionEffectId | null
}

interface GpsObservationOrder {
	readonly observationId: GpsObservationId
	readonly observedAt: IsoTimestamp
}

export interface GpsManualCorrection {
	readonly correctedAt: IsoTimestamp
	readonly correctionId: GpsObservationId
	readonly countryCode: CountryCode
}

export interface GpsTransitionState {
	readonly candidate: GpsTransitionCandidate | null
	readonly currentCountry: CountryCode | null
	readonly currentCountrySource: 'application' | 'manual' | null
	readonly lastManualCorrection: GpsManualCorrection | null
	readonly lastObservationOrder: GpsObservationOrder | null
}

export type GpsTransitionEvent =
	| Readonly<{
			observation: PersistableCountryObservation
			type: 'observation'
	  }>
	| Readonly<{
			correction: GpsManualCorrection
			type: 'manual_correction'
	  }>

export interface GpsTransitionProposalEffect {
	readonly detectedAt: IsoTimestamp
	readonly effectId: GpsTransitionEffectId
	readonly firstObservedAt: IsoTimestamp
	readonly fromCountry: CountryCode | null
	readonly kind: 'country_transition_proposed'
	readonly policyVersion: GpsPolicyVersion
	readonly supportingObservationCount: number
	readonly toCountry: CountryCode
}

export interface GpsTransitionReduction {
	readonly effects: readonly GpsTransitionProposalEffect[]
	readonly state: GpsTransitionState
}

const gpsManualCorrectionInputSchema = z.object({
	correctedAt: z.string(),
	correctionId: gpsObservationIdSchema,
	countryCode: countryCodeSchema
})

export function parseGpsTransitionPolicy(
	input: unknown
): Result<GpsTransitionPolicy, LenaError> {
	const parsed = gpsTransitionPolicySchema.safeParse(input)
	return parsed.success
		? ok(Object.freeze(parsed.data))
		: err(
				new LenaError('invalid_input', {
					boundary: 'gps_transition_policy'
				})
			)
}

export function createGpsTransitionState(
	currentCountryInput: unknown
): Result<GpsTransitionState, LenaError> {
	if (currentCountryInput === null) {
		return ok(
			Object.freeze({
				candidate: null,
				currentCountry: null,
				currentCountrySource: null,
				lastManualCorrection: null,
				lastObservationOrder: null
			})
		)
	}

	const currentCountry = parseCountryCode(currentCountryInput)
	if (currentCountry.isErr()) {
		return err(currentCountry.error)
	}

	return ok(
		Object.freeze({
			candidate: null,
			currentCountry: currentCountry.value,
			currentCountrySource: 'application' as const,
			lastManualCorrection: null,
			lastObservationOrder: null
		})
	)
}

export function createGpsManualCorrection(
	input: Readonly<{
		correctedAt: unknown
		correctionId: unknown
		countryCode: unknown
	}>
): Result<GpsManualCorrection, LenaError> {
	const parsed = gpsManualCorrectionInputSchema.safeParse(input)
	if (!parsed.success) {
		return err(
			new LenaError('invalid_input', {
				boundary: 'gps_manual_correction'
			})
		)
	}

	const correctedAt = parseIsoTimestamp(parsed.data.correctedAt)
	if (correctedAt.isErr()) {
		return err(correctedAt.error)
	}

	return ok(
		Object.freeze({
			correctedAt: correctedAt.value,
			correctionId: parsed.data.correctionId,
			countryCode: parsed.data.countryCode
		})
	)
}

function compareObservationOrder(
	left: GpsObservationOrder,
	right: GpsObservationOrder
): number {
	const timestampOrder = compareIsoTimestamps(left.observedAt, right.observedAt)
	return timestampOrder === 0
		? left.observationId.localeCompare(right.observationId)
		: timestampOrder
}

function compareManualCorrections(
	left: GpsManualCorrection,
	right: GpsManualCorrection
): number {
	const timestampOrder = compareIsoTimestamps(
		left.correctedAt,
		right.correctedAt
	)
	return timestampOrder === 0
		? left.correctionId.localeCompare(right.correctionId)
		: timestampOrder
}

function createTransitionEffectId(
	policyVersion: GpsPolicyVersion,
	fromCountry: CountryCode | null,
	toCountry: CountryCode,
	firstObservationId: GpsObservationId,
	lastObservationId: GpsObservationId
): GpsTransitionEffectId {
	return gpsTransitionEffectIdSchema.parse(
		`gps:${policyVersion}:${fromCountry ?? 'none'}:${toCountry}:${firstObservationId}:${lastObservationId}`
	)
}

function withObservationOrder(
	state: GpsTransitionState,
	order: GpsObservationOrder,
	candidate: GpsTransitionCandidate | null
): GpsTransitionState {
	return Object.freeze({
		...state,
		candidate,
		lastObservationOrder: Object.freeze(order)
	})
}

function reduceManualCorrection(
	state: GpsTransitionState,
	correction: GpsManualCorrection
): GpsTransitionReduction {
	if (
		state.lastManualCorrection !== null &&
		compareManualCorrections(correction, state.lastManualCorrection) <= 0
	) {
		return Object.freeze({ effects: Object.freeze([]), state })
	}

	return Object.freeze({
		effects: Object.freeze([]),
		state: Object.freeze({
			...state,
			candidate: null,
			currentCountry: correction.countryCode,
			currentCountrySource: 'manual' as const,
			lastManualCorrection: correction
		})
	})
}

function reduceGpsObservation(
	state: GpsTransitionState,
	observation: PersistableCountryObservation,
	policy: GpsTransitionPolicy
): GpsTransitionReduction {
	if (!isPersistableCountryObservation(observation)) {
		return Object.freeze({ effects: Object.freeze([]), state })
	}

	const order: GpsObservationOrder = {
		observationId: observation.observationId,
		observedAt: observation.observedAt
	}
	if (
		state.lastManualCorrection !== null &&
		compareIsoTimestamps(
			observation.observedAt,
			state.lastManualCorrection.correctedAt
		) <= 0
	) {
		return Object.freeze({ effects: Object.freeze([]), state })
	}
	if (
		state.lastObservationOrder !== null &&
		compareObservationOrder(order, state.lastObservationOrder) <= 0
	) {
		return Object.freeze({ effects: Object.freeze([]), state })
	}

	if (observation.confidence === 'low' && !policy.acceptLowConfidence) {
		return Object.freeze({
			effects: Object.freeze([]),
			state: withObservationOrder(state, order, state.candidate)
		})
	}

	if (observation.countryCode === state.currentCountry) {
		return Object.freeze({
			effects: Object.freeze([]),
			state: withObservationOrder(state, order, null)
		})
	}

	const previousCandidate = state.candidate
	const candidate: GpsTransitionCandidate =
		previousCandidate === null ||
		previousCandidate.countryCode !== observation.countryCode ||
		previousCandidate.policyVersion !== policy.version
			? Object.freeze({
					countryCode: observation.countryCode,
					firstObservationId: observation.observationId,
					firstObservedAt: observation.observedAt,
					lastObservationId: observation.observationId,
					lastObservedAt: observation.observedAt,
					observationCount: 1,
					policyVersion: policy.version,
					proposalEffectId: null
				})
			: Object.freeze({
					...previousCandidate,
					lastObservationId: observation.observationId,
					lastObservedAt: observation.observedAt,
					observationCount: previousCandidate.observationCount + 1
				})

	const dwellMilliseconds = differenceInMilliseconds(
		new Date(candidate.lastObservedAt),
		new Date(candidate.firstObservedAt)
	)
	const meetsThreshold =
		candidate.observationCount >= policy.minimumObservations &&
		dwellMilliseconds >= policy.minimumDwellMilliseconds
	if (!meetsThreshold || candidate.proposalEffectId !== null) {
		return Object.freeze({
			effects: Object.freeze([]),
			state: withObservationOrder(state, order, candidate)
		})
	}

	const effectId = createTransitionEffectId(
		policy.version,
		state.currentCountry,
		candidate.countryCode,
		candidate.firstObservationId,
		candidate.lastObservationId
	)
	const proposedCandidate = Object.freeze({
		...candidate,
		proposalEffectId: effectId
	})
	const effect: GpsTransitionProposalEffect = Object.freeze({
		detectedAt: candidate.lastObservedAt,
		effectId,
		firstObservedAt: candidate.firstObservedAt,
		fromCountry: state.currentCountry,
		kind: 'country_transition_proposed' as const,
		policyVersion: policy.version,
		supportingObservationCount: candidate.observationCount,
		toCountry: candidate.countryCode
	})

	return Object.freeze({
		effects: Object.freeze([effect]),
		state: withObservationOrder(state, order, proposedCandidate)
	})
}

export function reduceGpsTransition(
	state: GpsTransitionState,
	event: GpsTransitionEvent,
	policy: GpsTransitionPolicy
): GpsTransitionReduction {
	return match(event)
		.with({ type: 'manual_correction' }, ({ correction }) =>
			reduceManualCorrection(state, correction)
		)
		.with({ type: 'observation' }, ({ observation }) =>
			reduceGpsObservation(state, observation, policy)
		)
		.exhaustive()
}

function eventTimestamp(event: GpsTransitionEvent): IsoTimestamp {
	return match(event)
		.with({ type: 'observation' }, ({ observation }) => observation.observedAt)
		.with(
			{ type: 'manual_correction' },
			({ correction }) => correction.correctedAt
		)
		.exhaustive()
}

function eventIdentifier(event: GpsTransitionEvent): string {
	return match(event)
		.with(
			{ type: 'observation' },
			({ observation }) => observation.observationId
		)
		.with(
			{ type: 'manual_correction' },
			({ correction }) => correction.correctionId
		)
		.exhaustive()
}

function eventTypeOrder(event: GpsTransitionEvent): number {
	return event.type === 'observation' ? 0 : 1
}

export function reduceGpsTransitionEvents(
	initialState: GpsTransitionState,
	events: readonly GpsTransitionEvent[],
	policy: GpsTransitionPolicy
): GpsTransitionReduction {
	const sortedEvents = orderBy(
		events,
		[eventTimestamp, eventTypeOrder, eventIdentifier],
		['asc', 'asc', 'asc']
	)

	let state = initialState
	const effects: GpsTransitionProposalEffect[] = []
	for (const event of sortedEvents) {
		const reduction = reduceGpsTransition(state, event, policy)
		state = reduction.state
		effects.push(...reduction.effects)
	}

	return Object.freeze({ effects: Object.freeze(effects), state })
}
