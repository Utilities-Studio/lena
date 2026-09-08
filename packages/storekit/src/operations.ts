import {
	err,
	LenaError,
	ok,
	parseIsoTimestamp,
	type IsoTimestamp,
	type Result
} from '@lena-inc/core'
import { isBefore, parseISO } from 'date-fns'
import { uniqBy } from 'es-toolkit'
import { match, P } from 'ts-pattern'
import { z } from 'zod'

import {
	isVerifiedStoreKitEntitlementFact,
	selectLatestStoreKitFact,
	type VerifiedStoreKitEntitlementFact
} from './facts'
import type { StoreKitProductPolicy } from './policy'

export const storeKitOperationFailureSchema = z.enum([
	'network_unavailable',
	'store_unavailable',
	'verification_failed',
	'unknown'
])
export type StoreKitOperationFailure = z.infer<
	typeof storeKitOperationFailureSchema
>

export type StoreKitPurchaseState =
	| Readonly<{ status: 'idle' }>
	| Readonly<{ status: 'purchasing' }>
	| Readonly<{ status: 'pending' }>
	| Readonly<{
			fact: VerifiedStoreKitEntitlementFact
			status: 'purchased'
	  }>
	| Readonly<{ status: 'cancelled' }>
	| Readonly<{ failure: StoreKitOperationFailure; status: 'failed' }>

export type StoreKitPurchaseEvent =
	| Readonly<{ type: 'start' }>
	| Readonly<{ type: 'pending' }>
	| Readonly<{
			fact: VerifiedStoreKitEntitlementFact
			type: 'completed'
	  }>
	| Readonly<{ type: 'cancelled' }>
	| Readonly<{ failure: StoreKitOperationFailure; type: 'failed' }>
	| Readonly<{ type: 'reset' }>

export const INITIAL_STOREKIT_PURCHASE_STATE: StoreKitPurchaseState =
	Object.freeze({
		status: 'idle' as const
	})

function activeFactAt(
	fact: VerifiedStoreKitEntitlementFact,
	policy: StoreKitProductPolicy,
	asOf: IsoTimestamp
): boolean {
	return (
		((policy.productType === 'non-consumable' && fact.expiresAt === null) ||
			(policy.productType === 'auto-renewable-subscription' &&
				fact.expiresAt !== null)) &&
		fact.disposition === 'active' &&
		fact.productId === policy.productId &&
		!isBefore(parseISO(asOf), parseISO(fact.effectiveAt)) &&
		(policy.productType === 'non-consumable' ||
			(fact.expiresAt !== null &&
				isBefore(parseISO(asOf), parseISO(fact.expiresAt))))
	)
}

export function reduceStoreKitPurchase(
	state: StoreKitPurchaseState,
	event: StoreKitPurchaseEvent,
	policy: StoreKitProductPolicy
): Result<StoreKitPurchaseState, LenaError> {
	return match<[StoreKitPurchaseState, StoreKitPurchaseEvent]>([state, event])
		.with([P._, { type: 'reset' }], () => ok(INITIAL_STOREKIT_PURCHASE_STATE))
		.with([{ status: 'idle' }, { type: 'start' }], () =>
			ok(Object.freeze({ status: 'purchasing' as const }))
		)
		.with(
			[{ status: P.union('purchasing', 'pending') }, { type: 'pending' }],
			() => ok(Object.freeze({ status: 'pending' as const }))
		)
		.with(
			[{ status: P.union('purchasing', 'pending') }, { type: 'cancelled' }],
			() => ok(Object.freeze({ status: 'cancelled' as const }))
		)
		.with(
			[{ status: P.union('purchasing', 'pending') }, { type: 'failed' }],
			([, failedEvent]) => {
				const failure = storeKitOperationFailureSchema.safeParse(
					failedEvent.failure
				)
				return failure.success
					? ok(
							Object.freeze({
								failure: failure.data,
								status: 'failed' as const
							})
						)
					: err(
							new LenaError('invalid_input', {
								boundary: 'storekit_purchase'
							})
						)
			}
		)
		.with(
			[{ status: P.union('purchasing', 'pending') }, { type: 'completed' }],
			([, completedEvent]) => {
				if (
					!isVerifiedStoreKitEntitlementFact(completedEvent.fact) ||
					!activeFactAt(
						completedEvent.fact,
						policy,
						completedEvent.fact.observedAt
					)
				) {
					return err(
						new LenaError('authentication_required', {
							boundary: 'storekit_purchase'
						})
					)
				}
				return ok(
					Object.freeze({
						fact: completedEvent.fact,
						status: 'purchased' as const
					})
				)
			}
		)
		.otherwise(([currentState, currentEvent]) =>
			err(
				new LenaError('invalid_state_transition', {
					boundary: 'storekit_purchase',
					event: currentEvent.type,
					state: currentState.status
				})
			)
		)
}

