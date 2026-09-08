import { mock } from 'bun:test'
import type { Purchase, PurchaseIOS } from 'expo-iap'

type PurchaseError = Readonly<{ code: string }>

let currentEntitlement: PurchaseIOS | null = null
let currentEntitlementError: Error | null = null
let currentEntitlementCalls = 0
let finishTransactionCalls = 0
let initConnectionResult = true
let purchaseDuringInit: Purchase | null = null
let purchaseErrorListener: ((error: PurchaseError) => void) | null = null
let purchaseUpdateListener: ((purchase: Purchase) => void) | null = null
let transactionVerified = true
const operationOrder: string[] = []

export function createExpoIapApplePurchase(
	productId: string,
	overrides: Partial<PurchaseIOS> = {}
): PurchaseIOS {
	return {
		expirationDateIOS: null,
		id: 'test-purchase',
		isAutoRenewing: false,
		isUpgradedIOS: false,
		productId,
		purchaseState: 'purchased',
		quantity: 1,
		revocationDateIOS: null,
		store: 'apple',
		transactionDate: Date.parse('2026-09-02T10:00:00.000Z'),
		transactionId: 'test-transaction',
		...overrides
	}
}

export function emitExpoIapPurchaseUpdate(purchase: Purchase): void {
	purchaseUpdateListener?.(purchase)
}

export function getExpoIapMockState(): Readonly<{
	currentEntitlementCalls: number
	finishTransactionCalls: number
	operationOrder: readonly string[]
	purchaseErrorListenerActive: boolean
	purchaseUpdateListenerActive: boolean
}> {
	return Object.freeze({
		currentEntitlementCalls,
		finishTransactionCalls,
		operationOrder: Object.freeze([...operationOrder]),
		purchaseErrorListenerActive: purchaseErrorListener !== null,
		purchaseUpdateListenerActive: purchaseUpdateListener !== null
	})
}

export function resetExpoIapMock(): void {
	currentEntitlement = null
	currentEntitlementError = null
	currentEntitlementCalls = 0
	finishTransactionCalls = 0
	initConnectionResult = true
	purchaseDuringInit = null
	purchaseErrorListener = null
	purchaseUpdateListener = null
	transactionVerified = true
	operationOrder.length = 0
}

export function setExpoIapCurrentEntitlement(
	purchase: PurchaseIOS | null
): void {
	currentEntitlement = purchase
}

export function setExpoIapCurrentEntitlementError(error: Error | null): void {
	currentEntitlementError = error
}

export function setExpoIapInitConnectionResult(result: boolean): void {
	initConnectionResult = result
}

export function setExpoIapPurchaseDuringInit(purchase: Purchase | null): void {
	purchaseDuringInit = purchase
}

export function setExpoIapTransactionVerified(verified: boolean): void {
	transactionVerified = verified
}

void mock.module('expo-iap', () => ({
	ErrorCode: Object.freeze({ UserCancelled: 'user-cancelled' }),
	currentEntitlementIOS: async () => {
		operationOrder.push('currentEntitlementIOS')
		currentEntitlementCalls += 1
		if (currentEntitlementError !== null) throw currentEntitlementError
		return currentEntitlement
	},
	endConnection: async () => {
		operationOrder.push('endConnection')
	},
	fetchProducts: async () => [],
	finishTransaction: async () => {
		operationOrder.push('finishTransaction')
		finishTransactionCalls += 1
	},
	initConnection: async () => {
		operationOrder.push('initConnection')
		const purchase = purchaseDuringInit
		purchaseDuringInit = null
		if (purchase !== null) purchaseUpdateListener?.(purchase)
		return initConnectionResult
	},
	isTransactionVerifiedIOS: async () => transactionVerified,
	purchaseErrorListener: (listener: (error: PurchaseError) => void) => {
		operationOrder.push('purchaseErrorListener')
		purchaseErrorListener = listener
		let removed = false
		return {
			remove: () => {
				if (removed) return
				removed = true
				operationOrder.push('removePurchaseErrorListener')
				if (purchaseErrorListener === listener) purchaseErrorListener = null
			}
		}
	},
	purchaseUpdatedListener: (listener: (purchase: Purchase) => void) => {
		operationOrder.push('purchaseUpdatedListener')
		purchaseUpdateListener = listener
		let removed = false
		return {
			remove: () => {
				if (removed) return
				removed = true
				operationOrder.push('removePurchaseUpdatedListener')
				if (purchaseUpdateListener === listener) purchaseUpdateListener = null
			}
		}
	},
	requestPurchase: async () => undefined,
	restorePurchases: async () => undefined
}))
