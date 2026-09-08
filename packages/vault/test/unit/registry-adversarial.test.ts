import { describe, expect, test } from 'bun:test'
import {
	parseIsoTimestamp,
	parseSchemaVersion,
	parseVaultId,
	parseVaultInstanceId
} from '@lena-inc/core'
import * as vaultRoot from '../../src/index'
import {
	activateRegisteredVault,
	addVaultRegistryEntry,
	createEmptyVaultRegistry,
	createVaultMetadata,
	getActiveVaultEntry,
	getSelectedVaultEntryForReopen,
	markStagingVaultReady,
	parseVaultMetadata,
	parseVaultRegistry,
	retireRegisteredVault,
	updateRegisteredVaultState,
	validateVaultLocator,
	validateVaultMetadataAgainstRegistryEntry,
	type VaultActivationToken,
	type VaultMetadata,
	type VaultRegistry,
	type VaultRegistryEntry,
	type VaultRetirementToken,
	type VaultValidationToken
} from '../../src/index'
import {
	createVaultActivationTokenFromAdapter,
	createVaultRetirementTokenFromAdapter,
	createVaultValidationTokenFromAdapter,
	isVaultActivationToken,
	isVaultRetirementToken,
	isVaultValidationToken
} from '../../src/registry-evidence'

const VAULT_ID_TEXT = '018f3f5a-1d2c-4abc-8def-0123456789ab'
const OTHER_VAULT_ID_TEXT = '018f3f5a-1d2c-4abc-8def-1123456789ab'
const INSTANCE_A_TEXT = '018f3f5a-1d2c-4abc-8def-2123456789ab'
const INSTANCE_B_TEXT = '018f3f5a-1d2c-4abc-8def-3123456789ab'
const INSTANCE_C_TEXT = '018f3f5a-1d2c-4abc-8def-4123456789ab'
const NOW_TEXT = '2026-09-01T08:15:30.000Z'
const EARLIER_TEXT = '2026-09-01T08:15:29.000Z'
const LATER_TEXT = '2026-09-01T08:15:31.000Z'

function registryFixtures() {
	const vaultId = parseVaultId(VAULT_ID_TEXT)
	const otherVaultId = parseVaultId(OTHER_VAULT_ID_TEXT)
	const instanceA = parseVaultInstanceId(INSTANCE_A_TEXT)
	const instanceB = parseVaultInstanceId(INSTANCE_B_TEXT)
	const instanceC = parseVaultInstanceId(INSTANCE_C_TEXT)
	const createdAt = parseIsoTimestamp(NOW_TEXT)
	const schemaVersion = parseSchemaVersion(1)
	const nextSchemaVersion = parseSchemaVersion(2)
	if (
		vaultId.isErr() ||
		otherVaultId.isErr() ||
		instanceA.isErr() ||
		instanceB.isErr() ||
		instanceC.isErr() ||
		createdAt.isErr() ||
		schemaVersion.isErr() ||
		nextSchemaVersion.isErr()
	) {
		throw new Error('Invalid registry test fixture')
	}

	const entry = (
		vaultInstanceId: typeof instanceA.value,
		locator: string,
		state: VaultRegistryEntry['state'] = 'staging'
	): VaultRegistryEntry => ({
		createdAt: createdAt.value,
		locator,
		schemaVersion: schemaVersion.value,
		state,
		vaultId: vaultId.value,
		vaultInstanceId
	})

	return {
		createdAt: createdAt.value,
		entry,
		instanceA: instanceA.value,
		instanceB: instanceB.value,
		instanceC: instanceC.value,
		nextSchemaVersion: nextSchemaVersion.value,
		otherVaultId: otherVaultId.value,
		schemaVersion: schemaVersion.value,
		vaultId: vaultId.value
	}
}

function metadataFor(entry: VaultRegistryEntry): VaultMetadata {
	const metadata = createVaultMetadata({
		createdAt: entry.createdAt,
		encryptionEnvelopeVersion: 1,
		schemaVersion: entry.schemaVersion,
		vaultId: entry.vaultId,
		vaultInstanceId: entry.vaultInstanceId
	})
	if (metadata.isErr()) throw metadata.error
	return metadata.value
}

