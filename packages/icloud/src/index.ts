import {
	createImmutableTransportUploadPlan,
	createTransportDeletePlan,
	createTransportDownloadPlan,
	createTransportInspectPlan,
	createTransportListPlan,
	immutableTransportDeletePlanSchema,
	immutableTransportUploadPlanSchema,
	isAuthorizedImmutableTransportDeletePlan,
	isAuthorizedImmutableTransportUploadPlan,
	reconcileImmutableTransportConflict,
	transportCiphertextUriSchema,
	transportContinuationTokenSchema,
	transportProviderObjectIdSchema,
	transportRemotePathSchema,
	transportFailure,
	type BackupTransportFailure,
	type BackupAttempt,
	type GenerationManifest,
	type ImmutableTransportDeletePlan,
	type ImmutableTransportUploadPlan,
	type RemoteObjectReceipt,
	type RetentionPlan,
	type VerifiedGeneration
} from '@lena-inc/backup'
import {
	err,
	LenaError,
	ok,
	type EffectId,
	type GenerationId,
	type Result,
	type VaultId
} from '@lena-inc/core'
import { match } from 'ts-pattern'
import { z } from 'zod'

export * from './cloud-storage-read-runtime'

const iCloudUploadPlanMarker = Symbol('lena.icloud-upload-plan')
const iCloudDeletePlanMarker = Symbol('lena.icloud-delete-plan')

export type ICloudImmutableUploadPlan = Readonly<{
	readonly [iCloudUploadPlanMarker]: ImmutableTransportUploadPlan
	readonly claimId: EffectId
	readonly conflictBehavior: 'verify-existing-exact-object'
	readonly executionAuthorized: false
	readonly expectedObjectByteLength: number
	readonly expectedObjectChecksum: VerifiedGeneration['objectChecksum']
	readonly generationId: GenerationId
	readonly localCiphertextUri: string
	readonly provider: 'icloud'
	readonly remotePath: string
	readonly vaultId: VaultId
	readonly visibility: 'app-private'
}>

export interface ICloudListPlan {
	readonly continuationToken: string | null
	readonly prefix: string
	readonly readOnly: true
}

export interface ICloudExactObjectPlan {
	readonly providerObjectId: string
	readonly remotePath: string
}

export interface ICloudDownloadPlan extends ICloudExactObjectPlan {
	readonly expectedObjectByteLength: number
	readonly expectedObjectChecksum: VerifiedGeneration['objectChecksum']
	readonly materializePlaceholder: true
	readonly stagingCiphertextUri: string
}

export type ICloudDeletePlan = Readonly<
	ICloudExactObjectPlan & {
		readonly [iCloudDeletePlanMarker]: ImmutableTransportDeletePlan
		readonly authorizedByRetention: true
		readonly executionAuthorized: false
		readonly expectedObjectByteLength: number
		readonly expectedObjectChecksum: VerifiedGeneration['objectChecksum']
		readonly generationId: VerifiedGeneration['generationId']
		readonly provider: 'icloud'
		readonly vaultId: VaultId
	}
>

export const iCloudFailureCodeSchema = z.enum([
	'account-changed',
	'cancelled',
	'conflict',
	'not-authenticated',
	'not-found',
	'quota',
	'temporarily-unavailable',
	'unknown'
])

export type ICloudFailureCode = z.infer<typeof iCloudFailureCodeSchema>

export const iCloudContinuationTokenSchema = transportContinuationTokenSchema
export const iCloudProviderObjectIdSchema = transportProviderObjectIdSchema
export const iCloudCiphertextUriSchema = transportCiphertextUriSchema
export const iCloudImmutableUploadRequestSchema =
	immutableTransportUploadPlanSchema
		.unwrap()
		.extend({
			provider: z.literal('icloud'),
			visibility: z.literal('app-private')
		})
		.readonly()
export const iCloudDeleteRequestSchema = immutableTransportDeletePlanSchema
	.unwrap()
	.extend({ provider: z.literal('icloud') })
	.readonly()

export const iCloudConflictTargetSchema = z
	.strictObject({
		providerObjectId: iCloudProviderObjectIdSchema,
		remotePath: transportRemotePathSchema
	})
	.readonly()

export type ICloudConflictTarget = z.infer<typeof iCloudConflictTargetSchema>

function transportUploadPlan(
	value: unknown
): ImmutableTransportUploadPlan | null {
	if (typeof value !== 'object' || value === null) return null
	const transport = (value as { readonly [iCloudUploadPlanMarker]?: unknown })[
		iCloudUploadPlanMarker
	]
	return isAuthorizedImmutableTransportUploadPlan(transport) &&
		transport.provider === 'icloud'
		? transport
		: null
}

function transportDeletePlan(
	value: unknown
): ImmutableTransportDeletePlan | null {
	if (typeof value !== 'object' || value === null) return null
	const transport = (value as { readonly [iCloudDeletePlanMarker]?: unknown })[
		iCloudDeletePlanMarker
	]
	return isAuthorizedImmutableTransportDeletePlan(transport) &&
		transport.provider === 'icloud'
		? transport
		: null
}

