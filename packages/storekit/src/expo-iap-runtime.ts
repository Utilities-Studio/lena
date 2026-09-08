import {
	err,
	errAsync,
	isoTimestampSchema,
	LenaError,
	okAsync,
	ok,
	ResultAsync,
	type IsoTimestamp,
	type Result
} from '@lena/core'
import { isBefore, parseISO } from 'date-fns'
import {
	ErrorCode,
	currentEntitlementIOS,
	endConnection,
	fetchProducts,
	finishTransaction,
	initConnection,
	isTransactionVerifiedIOS,
	purchaseErrorListener,
	purchaseUpdatedListener,
	requestPurchase,
	restorePurchases,
	type ProductOrSubscription,
	type Purchase,
	type PurchaseIOS
} from 'expo-iap'
import { z } from 'zod'

import {
	storeKitProductIdSchema,
	storeKitProductPolicySchema,
	type StoreKitProductPolicy
} from './policy'

export const expoIapStoreKitRuntimeCapability = Object.freeze({
	deviceEvidenceReady: false as const,
	runtimeReady: false as const,
	sdk: 'expo-iap' as const,
	sourceIntegrated: true as const
})

type StoreKitConnectionState = 'connected' | 'connecting' | 'disconnected'

export const storeKitRuntimeObservationSchema = z.discriminatedUnion('kind', [
	z.strictObject({ kind: z.literal('unknown') }).readonly(),
	z
		.strictObject({
			expiresAt: isoTimestampSchema.nullable(),
			kind: z.literal('entitled'),
			observedAt: isoTimestampSchema,
			productId: storeKitProductIdSchema,
			productType: z.enum(['auto-renewable-subscription', 'non-consumable'])
		})
		.readonly(),
	z
		.strictObject({
			kind: z.literal('not_entitled'),
			observedAt: isoTimestampSchema,
			reason: z.enum([
				'expired',
				'no_current_entitlement',
				'refunded',
				'revoked'
			])
		})
		.readonly(),
	z
		.strictObject({
			kind: z.literal('unavailable'),
			observedAt: isoTimestampSchema,
			reason: z.enum([
				'not_connected',
				'store_unavailable',
				'verification_failed'
			])
		})
		.readonly()
])

export type StoreKitRuntimeObservation = z.infer<
	typeof storeKitRuntimeObservationSchema
>
export type StoreKitRuntimeListener = (
	observation: StoreKitRuntimeObservation
) => void

export interface StoreKitRuntimeService {
	close(): ResultAsync<void, LenaError>
	connect(): ResultAsync<StoreKitRuntimeObservation, LenaError>
	fetchProduct(): ResultAsync<StoreKitProduct, LenaError>
	getObservation(): StoreKitRuntimeObservation
	hasPaidAccess(): boolean
	purchase(): ResultAsync<'pending', LenaError>
	refresh(): ResultAsync<StoreKitRuntimeObservation, LenaError>
	restore(): ResultAsync<StoreKitRuntimeObservation, LenaError>
	subscribe(listener: StoreKitRuntimeListener): () => void
}

const purchaseProjectionSchema = z
	.strictObject({
		expirationDateIOS: z.number().nonnegative().nullable(),
		isUpgradedIOS: z.boolean().nullable(),
		productId: storeKitProductIdSchema,
		purchaseState: z.enum(['pending', 'purchased', 'unknown']),
		revocationDateIOS: z.number().nonnegative().nullable(),
		store: z.literal('apple'),
		transactionDate: z.number().nonnegative()
	})
	.readonly()

export const storeKitProductSchema = z
	.strictObject({
		currency: z.string().min(1).max(16),
		displayPrice: z.string().min(1).max(128),
		platform: z.literal('ios'),
		price: z.number().nonnegative().nullable(),
		productId: storeKitProductIdSchema,
		productType: z.enum(['auto-renewable-subscription', 'non-consumable'])
	})
	.readonly()
export type StoreKitProduct = z.infer<typeof storeKitProductSchema>

function now(): IsoTimestamp {
	return isoTimestampSchema.parse(new Date().toISOString())
}

function runtimeError(boundary: string, reason: string): LenaError {
	return new LenaError('temporarily_unavailable', {
		boundary,
		reason,
		retryable: true
	})
}

function operation<T>(
	boundary: string,
	run: () => Promise<T>
): ResultAsync<T, LenaError> {
	return ResultAsync.fromPromise(Promise.resolve().then(run), (error) =>
		error instanceof LenaError
			? error
			: runtimeError(boundary, 'native_operation_failed')
	)
}