function getEntry(
	registry: VaultRegistry,
	instanceId: VaultRegistryEntry['vaultInstanceId']
) {
	const entry = registry.entries.find(
		(candidate) => candidate.vaultInstanceId === instanceId
	)
	if (entry === undefined) throw new Error('Missing registry entry fixture')
	return entry
}

function validateAndReady(
	registry: VaultRegistry,
	instanceId: VaultRegistryEntry['vaultInstanceId']
): VaultRegistry {
	const entry = getEntry(registry, instanceId)
	const evidence = createVaultValidationTokenFromAdapter({
		entry,
		metadata: metadataFor(entry),
		validatedAt: registryFixtures().createdAt
	})
	if (evidence.isErr()) throw evidence.error
	const ready = markStagingVaultReady(registry, evidence.value)
	if (ready.isErr()) throw ready.error
	return ready.value
}

function activationFor(
	registry: VaultRegistry,
	instanceId: VaultRegistryEntry['vaultInstanceId'],
	validatedAt = registryFixtures().createdAt
) {
	const entry = getEntry(registry, instanceId)
	return createVaultActivationTokenFromAdapter({
		entry,
		metadata: metadataFor(entry),
		validatedAt
	})
}

function activate(
	registry: VaultRegistry,
	instanceId: VaultRegistryEntry['vaultInstanceId'],
	validatedAt = registryFixtures().createdAt
): VaultRegistry {
	const activation = activationFor(registry, instanceId, validatedAt)
	if (activation.isErr()) throw activation.error
	const active = activateRegisteredVault(registry, activation.value)
	if (active.isErr()) throw active.error
	return active.value
}

function readyRegistry(entries: readonly VaultRegistryEntry[]): VaultRegistry {
	let registry = createEmptyVaultRegistry()
	for (const entry of entries) {
		const added = addVaultRegistryEntry(registry, entry)
		if (added.isErr()) throw added.error
		registry = added.value
	}
	for (const entry of entries) {
		registry = validateAndReady(registry, entry.vaultInstanceId)
	}
	return registry
}

function parseAndActivate(
	entries: readonly VaultRegistryEntry[],
	activeInstanceId: VaultRegistryEntry['vaultInstanceId'],
	validatedAt = registryFixtures().createdAt
): VaultRegistry {
	const parsed = parseVaultRegistry({
		activeVaultInstanceId: null,
		entries,
		formatVersion: 1
	})
	if (parsed.isErr()) throw parsed.error
	return activate(parsed.value, activeInstanceId, validatedAt)
}

function timestamp(value: string) {
	const parsed = parseIsoTimestamp(value)
	if (parsed.isErr()) throw parsed.error
	return parsed.value
}

function retirementFor(
	registry: VaultRegistry,
	retiringInstanceId: VaultRegistryEntry['vaultInstanceId'],
	replacementInstanceId: VaultRegistryEntry['vaultInstanceId']
) {
	const retiringEntry = getEntry(registry, retiringInstanceId)
	return createVaultRetirementTokenFromAdapter({
		cleanupAuthorizedAt: registryFixtures().createdAt,
		registry,
		replacementEntry: getEntry(registry, replacementInstanceId),
		retiringEntry,
		retiringMetadata: metadataFor(retiringEntry),
		validatedAt: registryFixtures().createdAt
	})
}