export function createICloudImmutableUploadPlan(
	manifest: GenerationManifest,
	verification: VerifiedGeneration,
	attempt: BackupAttempt
): Result<ICloudImmutableUploadPlan, LenaError> {
	const transport = createImmutableTransportUploadPlan(
		manifest,
		verification,
		attempt,
		'icloud'
	)
	if (transport.isErr()) return err(transport.error)
	const plan: ICloudImmutableUploadPlan = {
		[iCloudUploadPlanMarker]: transport.value,
		claimId: transport.value.claimId,
		conflictBehavior: transport.value.conflictBehavior,
		executionAuthorized: false as const,
		expectedObjectByteLength: transport.value.expectedObjectByteLength,
		expectedObjectChecksum: transport.value.expectedObjectChecksum,
		generationId: transport.value.generationId,
		localCiphertextUri: transport.value.localCiphertextUri,
		provider: 'icloud' as const,
		remotePath: transport.value.remotePath,
		vaultId: transport.value.vaultId,
		visibility: 'app-private' as const
	}
	Object.defineProperty(plan, iCloudUploadPlanMarker, {
		configurable: false,
		enumerable: false,
		value: transport.value,
		writable: false
	})
	return ok(Object.freeze(plan))
}

export function isAuthorizedICloudImmutableUploadPlan(
	value: unknown
): value is ICloudImmutableUploadPlan {
	return transportUploadPlan(value) !== null
}

export function isAuthorizedICloudDeletePlan(
	value: unknown
): value is ICloudDeletePlan {
	return transportDeletePlan(value) !== null
}

export function createICloudListPlan(
	vaultId: VaultId,
	continuationToken: string | null = null
): Result<ICloudListPlan, LenaError> {
	return createTransportListPlan(vaultId, 'icloud', continuationToken).map(
		({ continuationToken: token, prefix, readOnly }) =>
			Object.freeze({ continuationToken: token, prefix, readOnly })
	)
}

export function createICloudInspectPlan(
	manifest: GenerationManifest,
	providerObjectId: string
): Result<ICloudExactObjectPlan, LenaError> {
	return createTransportInspectPlan(manifest, 'icloud', providerObjectId).map(
		({ providerObjectId: objectId, remotePath }) =>
			Object.freeze({ providerObjectId: objectId, remotePath })
	)
}

export function reconcileICloudUploadConflict(
	plan: ICloudImmutableUploadPlan,
	target: ICloudConflictTarget,
	receipt: RemoteObjectReceipt
): Result<RemoteObjectReceipt, LenaError> {
	const parsedTarget = iCloudConflictTargetSchema.safeParse(target)
	const transport = transportUploadPlan(plan)
	if (!parsedTarget.success || transport === null) {
		return err(new LenaError('conflict'))
	}
	return reconcileImmutableTransportConflict(
		transport,
		parsedTarget.data,
		receipt
	)
}

export function createICloudDownloadPlan(
	manifest: GenerationManifest,
	verification: VerifiedGeneration,
	stagingCiphertextUri: string
): Result<ICloudDownloadPlan, LenaError> {
	return createTransportDownloadPlan(
		manifest,
		verification,
		'icloud',
		stagingCiphertextUri
	).map((transport) =>
		Object.freeze({
			expectedObjectByteLength: transport.expectedObjectByteLength,
			expectedObjectChecksum: transport.expectedObjectChecksum,
			materializePlaceholder: true as const,
			providerObjectId: transport.providerObjectId,
			remotePath: transport.remotePath,
			stagingCiphertextUri: transport.stagingCiphertextUri
		})
	)
}

export function createICloudDeletePlan(
	manifest: GenerationManifest,
	verification: VerifiedGeneration,
	retention: RetentionPlan
): Result<ICloudDeletePlan, LenaError> {
	const transport = createTransportDeletePlan(
		manifest,
		verification,
		retention,
		'icloud'
	)
	if (transport.isErr()) return err(transport.error)
	const plan: ICloudDeletePlan = {
		[iCloudDeletePlanMarker]: transport.value,
		authorizedByRetention: true as const,
		executionAuthorized: false as const,
		expectedObjectByteLength: transport.value.expectedObjectByteLength,
		expectedObjectChecksum: transport.value.expectedObjectChecksum,
		generationId: transport.value.generationId,
		provider: 'icloud' as const,
		providerObjectId: transport.value.providerObjectId,
		remotePath: transport.value.remotePath,
		vaultId: transport.value.vaultId
	}
	Object.defineProperty(plan, iCloudDeletePlanMarker, {
		configurable: false,
		enumerable: false,
		value: transport.value,
		writable: false
	})
	return ok(Object.freeze(plan))
}

export function classifyICloudFailure(
	code: ICloudFailureCode
): BackupTransportFailure {
	return match(code)
		.with('account-changed', 'not-authenticated', () =>
			transportFailure('authentication-required')
		)
		.with('cancelled', () => transportFailure('cancelled'))
		.with('conflict', () => transportFailure('conflict'))
		.with('not-found', () => transportFailure('not-found'))
		.with('quota', () => transportFailure('quota-exceeded'))
		.with('temporarily-unavailable', () => transportFailure('retryable'))
		.with('unknown', () => transportFailure('fatal'))
		.exhaustive()
}

export function classifyUnknownICloudFailure(
	code: unknown
): BackupTransportFailure {
	const parsed = iCloudFailureCodeSchema.safeParse(code)
	return parsed.success
		? classifyICloudFailure(parsed.data)
		: transportFailure('fatal')
}
