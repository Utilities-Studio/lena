import { describe, expect, test } from 'bun:test'
import {
	parseEffectId,
	parseIsoTimestamp,
	parseMutationId,
	parseSchemaVersion,
	parseVaultId,
	parseVaultInstanceId
} from '@lena-inc/core'
import {
	activateRegisteredVault,
	addVaultRegistryEntry,
	claimBackupObligation,
	createBackupObligation,
	createEmptyVaultRegistry,
	createVaultMetadata,
	getActiveVaultEntry,
	markStagingVaultReady,
	parseVaultMetadata,
	releaseBackupObligation,
	updateRegisteredVaultState
} from '../../src/index'
import {
	createVaultActivationTokenFromAdapter,
	createVaultValidationTokenFromAdapter
} from '../../src/registry-evidence'

const VAULT_UUID = '018f3f5a-1d2c-4abc-8def-0123456789ab'
const MUTATION_UUID = '018f3f5a-1d2c-4abc-8def-1123456789ab'
const EFFECT_UUID = '018f3f5a-1d2c-4abc-8def-2123456789ab'
const VAULT_INSTANCE_UUID = '018f3f5a-1d2c-4abc-8def-4123456789ab'
const NOW_TEXT = '2026-09-01T08:15:30.000Z'

function fixtures() {
	const vaultId = parseVaultId(VAULT_UUID)
	const mutationId = parseMutationId(MUTATION_UUID)
	const effectId = parseEffectId(EFFECT_UUID)
	const now = parseIsoTimestamp(NOW_TEXT)
	const schemaVersion = parseSchemaVersion(1)
	const vaultInstanceId = parseVaultInstanceId(VAULT_INSTANCE_UUID)
	if (
		vaultId.isErr() ||
		mutationId.isErr() ||
		effectId.isErr() ||
		now.isErr() ||
		schemaVersion.isErr() ||
		vaultInstanceId.isErr()
	) {
		throw new Error('Invalid test fixture')
	}
	return {
		commitSequence: 1,
		effectId: effectId.value,
		mutationId: mutationId.value,
		now: now.value,
		schemaVersion: schemaVersion.value,
		vaultId: vaultId.value,
		vaultInstanceId: vaultInstanceId.value
	}
}

describe('vault metadata', () => {
	test('round trips validated metadata', () => {
		const { now, schemaVersion, vaultId, vaultInstanceId } = fixtures()
		const metadata = createVaultMetadata({
			createdAt: now,
			encryptionEnvelopeVersion: 1,
			schemaVersion,
			vaultId,
			vaultInstanceId
		})
		expect(metadata.isOk()).toBe(true)
		if (metadata.isErr()) throw metadata.error
		expect(parseVaultMetadata(metadata.value)).toEqual(metadata)
	})

	test('contains no account, payment, or provider identity', () => {
		const { now, schemaVersion, vaultId, vaultInstanceId } = fixtures()
		const metadata = createVaultMetadata({
			createdAt: now,
			encryptionEnvelopeVersion: 1,
			schemaVersion,
			vaultId,
			vaultInstanceId
		})
		if (metadata.isErr()) throw metadata.error
		const serialized = JSON.stringify(metadata.value)
		expect(serialized).not.toContain('email')
		expect(serialized).not.toContain('payment')
		expect(serialized).not.toContain('provider')
	})
})

describe('vault registry', () => {
	test('activates only a registered ready vault', () => {
		const { now, schemaVersion, vaultId, vaultInstanceId } = fixtures()
		const added = addVaultRegistryEntry(createEmptyVaultRegistry(), {
			createdAt: now,
			locator: 'vaults/primary.sqlite',
			schemaVersion,
			state: 'staging',
			vaultId,
			vaultInstanceId
		})
		expect(added.isOk()).toBe(true)
		if (added.isErr()) throw added.error
		const entry = added.value.entries[0]
		if (entry === undefined) throw new Error('Missing registry entry fixture')
		const metadata = createVaultMetadata({
			createdAt: now,
			encryptionEnvelopeVersion: 1,
			schemaVersion,
			vaultId,
			vaultInstanceId
		})
		if (metadata.isErr()) throw metadata.error
		const validation = createVaultValidationTokenFromAdapter({
			entry,
			metadata: metadata.value,
			validatedAt: now
		})
		if (validation.isErr()) throw validation.error
		const ready = markStagingVaultReady(added.value, validation.value)
		if (ready.isErr()) throw ready.error
		const readyEntry = ready.value.entries[0]
		if (readyEntry === undefined)
			throw new Error('Missing ready registry entry fixture')
		const activation = createVaultActivationTokenFromAdapter({
			entry: readyEntry,
			metadata: metadata.value,
			validatedAt: now
		})
		if (activation.isErr()) throw activation.error
		const active = activateRegisteredVault(ready.value, activation.value)
		expect(active.isOk()).toBe(true)
		if (active.isErr()) throw active.error
		expect(getActiveVaultEntry(active.value)?.vaultId).toBe(vaultId)
		expect(
			updateRegisteredVaultState(
				active.value,
				vaultInstanceId,
				'retired'
			).isOk()
		).toBe(false)
	})

	test('rejects duplicate registration', () => {
		const { now, schemaVersion, vaultId, vaultInstanceId } = fixtures()
		const entry = {
			createdAt: now,
			locator: 'vaults/primary.sqlite',
			schemaVersion,
			state: 'staging' as const,
			vaultId,
			vaultInstanceId
		}
		const first = addVaultRegistryEntry(createEmptyVaultRegistry(), entry)
		if (first.isErr()) throw first.error
		expect(addVaultRegistryEntry(first.value, entry).isOk()).toBe(false)
	})
})

describe('durable backup obligations', () => {
	test('claims, releases, and retries without minting completion authority', () => {
		const {
			commitSequence,
			effectId,
			mutationId,
			now,
			vaultId,
			vaultInstanceId
		} = fixtures()
		const pending = createBackupObligation({
			commitSequence,
			committedAt: now,
			createdAt: now,
			mutationId,
			vaultId,
			vaultInstanceId
		})
		const claimed = claimBackupObligation(pending, effectId, now)
		expect(claimed.isOk()).toBe(true)
		if (claimed.isErr()) throw claimed.error
		const released = releaseBackupObligation(
			claimed.value,
			effectId,
			'temporarily_unavailable'
		)
		expect(released.isOk()).toBe(true)
		if (released.isErr()) throw released.error
		expect(released.value.attemptCount).toBe(1)
		const retried = claimBackupObligation(released.value, effectId, now)
		if (retried.isErr()) throw retried.error
		expect(retried.value.state).toBe('claimed')
		expect(retried.value.attemptCount).toBe(2)
	})

	test('does not release a pending or mismatched claim', () => {
		const {
			commitSequence,
			effectId,
			mutationId,
			now,
			vaultId,
			vaultInstanceId
		} = fixtures()
		const pending = createBackupObligation({
			commitSequence,
			committedAt: now,
			createdAt: now,
			mutationId,
			vaultId,
			vaultInstanceId
		})
		expect(
			releaseBackupObligation(
				pending,
				effectId,
				'temporarily_unavailable'
			).isOk()
		).toBe(false)
	})
})