function projectPurchase(purchase: PurchaseIOS) {
	return purchaseProjectionSchema.safeParse({
		expirationDateIOS: purchase.expirationDateIOS ?? null,
		isUpgradedIOS: purchase.isUpgradedIOS ?? null,
		productId: purchase.productId,
		purchaseState: purchase.purchaseState,
		revocationDateIOS: purchase.revocationDateIOS ?? null,
		store: purchase.store,
		transactionDate: purchase.transactionDate
	})
}

function isApplePurchase(purchase: Purchase): purchase is PurchaseIOS {
	return purchase.store === 'apple'
}

function projectProduct(
	product: ProductOrSubscription,
	policy: StoreKitProductPolicy
): StoreKitProduct | null {
	if (product.platform !== 'ios' || product.id !== policy.productId) return null
	const productType = product.typeIOS
	if (productType !== policy.productType) return null
	return storeKitProductSchema.parse({
		currency: product.currency,
		displayPrice: product.displayPrice,
		platform: product.platform,
		price: product.price ?? null,
		productId: product.id,
		productType
	})
}

function toIsoTimestamp(milliseconds: number): IsoTimestamp {
	return isoTimestampSchema.parse(new Date(milliseconds).toISOString())
}

function observationFromCurrentEntitlement(
	purchase: PurchaseIOS | null,
	policy: StoreKitProductPolicy,
	observedAt: IsoTimestamp
): StoreKitRuntimeObservation {
	if (purchase === null) {
		return storeKitRuntimeObservationSchema.parse({
			kind: 'not_entitled',
			observedAt,
			reason: 'no_current_entitlement'
		})
	}

	const parsed = projectPurchase(purchase)
	if (!parsed.success || parsed.data.productId !== policy.productId) {
		throw new LenaError('integrity_failed', {
			boundary: 'storekit_current_entitlement'
		})
	}
	if (parsed.data.revocationDateIOS !== null) {
		return storeKitRuntimeObservationSchema.parse({
			kind: 'not_entitled',
			observedAt,
			reason: 'revoked'
		})
	}
	if (
		parsed.data.isUpgradedIOS === true ||
		parsed.data.purchaseState !== 'purchased'
	) {
		return storeKitRuntimeObservationSchema.parse({
			kind: 'not_entitled',
			observedAt,
			reason: 'no_current_entitlement'
		})
	}

	const expiresAt =
		parsed.data.expirationDateIOS === null
			? null
			: toIsoTimestamp(parsed.data.expirationDateIOS)
	if (policy.productType === 'non-consumable' && expiresAt !== null) {
		throw new LenaError('integrity_failed', {
			boundary: 'storekit_current_entitlement'
		})
	}
	if (policy.productType === 'auto-renewable-subscription') {
		if (expiresAt === null) {
			throw new LenaError('integrity_failed', {
				boundary: 'storekit_current_entitlement'
			})
		}
		if (!isBefore(parseISO(observedAt), parseISO(expiresAt))) {
			return storeKitRuntimeObservationSchema.parse({
				kind: 'not_entitled',
				observedAt,
				reason: 'expired'
			})
		}
	}

	return storeKitRuntimeObservationSchema.parse({
		expiresAt,
		kind: 'entitled',
		observedAt,
		productId: policy.productId,
		productType: policy.productType
	})
}

