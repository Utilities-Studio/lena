import { beforeEach, describe, expect, test } from 'bun:test'
import type { PurchaseIOS } from 'expo-iap'

import {
	createExpoIapStoreKitRuntime,
	expoIapStoreKitRuntimeCapability,
	storeKitProductSchema,
	storeKitRuntimeObservationSchema
} from '../../src'
import {
	createExpoIapApplePurchase,
	emitExpoIapPurchaseUpdate,
	getExpoIapMockState,
	resetExpoIapMock,
	setExpoIapCurrentEntitlement,
	setExpoIapCurrentEntitlementError,
	setExpoIapInitConnectionResult,
	setExpoIapPurchaseDuringInit,
	setExpoIapTransactionVerified
} from '../support/expo-iap'

const POLICY = Object.freeze({
	productId: 'com.jetseen.lifetime',
	productType: 'non-consumable' as const
})

function applePurchase(overrides: Partial<PurchaseIOS> = {}): PurchaseIOS {
	return createExpoIapApplePurchase(POLICY.productId, overrides)
}

function flushRuntimeOperations(): Promise<void> {
	return Array.from({ length: 12 }).reduce<Promise<void>>(
		(flushed) => flushed.then(() => undefined),
		Promise.resolve()
	)
}

beforeEach(resetExpoIapMock)

