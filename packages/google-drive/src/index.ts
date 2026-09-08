import {
	createImmutableTransportUploadPlan,
	createTransportDeletePlan,
	createTransportDownloadPlan,
	createTransportListPlan,
	immutableTransportDeletePlanSchema,
	immutableTransportUploadPlanSchema,
	isAuthorizedImmutableTransportDeletePlan,
	isAuthorizedImmutableTransportUploadPlan,
	reconcileImmutableTransportConflict,
	sha256ChecksumSchema,
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
	effectIdSchema,
	err,
	generationIdSchema,
	LenaError,
	ok,
	vaultIdSchema,
	type EffectId,
	type GenerationId,
	type Result,
	type VaultId
} from '@lena-inc/core'
import { match } from 'ts-pattern'
import { z } from 'zod'

export * from './cloud-storage-read-runtime'

const googleDriveUploadPlanMarker = Symbol('lena.google-drive-upload-plan')
const googleDriveDeletePlanMarker = Symbol('lena.google-drive-delete-plan')

export type GoogleDriveImmutableUploadPlan = Readonly<{
	readonly [googleDriveUploadPlanMarker]: ImmutableTransportUploadPlan
	readonly claimId: EffectId
	readonly conflictBehavior: 'verify-existing-exact-object'
	readonly executionAuthorized: false
	readonly expectedObjectByteLength: number
	readonly expectedObjectChecksum: VerifiedGeneration['objectChecksum']
	readonly folder: 'appDataFolder'
	readonly generationId: GenerationId
	readonly localCiphertextUri: string
	readonly provider: 'google-drive'
	readonly remotePath: string
	readonly requiredScope: 'drive.appdata'
	readonly resumable: true
	readonly vaultId: VaultId
}>

export interface GoogleDriveListPlan {
	readonly folder: 'appDataFolder'
	readonly pageSize: number
	readonly pageToken: string | null
	readonly prefix: string
	readonly readOnly: true
	readonly requiredScope: 'drive.appdata'
}

export interface GoogleDriveExactObjectPlan {
	readonly folder: 'appDataFolder'
	readonly providerObjectId: string
	readonly requiredScope: 'drive.appdata'
}

export interface GoogleDriveDownloadPlan extends GoogleDriveExactObjectPlan {
	readonly expectedObjectByteLength: number
	readonly expectedObjectChecksum: VerifiedGeneration['objectChecksum']
	readonly stagingCiphertextUri: string
}

export type GoogleDriveDeletePlan = Readonly<
	GoogleDriveExactObjectPlan & {
		readonly [googleDriveDeletePlanMarker]: ImmutableTransportDeletePlan
		readonly authorizedByRetention: true
		readonly executionAuthorized: false
		readonly expectedObjectByteLength: number
		readonly expectedObjectChecksum: VerifiedGeneration['objectChecksum']
		readonly generationId: VerifiedGeneration['generationId']
		readonly provider: 'google-drive'
		readonly vaultId: VaultId
	}
>

const googleDriveObjectByteLengthSchema = z.int().nonnegative()

export const googleDrivePageTokenSchema = transportContinuationTokenSchema
export const googleDriveProviderObjectIdSchema = transportProviderObjectIdSchema
export const googleDriveCiphertextUriSchema = transportCiphertextUriSchema
const googleDriveRemotePathSchema = transportRemotePathSchema
export const googleDriveImmutableUploadRequestSchema =
	immutableTransportUploadPlanSchema
		.unwrap()
		.extend({
			folder: z.literal('appDataFolder'),
			provider: z.literal('google-drive'),
			requiredScope: z.literal('drive.appdata'),
			resumable: z.literal(true)
		})
		.readonly()
export const googleDriveDeleteRequestSchema = immutableTransportDeletePlanSchema
	.unwrap()
	.extend({
		folder: z.literal('appDataFolder'),
		provider: z.literal('google-drive'),
		requiredScope: z.literal('drive.appdata')
	})
	.readonly()

export const googleDriveListInputSchema = z
	.strictObject({
		pageSize: z.int().min(1).max(1_000).optional(),
		pageToken: googleDrivePageTokenSchema.nullable().optional()
	})
	.readonly()

export const googleDriveConflictTargetSchema = z
	.strictObject({
		folder: z.literal('appDataFolder'),
		providerObjectId: googleDriveProviderObjectIdSchema,
		remotePath: googleDriveRemotePathSchema,
		requiredScope: z.literal('drive.appdata')
	})
	.readonly()

export type GoogleDriveConflictTarget = z.infer<
	typeof googleDriveConflictTargetSchema
>