export function createExpoIapStoreKitRuntime(
	input: unknown
): Result<StoreKitRuntimeService, LenaError> {
	const parsedPolicy = storeKitProductPolicySchema.safeParse(input)
	if (!parsedPolicy.success) {
		return err(
			new LenaError('invalid_input', { boundary: 'storekit_runtime_policy' })
		)
	}
	const policy = parsedPolicy.data
	let connectionGeneration = 0
	let connectionState: StoreKitConnectionState = 'disconnected'
	let observation: StoreKitRuntimeObservation =
		storeKitRuntimeObservationSchema.parse({
			kind: 'unknown'
		})
	let pendingPurchaseUpdates: Purchase[] = []
	let purchaseErrorSubscription: { remove(): void } | null = null
	let purchaseSubscription: { remove(): void } | null = null
	const listeners = new Set<StoreKitRuntimeListener>()

	const publish = (
		next: StoreKitRuntimeObservation
	): StoreKitRuntimeObservation => {
		observation = next
		for (const listener of listeners) listener(next)
		return next
	}

	const unavailable = (
		reason: Extract<
			StoreKitRuntimeObservation,
			{ kind: 'unavailable' }
		>['reason']
	): StoreKitRuntimeObservation =>
		publish(
			storeKitRuntimeObservationSchema.parse({
				kind: 'unavailable',
				observedAt: now(),
				reason
			})
		)

	const connectionIsActive = (generation: number): boolean =>
		generation === connectionGeneration && connectionState !== 'disconnected'

	const removePurchaseSubscriptions = (): void => {
		purchaseSubscription?.remove()
		purchaseErrorSubscription?.remove()
		purchaseSubscription = null
		purchaseErrorSubscription = null
	}

	const authorityOperation = (
		boundary: string,
		generation: number,
		run: () => Promise<StoreKitRuntimeObservation>
	): ResultAsync<StoreKitRuntimeObservation, LenaError> =>
		operation(boundary, run).mapErr((error) => {
			if (
				connectionIsActive(generation) &&
				observation.kind !== 'unavailable'
			) {
				unavailable('store_unavailable')
			}
			return error
		})

	const assertActiveConnection = (
		generation: number,
		boundary: string
	): void => {
		if (!connectionIsActive(generation)) {
			throw new LenaError('invalid_state_transition', { boundary })
		}
	}

	const reconcileCurrentEntitlement = async (
		generation: number,
		boundary: string
	): Promise<StoreKitRuntimeObservation> => {
		const current = await currentEntitlementIOS(policy.productId)
		assertActiveConnection(generation, boundary)
		if (current === null) {
			return publish(observationFromCurrentEntitlement(null, policy, now()))
		}
		if (!(await isTransactionVerifiedIOS(policy.productId))) {
			assertActiveConnection(generation, boundary)
			unavailable('verification_failed')
			throw new LenaError('integrity_failed', { boundary })
		}
		assertActiveConnection(generation, boundary)
		return publish(observationFromCurrentEntitlement(current, policy, now()))
	}

	const processPurchaseUpdate = (
		purchase: Purchase,
		generation: number
	): void => {
		if (
			!connectionIsActive(generation) ||
			!isApplePurchase(purchase) ||
			purchase.productId !== policy.productId
		) {
			return
		}
		if (connectionState === 'connecting') {
			pendingPurchaseUpdates.push(purchase)
			return
		}

		const parsedPurchase = projectPurchase(purchase)
		void authorityOperation(
			'storekit_purchase_update',
			generation,
			async () => {
				if (!parsedPurchase.success) {
					unavailable('verification_failed')
					throw new LenaError('integrity_failed', {
						boundary: 'storekit_purchase_update'
					})
				}

				const mayFinish =
					parsedPurchase.data.purchaseState === 'purchased' &&
					parsedPurchase.data.revocationDateIOS === null &&
					parsedPurchase.data.isUpgradedIOS !== true
				if (mayFinish) {
					if (!(await isTransactionVerifiedIOS(policy.productId))) {
						assertActiveConnection(generation, 'storekit_purchase_update')
						unavailable('verification_failed')
						throw new LenaError('integrity_failed', {
							boundary: 'storekit_purchase_update'
						})
					}
					assertActiveConnection(generation, 'storekit_purchase_update')
					await finishTransaction({ isConsumable: false, purchase })
					assertActiveConnection(generation, 'storekit_purchase_update')
				}

				return reconcileCurrentEntitlement(
					generation,
					'storekit_purchase_update'
				)
			}
		)
	}

	const refresh = (): ResultAsync<StoreKitRuntimeObservation, LenaError> => {
		if (connectionState !== 'connected') {
			unavailable('not_connected')
			return errAsync(
				new LenaError('invalid_state_transition', {
					boundary: 'storekit_runtime'
				})
			)
		}
		const generation = connectionGeneration
		return authorityOperation('storekit_runtime', generation, () =>
			reconcileCurrentEntitlement(generation, 'storekit_runtime')
		)
	}

	return ok(
		Object.freeze({
			close(): ResultAsync<void, LenaError> {
				const shouldEndConnection = connectionState !== 'disconnected'
				connectionGeneration += 1
				connectionState = 'disconnected'
				pendingPurchaseUpdates = []
				removePurchaseSubscriptions()
				publish(storeKitRuntimeObservationSchema.parse({ kind: 'unknown' }))
				return shouldEndConnection
					? operation('storekit_runtime', async () => {
							await endConnection()
						})
					: okAsync(undefined)
			},

			connect(): ResultAsync<StoreKitRuntimeObservation, LenaError> {
				if (connectionState === 'connected') return refresh()
				if (connectionState === 'connecting') {
					return errAsync(
						new LenaError('invalid_state_transition', {
							boundary: 'storekit_runtime'
						})
					)
				}

				connectionState = 'connecting'
				const generation = ++connectionGeneration
				return operation('storekit_runtime', async () => {
					try {
						purchaseSubscription = purchaseUpdatedListener((purchase) => {
							processPurchaseUpdate(purchase, generation)
						})
						purchaseErrorSubscription = purchaseErrorListener((error) => {
							if (
								connectionIsActive(generation) &&
								error.code !== ErrorCode.UserCancelled
							) {
								unavailable('store_unavailable')
							}
						})

						if (!(await initConnection())) {
							throw runtimeError('storekit_runtime', 'connection_failed')
						}
						if (
							generation !== connectionGeneration ||
							connectionState !== 'connecting'
						) {
							await endConnection()
							throw new LenaError('invalid_state_transition', {
								boundary: 'storekit_runtime'
							})
						}

						connectionState = 'connected'
						const queuedUpdates = pendingPurchaseUpdates
						pendingPurchaseUpdates = []
						for (const purchase of queuedUpdates) {
							processPurchaseUpdate(purchase, generation)
						}
						return reconcileCurrentEntitlement(generation, 'storekit_runtime')
					} catch (error) {
						if (generation === connectionGeneration) {
							removePurchaseSubscriptions()
							pendingPurchaseUpdates = []
							connectionState = 'disconnected'
							if (observation.kind !== 'unavailable') {
								unavailable('store_unavailable')
							}
						}
						throw error
					}
				})
			},

			fetchProduct(): ResultAsync<StoreKitProduct, LenaError> {
				if (connectionState !== 'connected') {
					return errAsync(
						new LenaError('invalid_state_transition', {
							boundary: 'storekit_product'
						})
					)
				}
				return operation('storekit_product', async () => {
					const products = await fetchProducts({
						skus: [policy.productId],
						type: policy.productType === 'non-consumable' ? 'in-app' : 'subs'
					})
					const matching = (products ?? [])
						.map((product) => projectProduct(product, policy))
						.filter((product): product is StoreKitProduct => product !== null)
					if (matching.length !== 1) {
						throw new LenaError('not_found', { boundary: 'storekit_product' })
					}
					return matching[0]!
				})
			},

			getObservation(): StoreKitRuntimeObservation {
				return observation
			},

			hasPaidAccess(): boolean {
				if (
					connectionState !== 'connected' ||
					observation.kind !== 'entitled'
				) {
					return false
				}
				return (
					observation.productType === 'non-consumable' ||
					(observation.expiresAt !== null &&
						isBefore(new Date(), parseISO(observation.expiresAt)))
				)
			},

			purchase(): ResultAsync<'pending', LenaError> {
				if (connectionState !== 'connected') {
					return errAsync(
						new LenaError('invalid_state_transition', {
							boundary: 'storekit_purchase'
						})
					)
				}
				const generation = connectionGeneration
				return operation('storekit_purchase', async () => {
					if (policy.productType === 'non-consumable') {
						await requestPurchase({
							request: { apple: { sku: policy.productId } },
							type: 'in-app'
						})
					} else {
						await requestPurchase({
							request: { apple: { sku: policy.productId } },
							type: 'subs'
						})
					}
					assertActiveConnection(generation, 'storekit_purchase')
					return 'pending' as const
				})
			},

			refresh,

			restore(): ResultAsync<StoreKitRuntimeObservation, LenaError> {
				if (connectionState !== 'connected') {
					return errAsync(
						new LenaError('invalid_state_transition', {
							boundary: 'storekit_restore'
						})
					)
				}
				const generation = connectionGeneration
				return authorityOperation('storekit_restore', generation, async () => {
					await restorePurchases()
					assertActiveConnection(generation, 'storekit_restore')
					return reconcileCurrentEntitlement(generation, 'storekit_restore')
				})
			},

			subscribe(listener: StoreKitRuntimeListener): () => void {
				listeners.add(listener)
				return () => {
					listeners.delete(listener)
				}
			}
		})
	)
}