describe('expo-iap StoreKit runtime boundary', () => {
	test('keeps native readiness and signed-device evidence unproven', () => {
		expect(expoIapStoreKitRuntimeCapability).toEqual({
			deviceEvidenceReady: false,
			runtimeReady: false,
			sdk: 'expo-iap',
			sourceIntegrated: true
		})
	})

	test('validates policy before constructing a runtime service', () => {
		expect(
			createExpoIapStoreKitRuntime({ ...POLICY, unexpected: true }).isErr()
		).toBe(true)
		expect(
			createExpoIapStoreKitRuntime({
				productId: '',
				productType: POLICY.productType
			}).isErr()
		).toBe(true)

		const runtime = createExpoIapStoreKitRuntime(POLICY)
		if (runtime.isErr()) throw runtime.error
		expect(runtime.value.getObservation()).toEqual({ kind: 'unknown' })
		expect(runtime.value.hasPaidAccess()).toBe(false)
	})

	test('requires a connected store for store operations', async () => {
		const runtime = createExpoIapStoreKitRuntime(POLICY)
		if (runtime.isErr()) throw runtime.error

		expect((await runtime.value.fetchProduct()).isErr()).toBe(true)
		expect((await runtime.value.purchase()).isErr()).toBe(true)
		expect((await runtime.value.restore()).isErr()).toBe(true)
		expect((await runtime.value.close()).isOk()).toBe(true)
	})

	test('registers listeners before initializing the store connection', async () => {
		const runtime = createExpoIapStoreKitRuntime(POLICY)
		if (runtime.isErr()) throw runtime.error

		const connected = await runtime.value.connect()
		if (connected.isErr()) throw connected.error

		expect(getExpoIapMockState().operationOrder.slice(0, 4)).toEqual([
			'purchaseUpdatedListener',
			'purchaseErrorListener',
			'initConnection',
			'currentEntitlementIOS'
		])
		await runtime.value.close()
	})

	test('does not lose a purchase update delivered during connection', async () => {
		const purchased = applePurchase()
		setExpoIapCurrentEntitlement(purchased)
		setExpoIapPurchaseDuringInit(purchased)
		const runtime = createExpoIapStoreKitRuntime(POLICY)
		if (runtime.isErr()) throw runtime.error

		const connected = await runtime.value.connect()
		if (connected.isErr()) throw connected.error
		await flushRuntimeOperations()

		expect(getExpoIapMockState().finishTransactionCalls).toBe(1)
		expect(runtime.value.hasPaidAccess()).toBe(true)
		await runtime.value.close()
	})

	test('cleans up listeners after failed initialization and permits a clean retry', async () => {
		setExpoIapInitConnectionResult(false)
		const runtime = createExpoIapStoreKitRuntime(POLICY)
		if (runtime.isErr()) throw runtime.error

		expect((await runtime.value.connect()).isErr()).toBe(true)
		expect(getExpoIapMockState()).toMatchObject({
			purchaseErrorListenerActive: false,
			purchaseUpdateListenerActive: false
		})

		setExpoIapInitConnectionResult(true)
		expect((await runtime.value.connect()).isOk()).toBe(true)
		expect(getExpoIapMockState()).toMatchObject({
			purchaseErrorListenerActive: true,
			purchaseUpdateListenerActive: true
		})
		await runtime.value.close()
	})

	test('accepts store-returned presentation data and rejects transaction authority', () => {
		const product = storeKitProductSchema.parse({
			currency: 'USD',
			displayPrice: '$119.00',
			platform: 'ios',
			price: 119,
			productId: POLICY.productId,
			productType: POLICY.productType
		})
		expect(product.displayPrice).toBe('$119.00')
		expect(
			storeKitProductSchema.safeParse({
				...product,
				transactionId: 'not-portable'
			}).success
		).toBe(false)
		expect(
			storeKitRuntimeObservationSchema.safeParse({
				expiresAt: null,
				kind: 'entitled',
				observedAt: '2026-09-02T10:00:00.000Z',
				productId: POLICY.productId,
				productType: POLICY.productType,
				transactionId: 'not-portable'
			}).success
		).toBe(false)
	})

	test('fails closed when a refresh cannot recheck current entitlement', async () => {
		setExpoIapCurrentEntitlement(applePurchase())
		const runtime = createExpoIapStoreKitRuntime(POLICY)
		if (runtime.isErr()) throw runtime.error
		const connected = await runtime.value.connect()
		if (connected.isErr()) throw connected.error
		expect(runtime.value.hasPaidAccess()).toBe(true)

		setExpoIapCurrentEntitlementError(new Error('store unavailable'))
		const refreshed = await runtime.value.refresh()
		expect(refreshed.isErr()).toBe(true)
		expect(runtime.value.getObservation()).toMatchObject({
			kind: 'unavailable',
			reason: 'store_unavailable'
		})
		expect(runtime.value.hasPaidAccess()).toBe(false)
		await runtime.value.close()
	})

	const nonGrantingUpdates: ReadonlyArray<
		readonly [string, Partial<PurchaseIOS>]
	> = [
		['pending', { purchaseState: 'pending' }],
		['unknown', { purchaseState: 'unknown' }],
		['revoked', { revocationDateIOS: Date.parse('2026-09-02T10:01:00.000Z') }],
		['upgraded', { isUpgradedIOS: true }]
	]

	for (const [state, overrides] of nonGrantingUpdates) {
		test(`reconciles ${state} update without finishing or granting it`, async () => {
			const runtime = createExpoIapStoreKitRuntime(POLICY)
			if (runtime.isErr()) throw runtime.error
			const connected = await runtime.value.connect()
			if (connected.isErr()) throw connected.error
			const callsBeforeUpdate = getExpoIapMockState().currentEntitlementCalls

			const update = applePurchase(overrides)
			setExpoIapCurrentEntitlement(update)
			emitExpoIapPurchaseUpdate(update)
			await flushRuntimeOperations()

			expect(getExpoIapMockState().currentEntitlementCalls).toBeGreaterThan(
				callsBeforeUpdate
			)
			expect(getExpoIapMockState().finishTransactionCalls).toBe(0)
			expect(runtime.value.hasPaidAccess()).toBe(false)
			expect(runtime.value.getObservation().kind).toBe('not_entitled')
			await runtime.value.close()
		})
	}

	test('finishes a verified purchase once, then reconciles current entitlement', async () => {
		const runtime = createExpoIapStoreKitRuntime(POLICY)
		if (runtime.isErr()) throw runtime.error
		const connected = await runtime.value.connect()
		if (connected.isErr()) throw connected.error

		const purchased = applePurchase()
		setExpoIapCurrentEntitlement(purchased)
		emitExpoIapPurchaseUpdate(purchased)
		await flushRuntimeOperations()

		expect(getExpoIapMockState().finishTransactionCalls).toBe(1)
		expect(runtime.value.getObservation().kind).toBe('entitled')
		expect(runtime.value.hasPaidAccess()).toBe(true)
		await runtime.value.close()
	})

	test('does not finish or grant an unverified purchased update', async () => {
		const runtime = createExpoIapStoreKitRuntime(POLICY)
		if (runtime.isErr()) throw runtime.error
		const connected = await runtime.value.connect()
		if (connected.isErr()) throw connected.error

		const purchased = applePurchase()
		setExpoIapCurrentEntitlement(purchased)
		setExpoIapTransactionVerified(false)
		emitExpoIapPurchaseUpdate(purchased)
		await flushRuntimeOperations()

		expect(getExpoIapMockState().finishTransactionCalls).toBe(0)
		expect(runtime.value.getObservation()).toMatchObject({
			kind: 'unavailable',
			reason: 'verification_failed'
		})
		expect(runtime.value.hasPaidAccess()).toBe(false)
		await runtime.value.close()
	})
})