export const googleDriveResumableCheckpointSchema = z
	.strictObject({
		claimId: effectIdSchema,
		committedByteLength: googleDriveObjectByteLengthSchema,
		expectedObjectByteLength: googleDriveObjectByteLengthSchema,
		expectedObjectChecksum: sha256ChecksumSchema,
		generationId: generationIdSchema,
		localCiphertextUri: googleDriveCiphertextUriSchema,
		remotePath: googleDriveRemotePathSchema,
		sessionId: z
			.string()
			.max(1_024)
			.refine((value) => value.trim().length > 0 && !/[\r\n]/.test(value)),
		vaultId: vaultIdSchema
	})
	.superRefine((checkpoint, context) => {
		if (checkpoint.committedByteLength > checkpoint.expectedObjectByteLength) {
			context.addIssue({
				code: 'custom',
				message: 'committed_bytes_exceed_expected_bytes',
				path: ['committedByteLength']
			})
		}
	})
	.readonly()

export type GoogleDriveResumableCheckpoint = z.infer<
	typeof googleDriveResumableCheckpointSchema
>

export interface GoogleDriveResumeUploadPlan {
	readonly checkpoint: GoogleDriveResumableCheckpoint
	readonly remainingByteLength: number
	readonly upload: GoogleDriveImmutableUploadPlan
}

export const googleDriveFailureCodeSchema = z.enum([
	'account-changed',
	'cancelled',
	'conflict',
	'not-found',
	'quota',
	'rate-limited',
	'token-expired',
	'unknown'
])

export type GoogleDriveFailureCode = z.infer<
	typeof googleDriveFailureCodeSchema
>

function transportUploadPlan(
	value: unknown
): ImmutableTransportUploadPlan | null {
	if (typeof value !== 'object' || value === null) return null
	const transport = (
		value as { readonly [googleDriveUploadPlanMarker]?: unknown }
	)[googleDriveUploadPlanMarker]
	return isAuthorizedImmutableTransportUploadPlan(transport) &&
		transport.provider === 'google-drive'
		? transport
		: null
}

function transportDeletePlan(
	value: unknown
): ImmutableTransportDeletePlan | null {
	if (typeof value !== 'object' || value === null) return null
	const transport = (
		value as { readonly [googleDriveDeletePlanMarker]?: unknown }
	)[googleDriveDeletePlanMarker]
	return isAuthorizedImmutableTransportDeletePlan(transport) &&
		transport.provider === 'google-drive'
		? transport
		: null
}

export function createGoogleDriveImmutableUploadPlan(
	manifest: GenerationManifest,
	verification: VerifiedGeneration,
	attempt: BackupAttempt
): Result<GoogleDriveImmutableUploadPlan, LenaError> {
	const transport = createImmutableTransportUploadPlan(
		manifest,
		verification,
		attempt,
		'google-drive'
	)
	if (transport.isErr()) return err(transport.error)
	const plan: GoogleDriveImmutableUploadPlan = {
		[googleDriveUploadPlanMarker]: transport.value,
		claimId: transport.value.claimId,
		conflictBehavior: transport.value.conflictBehavior,
		executionAuthorized: false as const,
		expectedObjectByteLength: transport.value.expectedObjectByteLength,
		expectedObjectChecksum: transport.value.expectedObjectChecksum,
		folder: 'appDataFolder' as const,
		generationId: transport.value.generationId,
		localCiphertextUri: transport.value.localCiphertextUri,
		provider: 'google-drive' as const,
		remotePath: transport.value.remotePath,
		requiredScope: 'drive.appdata' as const,
		resumable: true as const,
		vaultId: transport.value.vaultId
	}
	Object.defineProperty(plan, googleDriveUploadPlanMarker, {
		configurable: false,
		enumerable: false,
		value: transport.value,
		writable: false
	})
	return ok(Object.freeze(plan))
}

export function isAuthorizedGoogleDriveImmutableUploadPlan(
	value: unknown
): value is GoogleDriveImmutableUploadPlan {
	return transportUploadPlan(value) !== null
}

export function isAuthorizedGoogleDriveDeletePlan(
	value: unknown
): value is GoogleDriveDeletePlan {
	return transportDeletePlan(value) !== null
}

export function createGoogleDriveListPlan(
	vaultId: VaultId,
	input: z.input<typeof googleDriveListInputSchema> = {}
): Result<GoogleDriveListPlan, LenaError> {
	const parsedInput = googleDriveListInputSchema.safeParse(input)
	if (!parsedInput.success) {
		return err(new LenaError('invalid_input'))
	}
	const pageSize = parsedInput.data.pageSize ?? 100
	const pageToken = parsedInput.data.pageToken ?? null
	return createTransportListPlan(vaultId, 'google-drive', pageToken).map(
		(transport) =>
			Object.freeze({
				folder: 'appDataFolder' as const,
				pageSize,
				pageToken: transport.continuationToken,
				prefix: transport.prefix,
				readOnly: transport.readOnly,
				requiredScope: 'drive.appdata' as const
			})
	)
}

export function createGoogleDriveInspectPlan(
	providerObjectId: string
): Result<GoogleDriveExactObjectPlan, LenaError> {
	const parsedObjectId =
		googleDriveProviderObjectIdSchema.safeParse(providerObjectId)
	return parsedObjectId.success
		? ok(
				Object.freeze({
					folder: 'appDataFolder' as const,
					providerObjectId: parsedObjectId.data,
					requiredScope: 'drive.appdata' as const
				})
			)
		: err(new LenaError('invalid_input'))
}

