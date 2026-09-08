import {
	compareIsoTimestamps,
	err,
	LenaError,
	ok,
	type EffectId,
	type GenerationId,
	type IsoTimestamp,
	type Result,
	type VaultId
} from '@lena-inc/core'
import { parseSha256Checksum, type Sha256Checksum } from './checksum'
import {
	backupSnapshotWatermarkSchema,
	type BackupSnapshotWatermark
} from './manifest'

export type RemoteBackupProvider = 'google-drive' | 'icloud'

export interface RemoteObjectReceiptInput {
	readonly claimId: EffectId
	readonly generationId: GenerationId
	readonly objectByteLength: number
	readonly objectChecksum: Sha256Checksum
	readonly provider: RemoteBackupProvider
	readonly providerObjectId: string
	readonly providerObjectPath: string
	readonly verifiedAt: IsoTimestamp
	readonly vaultId: VaultId
}

const remoteObjectReceiptBrand: unique symbol = Symbol('RemoteObjectReceipt')

export type RemoteObjectReceipt = Readonly<
	RemoteObjectReceiptInput & {
		readonly [remoteObjectReceiptBrand]: 'RemoteObjectReceipt'
	}
>

export type GenerationVerificationKind = 'local' | 'remote'

export interface LocalVerifiedGenerationInput {
	readonly generationId: GenerationId
	readonly objectByteLength: number
	readonly objectChecksum: Sha256Checksum
	readonly snapshot: BackupSnapshotWatermark
	readonly verifiedAt: IsoTimestamp
	readonly vaultId: VaultId
}

const verifiedGenerationBrand: unique symbol = Symbol('VerifiedGeneration')

export interface GenerationVerificationFields {
	readonly claimId: EffectId | null
	readonly generationId: GenerationId
	readonly kind: GenerationVerificationKind
	readonly objectByteLength: number
	readonly objectChecksum: Sha256Checksum
	readonly provider: RemoteBackupProvider | null
	readonly providerObjectId: string | null
	readonly providerObjectPath: string | null
	readonly snapshot: BackupSnapshotWatermark
	readonly verifiedAt: IsoTimestamp
	readonly vaultId: VaultId
}

export type VerifiedGeneration = Readonly<
	GenerationVerificationFields & {
		readonly [verifiedGenerationBrand]: 'VerifiedGeneration'
	}
>

const runtimeRemoteReceiptBindings = new WeakMap<
	object,
	RemoteObjectReceiptInput
>()
const runtimeVerifiedGenerationBindings = new WeakMap<
	object,
	Readonly<{ localCiphertextUri: string | null }>
>()

function parseObjectByteLength(value: unknown): Result<number, LenaError> {
	if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
		return err(new LenaError('invalid_input'))
	}
	return ok(value)
}

function parseProviderObjectValue(
	value: unknown,
	boundary: 'id' | 'path'
): Result<string, LenaError> {
	const maximum = boundary === 'id' ? 512 : 1_024
	if (
		typeof value !== 'string' ||
		value.trim().length === 0 ||
		value.length > maximum ||
		/[\r\n]/.test(value)
	) {
		return err(new LenaError('invalid_input'))
	}
	return ok(value)
}

function parseLocalCiphertextUri(value: unknown): Result<string, LenaError> {
	if (
		typeof value !== 'string' ||
		value.trim().length === 0 ||
		value.length > 2_048 ||
		/[\r\n]/.test(value)
	) {
		return err(new LenaError('invalid_input'))
	}
	return ok(value)
}

/**
 * Internal runtime seam. It is intentionally absent from the package root export.
 * The future file/crypto runtime calls this only after hashing the exact local bytes.
 */
export function createRuntimeLocalVerifiedGeneration(
	input: LocalVerifiedGenerationInput & { readonly localCiphertextUri: string }
): Result<VerifiedGeneration, LenaError> {
	const objectByteLength = parseObjectByteLength(input.objectByteLength)
	if (objectByteLength.isErr()) return err(objectByteLength.error)
	const objectChecksum = parseSha256Checksum(input.objectChecksum)
	if (objectChecksum.isErr()) return err(objectChecksum.error)
	const localCiphertextUri = parseLocalCiphertextUri(input.localCiphertextUri)
	if (localCiphertextUri.isErr()) return err(localCiphertextUri.error)
	const snapshot = backupSnapshotWatermarkSchema.safeParse(input.snapshot)
	if (!snapshot.success) {
		return err(new LenaError('invalid_input'))
	}
	if (compareIsoTimestamps(input.verifiedAt, snapshot.data.committedAt) < 0) {
		return err(new LenaError('invalid_timestamp'))
	}

	const verificationFields: VerifiedGeneration = {
		[verifiedGenerationBrand]: 'VerifiedGeneration',
		claimId: null,
		generationId: input.generationId,
		kind: 'local' as const,
		objectByteLength: objectByteLength.value,
		objectChecksum: objectChecksum.value,
		provider: null,
		providerObjectId: null,
		providerObjectPath: null,
		snapshot: snapshot.data,
		verifiedAt: input.verifiedAt,
		vaultId: input.vaultId
	}
	const verification = Object.freeze(verificationFields)
	runtimeVerifiedGenerationBindings.set(
		verification,
		Object.freeze({ localCiphertextUri: localCiphertextUri.value })
	)
	return ok(verification)
}

/**
 * Internal runtime seam. It is intentionally absent from the package root export.
 * The provider verifier calls this only after inspecting and hashing exact remote bytes.
 */
