import { describe, expect, test } from 'bun:test'
import { ok } from '@lena-inc/core'

import * as storeKitRoot from '../../src/index'
import {
	createInitialStoreKitCatalogEntitlementState,
	createStoreKitEntitlementCatalog,
	createStoreKitProductPolicy,
	INITIAL_STOREKIT_PURCHASE_STATE,
	INITIAL_STOREKIT_RESTORE_STATE,
	isRuntimeStoreKitEntitlementEvent,
	isVerifiedStoreKitEntitlementFact,
	parseStoreKitEntitlementEvent,
	parseStoreKitSequence,
	reduceStoreKitCatalogEntitlement,
	reduceStoreKitPurchase,
	reduceStoreKitRestore,
	type StoreKitEntitlementEvent,
	type StoreKitProductPolicy,
	type VerifiedStoreKitEntitlementFact
} from '../../src/index'
import { createStoreKitTransactionEventFromNativeAdapter } from '../../src/entitlement'
import { createVerifiedStoreKitEntitlementFactFromNativeAdapter } from '../../src/facts'

const LIFETIME_PRODUCT = 'studio.utilities.lena.lifetime'
const ANNUAL_PRODUCT = 'studio.utilities.lena.annual'

function policy(
	productId: string = LIFETIME_PRODUCT,
	productType:
		| 'auto-renewable-subscription'
		| 'non-consumable' = 'non-consumable'
): StoreKitProductPolicy {
	const parsed = createStoreKitProductPolicy(productId, productType)
	if (parsed.isErr()) throw parsed.error
	return parsed.value
}

function fact(
	productPolicy: StoreKitProductPolicy,
	sequence: number,
	overrides: Readonly<Record<string, unknown>> = {}
): VerifiedStoreKitEntitlementFact {
	const subscription =
		productPolicy.productType === 'auto-renewable-subscription'
	const parsed = createVerifiedStoreKitEntitlementFactFromNativeAdapter(
		{
			disposition: 'active',
			effectiveAt: '2026-09-01T08:00:00.000Z',
			expiresAt: subscription ? '2027-09-01T08:00:00.000Z' : null,
			observedAt: '2026-09-01T08:01:00.000Z',
			productId: productPolicy.productId,
			sequence,
			source: 'launch',
			...overrides
		},
		productPolicy
	)
	if (parsed.isErr()) throw parsed.error
	return parsed.value
}