describe('validated physical vault lifecycle', () => {
	test('requires staging, validation, readiness, and activation evidence', () => {
		const { entry, instanceA, instanceB, vaultId } = registryFixtures()
		const first = addVaultRegistryEntry(
			createEmptyVaultRegistry(),
			entry(instanceA, 'vaults/primary.sqlite')
		)
		if (first.isErr()) throw first.error
		const second = addVaultRegistryEntry(
			first.value,
			entry(instanceB, 'vaults/restored.sqlite')
		)
		if (second.isErr()) throw second.error

		const bothReady = validateAndReady(
			validateAndReady(second.value, instanceA),
			instanceB
		)
		const activation = activationFor(bothReady, instanceB)
		if (activation.isErr()) throw activation.error
		const active = activateRegisteredVault(bothReady, activation.value)
		if (active.isErr()) throw active.error
		expect(getActiveVaultEntry(active.value)).toMatchObject({
			vaultId,
			vaultInstanceId: instanceB
		})
	})

	test('generic updates cannot change staging, ready, or retired state', () => {
		const { entry, instanceA } = registryFixtures()
		const added = addVaultRegistryEntry(
			createEmptyVaultRegistry(),
			entry(instanceA, 'vaults/primary.sqlite')
		)
		if (added.isErr()) throw added.error
		expect(
			updateRegisteredVaultState(added.value, instanceA, 'ready').isOk()
		).toBe(false)
		expect(
			updateRegisteredVaultState(added.value, instanceA, 'retired').isOk()
		).toBe(false)

		const ready = validateAndReady(added.value, instanceA)
		expect(updateRegisteredVaultState(ready, instanceA, 'staging').isOk()).toBe(
			false
		)
		expect(updateRegisteredVaultState(ready, instanceA, 'retired').isOk()).toBe(
			false
		)

		const retired = parseVaultRegistry({
			activeVaultInstanceId: null,
			entries: [entry(instanceA, 'vaults/primary.sqlite', 'retired')],
			formatVersion: 1
		})
		if (retired.isErr()) throw retired.error
		expect(
			updateRegisteredVaultState(retired.value, instanceA, 'ready').isOk()
		).toBe(false)
		expect(
			updateRegisteredVaultState(retired.value, instanceA, 'staging').isOk()
		).toBe(false)
	})

	test('new entries cannot self-declare ready', () => {
		const { entry, instanceA } = registryFixtures()
		expect(
			addVaultRegistryEntry(
				createEmptyVaultRegistry(),
				entry(instanceA, 'vaults/primary.sqlite', 'ready')
			).isOk()
		).toBe(false)
	})

	test('validation and activation tokens cannot be forged or survive JSON', () => {
		const { entry, instanceA } = registryFixtures()
		const added = addVaultRegistryEntry(
			createEmptyVaultRegistry(),
			entry(instanceA, 'vaults/primary.sqlite')
		)
		if (added.isErr()) throw added.error
		const stagingEntry = getEntry(added.value, instanceA)
		const validation = createVaultValidationTokenFromAdapter({
			entry: stagingEntry,
			metadata: metadataFor(stagingEntry),
			validatedAt: registryFixtures().createdAt
		})
		if (validation.isErr()) throw validation.error
		const spreadValidation = { ...validation.value } as VaultValidationToken
		const jsonValidation = JSON.parse(
			JSON.stringify(validation.value)
		) as VaultValidationToken
		expect(isVaultValidationToken(spreadValidation)).toBe(false)
		expect(isVaultValidationToken(jsonValidation)).toBe(false)
		expect(markStagingVaultReady(added.value, spreadValidation).isOk()).toBe(
			false
		)
		expect(markStagingVaultReady(added.value, jsonValidation).isOk()).toBe(
			false
		)

		const ready = markStagingVaultReady(added.value, validation.value)
		if (ready.isErr()) throw ready.error
		expect(markStagingVaultReady(added.value, validation.value).isOk()).toBe(
			false
		)
		const activation = activationFor(ready.value, instanceA)
		if (activation.isErr()) throw activation.error
		const spreadActivation = { ...activation.value } as VaultActivationToken
		const jsonActivation = JSON.parse(
			JSON.stringify(activation.value)
		) as VaultActivationToken
		expect(isVaultActivationToken(spreadActivation)).toBe(false)
		expect(isVaultActivationToken(jsonActivation)).toBe(false)
		expect(activateRegisteredVault(ready.value, spreadActivation).isOk()).toBe(
			false
		)
		expect(activateRegisteredVault(ready.value, jsonActivation).isOk()).toBe(
			false
		)
		const active = activateRegisteredVault(ready.value, activation.value)
		if (active.isErr()) throw active.error
		expect(activateRegisteredVault(ready.value, activation.value).isOk()).toBe(
			false
		)
	})

	test('retirement requires an exact runtime-active replacement and is one-shot', () => {
		const { entry, instanceA, instanceB } = registryFixtures()
		const ready = readyRegistry([
			entry(instanceA, 'vaults/primary.sqlite'),
			entry(instanceB, 'vaults/replacement.sqlite')
		])
		const replacementActive = activate(ready, instanceB)
		const retirement = retirementFor(replacementActive, instanceA, instanceB)
		if (retirement.isErr()) throw retirement.error

		const restarted = parseVaultRegistry(replacementActive)
		if (restarted.isErr()) throw restarted.error
		expect(
			getSelectedVaultEntryForReopen(restarted.value)?.vaultInstanceId
		).toBe(instanceB)
		expect(getActiveVaultEntry(restarted.value)).toBeNull()
		expect(
			retireRegisteredVault(restarted.value, retirement.value).isOk()
		).toBe(false)

		const retiringInstanceActive = activate(replacementActive, instanceA)
		expect(
			retireRegisteredVault(retiringInstanceActive, retirement.value).isOk()
		).toBe(false)
		const replacementReactivated = activate(retiringInstanceActive, instanceB)
		const retired = retireRegisteredVault(
			replacementReactivated,
			retirement.value
		)
		if (retired.isErr()) throw retired.error
		expect(getEntry(retired.value, instanceA).state).toBe('retired')
		expect(getEntry(retired.value, instanceB).state).toBe('ready')
		expect(getActiveVaultEntry(retired.value)?.vaultInstanceId).toBe(instanceB)
		expect(getSelectedVaultEntryForReopen(retired.value)?.vaultInstanceId).toBe(
			instanceB
		)
		expect(
			retireRegisteredVault(replacementReactivated, retirement.value).isOk()
		).toBe(false)
	})

	test('retirement tokens cannot be forged, spread, or revived from JSON', () => {
		const { entry, instanceA, instanceB } = registryFixtures()
		const active = activate(
			readyRegistry([
				entry(instanceA, 'vaults/primary.sqlite'),
				entry(instanceB, 'vaults/replacement.sqlite')
			]),
			instanceB
		)
		const retirement = retirementFor(active, instanceA, instanceB)
		if (retirement.isErr()) throw retirement.error
		const spread = { ...retirement.value } as VaultRetirementToken
		const parsedJson = JSON.parse(
			JSON.stringify(retirement.value)
		) as VaultRetirementToken
		expect(isVaultRetirementToken(spread)).toBe(false)
		expect(isVaultRetirementToken(parsedJson)).toBe(false)
		expect(retireRegisteredVault(active, spread).isOk()).toBe(false)
		expect(retireRegisteredVault(active, parsedJson).isOk()).toBe(false)
	})

	test('retirement evidence rejects every target and replacement identity mismatch', () => {
		const { entry, instanceA, instanceB, instanceC, nextSchemaVersion } =
			registryFixtures()
		const target = entry(instanceA, 'vaults/primary.sqlite', 'ready')
		const replacement = entry(instanceB, 'vaults/replacement.sqlite', 'ready')
		const original = parseAndActivate([target, replacement], instanceB)
		const retirement = retirementFor(original, instanceA, instanceB)
		if (retirement.isErr()) throw retirement.error
		const later = timestamp(LATER_TEXT)

		const targetVariants: VaultRegistryEntry[] = [
			{ ...target, locator: 'vaults/changed-target.sqlite' },
			{ ...target, schemaVersion: nextSchemaVersion },
			{ ...target, createdAt: later },
			entry(instanceC, 'vaults/other-target.sqlite', 'ready')
		]
		for (const changedTarget of targetVariants) {
			const changed = parseAndActivate(
				[changedTarget, replacement],
				instanceB,
				later
			)
			expect(retireRegisteredVault(changed, retirement.value).isOk()).toBe(
				false
			)
		}

		const replacementVariants: ReadonlyArray<
			readonly [VaultRegistryEntry, VaultRegistryEntry['vaultInstanceId']]
		> = [
			[
				{ ...replacement, locator: 'vaults/changed-replacement.sqlite' },
				instanceB
			],
			[{ ...replacement, schemaVersion: nextSchemaVersion }, instanceB],
			[{ ...replacement, createdAt: later }, instanceB],
			[entry(instanceC, 'vaults/other-replacement.sqlite', 'ready'), instanceC]
		]
		for (const [changedReplacement, activeInstanceId] of replacementVariants) {
			const changed = parseAndActivate(
				[target, changedReplacement],
				activeInstanceId,
				later
			)
			expect(retireRegisteredVault(changed, retirement.value).isOk()).toBe(
				false
			)
		}
		expect(isVaultRetirementToken(retirement.value)).toBe(true)
	})

	test('retirement issuance rejects same, cross-vault, missing, and non-ready instances', () => {
		const { createdAt, entry, instanceA, instanceB, instanceC, otherVaultId } =
			registryFixtures()
		const active = parseAndActivate(
			[
				entry(instanceA, 'vaults/primary.sqlite', 'ready'),
				entry(instanceB, 'vaults/replacement.sqlite', 'ready')
			],
			instanceB
		)
		const target = getEntry(active, instanceA)
		const replacement = getEntry(active, instanceB)
		const issue = (
			retiringEntry: VaultRegistryEntry,
			replacementEntry: VaultRegistryEntry
		) =>
			createVaultRetirementTokenFromAdapter({
				cleanupAuthorizedAt: createdAt,
				registry: active,
				replacementEntry,
				retiringEntry,
				retiringMetadata: metadataFor(retiringEntry),
				validatedAt: createdAt
			})

		expect(issue(replacement, replacement).isOk()).toBe(false)
		expect(issue({ ...target, state: 'staging' }, replacement).isOk()).toBe(
			false
		)
		expect(issue({ ...target, state: 'retired' }, replacement).isOk()).toBe(
			false
		)
		expect(issue(target, { ...replacement, state: 'staging' }).isOk()).toBe(
			false
		)
		expect(issue(target, { ...replacement, state: 'retired' }).isOk()).toBe(
			false
		)
		expect(
			issue(target, entry(instanceC, 'vaults/missing.sqlite', 'ready')).isOk()
		).toBe(false)

		const crossVaultReplacement = {
			...entry(instanceB, 'vaults/cross-vault.sqlite', 'ready'),
			vaultId: otherVaultId
		}
		const crossVault = parseAndActivate(
			[target, crossVaultReplacement],
			instanceB
		)
		expect(retirementFor(crossVault, instanceA, instanceB).isOk()).toBe(false)
	})

	test('a token fails closed for the wrong active replacement without being consumed', () => {
		const { entry, instanceA, instanceB, instanceC } = registryFixtures()
		const ready = readyRegistry([
			entry(instanceA, 'vaults/primary.sqlite'),
			entry(instanceB, 'vaults/replacement.sqlite'),
			entry(instanceC, 'vaults/other-ready.sqlite')
		])
		const expectedReplacementActive = activate(ready, instanceB)
		const retirement = retirementFor(
			expectedReplacementActive,
			instanceA,
			instanceB
		)
		if (retirement.isErr()) throw retirement.error

		const wrongReplacementActive = activate(
			expectedReplacementActive,
			instanceC
		)
		expect(
			retireRegisteredVault(wrongReplacementActive, retirement.value).isOk()
		).toBe(false)
		expect(isVaultRetirementToken(retirement.value)).toBe(true)

		const expectedReplacementReactivated = activate(
			wrongReplacementActive,
			instanceB
		)
		expect(
			retireRegisteredVault(
				expectedReplacementReactivated,
				retirement.value
			).isOk()
		).toBe(true)
	})

	test('retirement issuance validates cleanup and replacement chronology', () => {
		const { createdAt, entry, instanceA, instanceB } = registryFixtures()
		const earlier = timestamp(EARLIER_TEXT)
		const later = timestamp(LATER_TEXT)
		const active = parseAndActivate(
			[
				entry(instanceA, 'vaults/primary.sqlite', 'ready'),
				entry(instanceB, 'vaults/replacement.sqlite', 'ready')
			],
			instanceB
		)
		const target = getEntry(active, instanceA)
		const replacement = getEntry(active, instanceB)
		const issue = (
			cleanupAuthorizedAt: typeof createdAt,
			validatedAt: typeof createdAt
		) =>
			createVaultRetirementTokenFromAdapter({
				cleanupAuthorizedAt,
				registry: active,
				replacementEntry: replacement,
				retiringEntry: target,
				retiringMetadata: metadataFor(target),
				validatedAt
			})

		expect(issue('not-a-timestamp' as typeof createdAt, createdAt).isOk()).toBe(
			false
		)
		expect(issue(createdAt, earlier).isOk()).toBe(false)
		expect(issue(earlier, createdAt).isOk()).toBe(false)

		const laterReplacement = {
			...entry(instanceB, 'vaults/later-replacement.sqlite', 'ready'),
			createdAt: later
		}
		const laterActive = parseAndActivate(
			[entry(instanceA, 'vaults/primary.sqlite', 'ready'), laterReplacement],
			instanceB,
			later
		)
		const laterTarget = getEntry(laterActive, instanceA)
		expect(
			createVaultRetirementTokenFromAdapter({
				cleanupAuthorizedAt: createdAt,
				registry: laterActive,
				replacementEntry: getEntry(laterActive, instanceB),
				retiringEntry: laterTarget,
				retiringMetadata: metadataFor(laterTarget),
				validatedAt: createdAt
			}).isOk()
		).toBe(false)
	})

	test('evidence is bound to exact identity, metadata, and schema', () => {
		const {
			createdAt,
			entry,
			instanceA,
			instanceB,
			nextSchemaVersion,
			vaultId
		} = registryFixtures()
		const staging = entry(instanceA, 'vaults/primary.sqlite')
		const wrongInstance = createVaultMetadata({
			createdAt,
			encryptionEnvelopeVersion: 1,
			schemaVersion: staging.schemaVersion,
			vaultId,
			vaultInstanceId: instanceB
		})
		const wrongSchema = createVaultMetadata({
			createdAt,
			encryptionEnvelopeVersion: 1,
			schemaVersion: nextSchemaVersion,
			vaultId,
			vaultInstanceId: instanceA
		})
		if (wrongInstance.isErr() || wrongSchema.isErr())
			throw new Error('Bad metadata fixture')
		expect(
			createVaultValidationTokenFromAdapter({
				entry: staging,
				metadata: wrongInstance.value,
				validatedAt: createdAt
			}).isOk()
		).toBe(false)
		expect(
			createVaultValidationTokenFromAdapter({
				entry: staging,
				metadata: wrongSchema.value,
				validatedAt: createdAt
			}).isOk()
		).toBe(false)
	})

	test('does not export internal registry evidence minters', () => {
		expect('createVaultValidationTokenFromAdapter' in vaultRoot).toBe(false)
		expect('createVaultActivationTokenFromAdapter' in vaultRoot).toBe(false)
		expect('createVaultRetirementTokenFromAdapter' in vaultRoot).toBe(false)
	})
})