export function reconcileGoogleDriveUploadConflict(
	plan: GoogleDriveImmutableUploadPlan,
	target: GoogleDriveConflictTarget,
	receipt: RemoteObjectReceipt
): Result<RemoteObjectReceipt, LenaError> {
	const parsedTarget = googleDriveConflictTargetSchema.safeParse(target)
	const transport = transportUploadPlan(plan)
	if (!parsedTarget.success || transport === null)
		return err(new LenaError('conflict'))
	return reconcileImmutableTransportConflict(
		transport,
		{
			providerObjectId: parsedTarget.data.providerObjectId,
			remotePath: parsedTarget.data.remotePath
		},
		receipt
	)
}

export function createGoogleDriveDownloadPlan(
	manifest: GenerationManifest,
	verification: VerifiedGeneration,
	stagingCiphertextUri: string
): Result<GoogleDriveDownloadPlan, LenaError> {
	return createTransportDownloadPlan(
		manifest,
		verification,
		'google-drive',
		stagingCiphertextUri
	).map((transport) =>
		Object.freeze({
			expectedObjectByteLength: transport.expectedObjectByteLength,
			expectedObjectChecksum: transport.expectedObjectChecksum,
			folder: 'appDataFolder' as const,
			providerObjectId: transport.providerObjectId,
			requiredScope: 'drive.appdata' as const,
			stagingCiphertextUri: transport.stagingCiphertextUri
		})
	)
}

export function createGoogleDriveDeletePlan(
	manifest: GenerationManifest,
	verification: VerifiedGeneration,
	retention: RetentionPlan
): Result<GoogleDriveDeletePlan, LenaError> {
	const transport = createTransportDeletePlan(
		manifest,
		verification,
		retention,
		'google-drive'
	)
	if (transport.isErr()) return err(transport.error)
	const plan: GoogleDriveDeletePlan = {
		[googleDriveDeletePlanMarker]: transport.value,
		authorizedByRetention: true as const,
		executionAuthorized: false as const,
		expectedObjectByteLength: transport.value.expectedObjectByteLength,
		expectedObjectChecksum: transport.value.expectedObjectChecksum,
		folder: 'appDataFolder' as const,
		generationId: transport.value.generationId,
		provider: 'google-drive' as const,
		providerObjectId: transport.value.providerObjectId,
		requiredScope: 'drive.appdata' as const,
		vaultId: transport.value.vaultId
	}
	Object.defineProperty(plan, googleDriveDeletePlanMarker, {
		configurable: false,
		enumerable: false,
		value: transport.value,
		writable: false
	})
	return ok(Object.freeze(plan))
}

export function createGoogleDriveResumeUploadPlan(
	upload: GoogleDriveImmutableUploadPlan,
	checkpoint: GoogleDriveResumableCheckpoint
): Result<GoogleDriveResumeUploadPlan, LenaError> {
	const parsedCheckpoint =
		googleDriveResumableCheckpointSchema.safeParse(checkpoint)
	if (
		!parsedCheckpoint.success ||
		!isAuthorizedGoogleDriveImmutableUploadPlan(upload) ||
		parsedCheckpoint.data.claimId !== upload.claimId ||
		parsedCheckpoint.data.vaultId !== upload.vaultId ||
		parsedCheckpoint.data.generationId !== upload.generationId ||
		parsedCheckpoint.data.localCiphertextUri !== upload.localCiphertextUri ||
		parsedCheckpoint.data.remotePath !== upload.remotePath ||
		parsedCheckpoint.data.expectedObjectChecksum !==
			upload.expectedObjectChecksum ||
		parsedCheckpoint.data.expectedObjectByteLength !==
			upload.expectedObjectByteLength ||
		parsedCheckpoint.data.committedByteLength > upload.expectedObjectByteLength
	) {
		return err(
			new LenaError('invalid_input', { boundary: 'google_drive_checkpoint' })
		)
	}
	return ok(
		Object.freeze({
			checkpoint: parsedCheckpoint.data,
			remainingByteLength:
				upload.expectedObjectByteLength -
				parsedCheckpoint.data.committedByteLength,
			upload
		})
	)
}

export function classifyGoogleDriveFailure(
	code: GoogleDriveFailureCode
): BackupTransportFailure {
	return match(code)
		.with('account-changed', 'token-expired', () =>
			transportFailure('authentication-required')
		)
		.with('cancelled', () => transportFailure('cancelled'))
		.with('conflict', () => transportFailure('conflict'))
		.with('not-found', () => transportFailure('not-found'))
		.with('quota', () => transportFailure('quota-exceeded'))
		.with('rate-limited', () => transportFailure('retryable'))
		.with('unknown', () => transportFailure('fatal'))
		.exhaustive()
}

export function classifyUnknownGoogleDriveFailure(
	code: unknown
): BackupTransportFailure {
	const parsed = googleDriveFailureCodeSchema.safeParse(code)
	return parsed.success
		? classifyGoogleDriveFailure(parsed.data)
		: transportFailure('fatal')
}