export function createRuntimeRemoteObjectReceipt(
	input: RemoteObjectReceiptInput
): Result<RemoteObjectReceipt, LenaError> {
	const objectByteLength = parseObjectByteLength(input.objectByteLength)
	if (objectByteLength.isErr()) return err(objectByteLength.error)
	const objectChecksum = parseSha256Checksum(input.objectChecksum)
	if (objectChecksum.isErr()) return err(objectChecksum.error)
	const providerObjectId = parseProviderObjectValue(
		input.providerObjectId,
		'id'
	)
	if (providerObjectId.isErr()) return err(providerObjectId.error)
	const providerObjectPath = parseProviderObjectValue(
		input.providerObjectPath,
		'path'
	)
	if (providerObjectPath.isErr()) return err(providerObjectPath.error)

	const receiptFields: RemoteObjectReceipt = {
		[remoteObjectReceiptBrand]: 'RemoteObjectReceipt',
		...input,
		objectByteLength: objectByteLength.value,
		objectChecksum: objectChecksum.value,
		providerObjectId: providerObjectId.value,
		providerObjectPath: providerObjectPath.value
	}
	const receipt = Object.freeze(receiptFields)
	runtimeRemoteReceiptBindings.set(receipt, input)
	return ok(receipt)
}

export function createRuntimeRemoteVerifiedGeneration(input: {
	readonly activeClaimId: EffectId
	readonly expectedGenerationId: GenerationId
	readonly expectedObjectByteLength: number
	readonly expectedObjectChecksum: Sha256Checksum
	readonly expectedProvider: RemoteBackupProvider
	readonly expectedProviderObjectId: string
	readonly expectedProviderObjectPath: string
	readonly expectedVaultId: VaultId
	readonly receipt: RemoteObjectReceipt
	readonly sourceVerification: VerifiedGeneration
}): Result<VerifiedGeneration, LenaError> {
	if (!isRuntimeRemoteObjectReceipt(input.receipt)) {
		return err(new LenaError('integrity_failed'))
	}
	const expectedObjectByteLength = parseObjectByteLength(
		input.expectedObjectByteLength
	)
	if (expectedObjectByteLength.isErr())
		return err(expectedObjectByteLength.error)
	const expectedProviderObjectId = parseProviderObjectValue(
		input.expectedProviderObjectId,
		'id'
	)
	if (expectedProviderObjectId.isErr())
		return err(expectedProviderObjectId.error)
	const expectedProviderObjectPath = parseProviderObjectValue(
		input.expectedProviderObjectPath,
		'path'
	)
	if (expectedProviderObjectPath.isErr())
		return err(expectedProviderObjectPath.error)

	if (
		!isRuntimeVerifiedGeneration(input.sourceVerification) ||
		input.sourceVerification.kind !== 'local' ||
		input.sourceVerification.generationId !== input.expectedGenerationId ||
		input.sourceVerification.vaultId !== input.expectedVaultId ||
		input.sourceVerification.objectByteLength !==
			expectedObjectByteLength.value ||
		input.sourceVerification.objectChecksum !== input.expectedObjectChecksum ||
		input.receipt.claimId !== input.activeClaimId ||
		input.receipt.objectByteLength !== expectedObjectByteLength.value ||
		input.receipt.objectChecksum !== input.expectedObjectChecksum ||
		input.receipt.generationId !== input.expectedGenerationId ||
		input.receipt.provider !== input.expectedProvider ||
		input.receipt.providerObjectId !== expectedProviderObjectId.value ||
		input.receipt.providerObjectPath !== expectedProviderObjectPath.value ||
		input.receipt.vaultId !== input.expectedVaultId
	) {
		return err(new LenaError('integrity_failed'))
	}

	const verificationFields: VerifiedGeneration = {
		[verifiedGenerationBrand]: 'VerifiedGeneration',
		claimId: input.receipt.claimId,
		generationId: input.receipt.generationId,
		kind: 'remote' as const,
		objectByteLength: input.receipt.objectByteLength,
		objectChecksum: input.receipt.objectChecksum,
		provider: input.receipt.provider,
		providerObjectId: input.receipt.providerObjectId,
		providerObjectPath: input.receipt.providerObjectPath,
		snapshot: input.sourceVerification.snapshot,
		verifiedAt: input.receipt.verifiedAt,
		vaultId: input.receipt.vaultId
	}
	const verification = Object.freeze(verificationFields)
	runtimeVerifiedGenerationBindings.set(
		verification,
		Object.freeze({ localCiphertextUri: null })
	)
	return ok(verification)
}

export function isRuntimeRemoteObjectReceipt(
	value: unknown
): value is RemoteObjectReceipt {
	return (
		typeof value === 'object' &&
		value !== null &&
		runtimeRemoteReceiptBindings.has(value)
	)
}

export function isRuntimeVerifiedGeneration(
	value: unknown
): value is VerifiedGeneration {
	return (
		typeof value === 'object' &&
		value !== null &&
		runtimeVerifiedGenerationBindings.has(value)
	)
}

export function getRuntimeLocalCiphertextUri(
	verification: VerifiedGeneration
): string | null {
	if (
		!isRuntimeVerifiedGeneration(verification) ||
		verification.kind !== 'local'
	)
		return null
	return (
		runtimeVerifiedGenerationBindings.get(verification)?.localCiphertextUri ??
		null
	)
}