describe('registry structure and persistence', () => {
	test('rejects duplicate instances, duplicate locators, and unsafe locators', () => {
		const { entry, instanceA, instanceB } = registryFixtures()
		const first = addVaultRegistryEntry(
			createEmptyVaultRegistry(),
			entry(instanceA, 'vaults/primary.sqlite')
		)
		if (first.isErr()) throw first.error
		expect(
			addVaultRegistryEntry(
				first.value,
				entry(instanceA, 'vaults/other.sqlite')
			).isOk()
		).toBe(false)
		expect(
			addVaultRegistryEntry(
				first.value,
				entry(instanceB, 'vaults/primary.sqlite')
			).isOk()
		).toBe(false)

		for (const locator of [
			'',
			'../vault.sqlite',
			'vaults/../vault.sqlite',
			'/private/vault.sqlite',
			'C:/vault.sqlite',
			'vaults\\vault.sqlite',
			'file:///private/vault.sqlite',
			'vaults/%2e%2e/vault.sqlite',
			'vaults//vault.sqlite',
			'vaults/\u0000vault.sqlite'
		]) {
			expect(validateVaultLocator(locator).isOk(), locator).toBe(false)
		}
	})

	test('retains a restart selection hint without granting runtime activation', () => {
		const { entry, instanceA, instanceB } = registryFixtures()
		const parsedReady = parseVaultRegistry({
			activeVaultInstanceId: instanceA,
			entries: [
				entry(instanceA, 'vaults/primary.sqlite', 'ready'),
				entry(instanceB, 'vaults/replacement.sqlite', 'ready')
			],
			formatVersion: 1
		})
		expect(parsedReady.isOk()).toBe(true)
		if (parsedReady.isErr()) throw parsedReady.error
		expect(getActiveVaultEntry(parsedReady.value)).toBeNull()
		expect(
			getSelectedVaultEntryForReopen(parsedReady.value)?.vaultInstanceId
		).toBe(instanceA)

		const forgedRuntimeRegistry = { ...parsedReady.value } as VaultRegistry
		expect(getActiveVaultEntry(forgedRuntimeRegistry)).toBeNull()
		expect(
			getSelectedVaultEntryForReopen(forgedRuntimeRegistry)?.vaultInstanceId
		).toBe(instanceA)
		expect(
			updateRegisteredVaultState(parsedReady.value, instanceA, 'retired').isOk()
		).toBe(false)
		expect(retirementFor(parsedReady.value, instanceA, instanceB).isOk()).toBe(
			false
		)

		const activation = activationFor(parsedReady.value, instanceA)
		if (activation.isErr()) throw activation.error
		const reopened = activateRegisteredVault(
			parsedReady.value,
			activation.value
		)
		if (reopened.isErr()) throw reopened.error
		expect(getActiveVaultEntry(reopened.value)?.vaultInstanceId).toBe(instanceA)
		expect(
			parseVaultRegistry({
				activeVaultInstanceId: instanceA,
				entries: [entry(instanceA, 'vaults/primary.sqlite', 'staging')],
				formatVersion: 1
			}).isOk()
		).toBe(false)
	})
})