export type StoreKitRestoreState =
	| Readonly<{ status: 'idle' }>
	| Readonly<{ status: 'restoring' }>
	| Readonly<{
			fact: VerifiedStoreKitEntitlementFact
			status: 'found'
	  }>
	| Readonly<{ status: 'empty' }>
	| Readonly<{ failure: StoreKitOperationFailure; status: 'failed' }>

export type StoreKitRestoreEvent =
	| Readonly<{ type: 'start' }>
	| Readonly<{
			facts: readonly VerifiedStoreKitEntitlementFact[]
			observedAt: unknown
			type: 'completed'
	  }>
	| Readonly<{ failure: StoreKitOperationFailure; type: 'failed' }>
	| Readonly<{ type: 'reset' }>

export const INITIAL_STOREKIT_RESTORE_STATE: StoreKitRestoreState =
	Object.freeze({
		status: 'idle' as const
	})

export function reduceStoreKitRestore(
	state: StoreKitRestoreState,
	event: StoreKitRestoreEvent,
	policy: StoreKitProductPolicy
): Result<StoreKitRestoreState, LenaError> {
	return match<[StoreKitRestoreState, StoreKitRestoreEvent]>([state, event])
		.with([P._, { type: 'reset' }], () => ok(INITIAL_STOREKIT_RESTORE_STATE))
		.with([{ status: 'idle' }, { type: 'start' }], () =>
			ok(Object.freeze({ status: 'restoring' as const }))
		)
		.with([{ status: 'restoring' }, { type: 'failed' }], ([, failedEvent]) => {
			const failure = storeKitOperationFailureSchema.safeParse(
				failedEvent.failure
			)
			return failure.success
				? ok(
						Object.freeze({ failure: failure.data, status: 'failed' as const })
					)
				: err(
						new LenaError('invalid_input', {
							boundary: 'storekit_restore'
						})
					)
		})
		.with(
			[{ status: 'restoring' }, { type: 'completed' }],
			([, completedEvent]) => {
				const observedAt = parseIsoTimestamp(completedEvent.observedAt)
				if (observedAt.isErr()) {
					return err(observedAt.error)
				}
				if (
					completedEvent.facts.some(
						(fact) => !isVerifiedStoreKitEntitlementFact(fact)
					)
				) {
					return err(
						new LenaError('authentication_required', {
							boundary: 'storekit_restore'
						})
					)
				}
				if (
					uniqBy(completedEvent.facts, (fact) => fact.sequence).length !==
					completedEvent.facts.length
				) {
					return err(
						new LenaError('conflict', {
							boundary: 'storekit_restore'
						})
					)
				}
				const latest = selectLatestStoreKitFact(
					completedEvent.facts.filter(
						(fact) => fact.productId === policy.productId
					)
				)
				if (
					latest === null ||
					!activeFactAt(latest, policy, observedAt.value)
				) {
					return ok(Object.freeze({ status: 'empty' as const }))
				}
				return ok(Object.freeze({ fact: latest, status: 'found' as const }))
			}
		)
		.otherwise(([currentState, currentEvent]) =>
			err(
				new LenaError('invalid_state_transition', {
					boundary: 'storekit_restore',
					event: currentEvent.type,
					state: currentState.status
				})
			)
		)
}