describe('native-verified StoreKit facts', () => {
	test('keeps the raw native trust constructor out of the package root', () => {
		expect(
			'createVerifiedStoreKitEntitlementFactFromNativeAdapter' in storeKitRoot
		).toBe(false)
		for (const exportName of [
			'createStoreKitEntitlementSnapshot',
			'createStoreKitTransactionEvent',
			'createStoreKitUnavailableEvent',
			'createStoreKitEntitlementSnapshotFromNativeAdapter',
			'createStoreKitTransactionEventFromNativeAdapter',
			'createStoreKitUnavailableEventFromNativeAdapter'
		]) {
			expect(exportName in storeKitRoot).toBe(false)
		}
	})

	test('uses runtime opacity that does not survive structural forgery or serialization', () => {
		const verified = fact(policy(), 1)
		expect(isVerifiedStoreKitEntitlementFact(verified)).toBe(true)

		const forged = {
			...verified,
			disposition: 'active' as const
		} as VerifiedStoreKitEntitlementFact
		expect(isVerifiedStoreKitEntitlementFact(forged)).toBe(false)
		expect(createStoreKitTransactionEventFromNativeAdapter(forged).isOk()).toBe(
			false
		)

		const serialized = JSON.parse(
			JSON.stringify(verified)
		) as VerifiedStoreKitEntitlementFact
		expect(isVerifiedStoreKitEntitlementFact(serialized)).toBe(false)

		const issuedEvent =
			createStoreKitTransactionEventFromNativeAdapter(verified)
		if (issuedEvent.isErr()) throw issuedEvent.error
		expect(isRuntimeStoreKitEntitlementEvent(issuedEvent.value)).toBe(true)
		for (const untrustedEvent of [
			{ ...issuedEvent.value },
			JSON.parse(JSON.stringify(issuedEvent.value))
		]) {
			expect(isRuntimeStoreKitEntitlementEvent(untrustedEvent)).toBe(false)
			expect(parseStoreKitEntitlementEvent(untrustedEvent).isOk()).toBe(false)
		}
	})

	test('requires explicit product type and positive monotonic sequences', () => {
		expect(
			createStoreKitProductPolicy(LIFETIME_PRODUCT, undefined).isOk()
		).toBe(false)
		for (const invalid of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1, '1']) {
			expect(parseStoreKitSequence(invalid).isOk()).toBe(false)
		}
		expect(parseStoreKitSequence(1).isOk()).toBe(true)
	})

	test('rejects impossible product-type facts', () => {
		const lifetime = policy()
		expect(
			createVerifiedStoreKitEntitlementFactFromNativeAdapter(
				{
					disposition: 'expired',
					effectiveAt: '2026-09-01T08:00:00.000Z',
					expiresAt: null,
					observedAt: '2026-09-01T08:01:00.000Z',
					productId: lifetime.productId,
					sequence: 1,
					source: 'transaction_update'
				},
				lifetime
			).isOk()
		).toBe(false)
		expect(
			createVerifiedStoreKitEntitlementFactFromNativeAdapter(
				{
					disposition: 'active',
					effectiveAt: '2026-09-01T08:00:00.000Z',
					expiresAt: '2027-09-01T08:00:00.000Z',
					observedAt: '2026-09-01T08:01:00.000Z',
					productId: lifetime.productId,
					sequence: 1,
					source: 'launch'
				},
				lifetime
			).isOk()
		).toBe(false)

		const annual = policy(ANNUAL_PRODUCT, 'auto-renewable-subscription')
		expect(
			createVerifiedStoreKitEntitlementFactFromNativeAdapter(
				{
					disposition: 'active',
					effectiveAt: '2026-09-01T08:00:00.000Z',
					observedAt: '2026-09-01T08:01:00.000Z',
					productId: annual.productId,
					sequence: 1,
					source: 'launch'
				},
				annual
			).isOk()
		).toBe(false)
		expect(
			createVerifiedStoreKitEntitlementFactFromNativeAdapter(
				{
					disposition: 'active',
					effectiveAt: '2026-09-01T08:00:00.000Z',
					expiresAt: '2026-09-01T08:00:00.000Z',
					observedAt: '2026-09-01T08:01:00.000Z',
					productId: annual.productId,
					sequence: 1,
					source: 'launch'
				},
				annual
			).isOk()
		).toBe(false)
	})

	test('keeps rejected native identifiers out of safe diagnostics', () => {
		const sensitiveProduct = 'studio.utilities.lena.sensitive-purchase'
		const rejected = createVerifiedStoreKitEntitlementFactFromNativeAdapter(
			{
				disposition: 'active',
				effectiveAt: '2026-09-01T08:00:00.000Z',
				expiresAt: null,
				observedAt: '2026-09-01T08:01:00.000Z',
				productId: sensitiveProduct,
				sequence: 1,
				source: 'launch'
			},
			policy()
		)
		expect(rejected.isOk()).toBe(false)
		if (rejected.isErr()) {
			expect(JSON.stringify(rejected.error.toJSON())).not.toContain(
				sensitiveProduct
			)
		}
	})
})