describe('metadata and registry identity', () => {
	test('requires logical id, physical instance id, and schema to match', () => {
		const {
			createdAt,
			entry,
			instanceA,
			instanceB,
			nextSchemaVersion,
			otherVaultId,
			schemaVersion,
			vaultId
		} = registryFixtures()
		const registryEntry = entry(instanceA, 'vaults/primary.sqlite')
		const metadata = metadataFor(registryEntry)
		expect(
			validateVaultMetadataAgainstRegistryEntry(metadata, registryEntry).isOk()
		).toBe(true)

		const wrongLogical = createVaultMetadata({
			createdAt,
			encryptionEnvelopeVersion: 1,
			schemaVersion,
			vaultId: otherVaultId,
			vaultInstanceId: instanceA
		})
		const wrongInstance = createVaultMetadata({
			createdAt,
			encryptionEnvelopeVersion: 1,
			schemaVersion,
			vaultId,
			vaultInstanceId: instanceB
		})
		const wrongSchema = createVaultMetadata({
			createdAt,
			encryptionEnvelopeVersion: 1,
			schemaVersion: nextSchemaVersion,
			vaultId,
			vaultInstanceId: instanceA
		})
		if (wrongLogical.isErr() || wrongInstance.isErr() || wrongSchema.isErr())
			throw new Error('Bad fixture')
		expect(
			validateVaultMetadataAgainstRegistryEntry(
				wrongLogical.value,
				registryEntry
			).isOk()
		).toBe(false)
		expect(
			validateVaultMetadataAgainstRegistryEntry(
				wrongInstance.value,
				registryEntry
			).isOk()
		).toBe(false)
		expect(
			validateVaultMetadataAgainstRegistryEntry(
				wrongSchema.value,
				registryEntry
			).isOk()
		).toBe(false)
	})

	test('rejects unknown persisted metadata fields', () => {
		const { createdAt, instanceA, schemaVersion, vaultId } = registryFixtures()
		expect(
			parseVaultMetadata({
				createdAt,
				encryptionEnvelopeVersion: 1,
				formatVersion: 1,
				schemaVersion,
				vaultId,
				vaultInstanceId: instanceA,
				hostedIdentity: 'forbidden'
			}).isOk()
		).toBe(false)
	})
})