describe('purchase and explicit restore operations', () => {
	test('models pending and cancellation without granting', () => {
		const started = reduceStoreKitPurchase(
			INITIAL_STOREKIT_PURCHASE_STATE,
			{ type: 'start' },
			policy()
		)
		if (started.isErr()) throw started.error
		const pending = reduceStoreKitPurchase(
			started.value,
			{ type: 'pending' },
			policy()
		)
		if (pending.isErr()) throw pending.error
		const cancelled = reduceStoreKitPurchase(
			pending.value,
			{ type: 'cancelled' },
			policy()
		)
		expect(cancelled).toEqual(ok({ status: 'cancelled' }))
	})

	test('completes only from a current opaque fact for the exact product', () => {
		const lifetime = policy()
		const started = reduceStoreKitPurchase(
			INITIAL_STOREKIT_PURCHASE_STATE,
			{ type: 'start' },
			lifetime
		)
		if (started.isErr()) throw started.error
		const completed = reduceStoreKitPurchase(
			started.value,
			{ fact: fact(lifetime, 1), type: 'completed' },
			lifetime
		)
		expect(completed.isOk() && completed.value.status).toBe('purchased')

		const annual = policy(ANNUAL_PRODUCT, 'auto-renewable-subscription')
		const expiredOnObservation = fact(annual, 2, {
			expiresAt: '2026-09-01T08:00:30.000Z'
		})
		const annualStarted = reduceStoreKitPurchase(
			INITIAL_STOREKIT_PURCHASE_STATE,
			{ type: 'start' },
			annual
		)
		if (annualStarted.isErr()) throw annualStarted.error
		expect(
			reduceStoreKitPurchase(
				annualStarted.value,
				{ fact: expiredOnObservation, type: 'completed' },
				annual
			).isOk()
		).toBe(false)
	})

	test('reports explicit restore found, expired, and empty', () => {
		const lifetime = policy()
		const restoring = reduceStoreKitRestore(
			INITIAL_STOREKIT_RESTORE_STATE,
			{ type: 'start' },
			lifetime
		)
		if (restoring.isErr()) throw restoring.error
		const found = reduceStoreKitRestore(
			restoring.value,
			{
				facts: [fact(lifetime, 1, { source: 'restore' })],
				observedAt: '2026-09-01T08:02:00.000Z',
				type: 'completed'
			},
			lifetime
		)
		expect(found.isOk() && found.value.status).toBe('found')

		const annual = policy(ANNUAL_PRODUCT, 'auto-renewable-subscription')
		const annualRestoring = reduceStoreKitRestore(
			INITIAL_STOREKIT_RESTORE_STATE,
			{ type: 'start' },
			annual
		)
		if (annualRestoring.isErr()) throw annualRestoring.error
		const expired = reduceStoreKitRestore(
			annualRestoring.value,
			{
				facts: [fact(annual, 2, { expiresAt: '2026-09-02T08:00:00.000Z' })],
				observedAt: '2026-09-02T08:00:00.000Z',
				type: 'completed'
			},
			annual
		)
		expect(expired).toEqual(ok({ status: 'empty' }))

		const emptyRestoring = reduceStoreKitRestore(
			INITIAL_STOREKIT_RESTORE_STATE,
			{ type: 'start' },
			lifetime
		)
		if (emptyRestoring.isErr()) throw emptyRestoring.error
		const empty = reduceStoreKitRestore(
			emptyRestoring.value,
			{
				facts: [],
				observedAt: '2026-09-01T08:02:00.000Z',
				type: 'completed'
			},
			lifetime
		)
		expect(empty).toEqual(ok({ status: 'empty' }))
	})
})

test('a forged fact cannot enter the catalog reducer', () => {
	const lifetime = policy()
	const catalog = createStoreKitEntitlementCatalog([lifetime])
	if (catalog.isErr()) throw catalog.error
	const forged = {
		disposition: 'active',
		effectiveAt: '2026-09-01T08:00:00.000Z',
		expiresAt: null,
		observedAt: '2026-09-01T08:01:00.000Z',
		productId: lifetime.productId,
		sequence: 1,
		source: 'launch'
	} as unknown as VerifiedStoreKitEntitlementFact
	const state = createInitialStoreKitCatalogEntitlementState(catalog.value)
	const reduced = reduceStoreKitCatalogEntitlement(
		state,
		{
			fact: forged,
			type: 'transaction'
		} as unknown as StoreKitEntitlementEvent,
		catalog.value
	)
	expect(reduced.isOk()).toBe(false)
})

test('the StoreKit package has no vault imports', async () => {
	const sourceDirectory = `${import.meta.dir}/../../src`
	const sourceFiles = []
	for await (const path of new Bun.Glob('*.ts').scan(sourceDirectory)) {
		sourceFiles.push(await Bun.file(`${sourceDirectory}/${path}`).text())
	}
	expect(sourceFiles.length).toBeGreaterThan(0)
	expect(sourceFiles.join('\n')).not.toContain('@lena-inc/vault')
})
