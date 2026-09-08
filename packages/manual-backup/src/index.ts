import {
	MAX_BACKUP_BYTE_LENGTH,
	getRuntimeLocalCiphertextUri,
	isRuntimeVerifiedGeneration,
	type GenerationManifest,
	type VerifiedGeneration
} from '@lena-inc/backup'
import {
	err,
	generationIdSchema,
	LenaError,
	lenaErrorCodeSchema,
	ok,
	type Result
} from '@lena-inc/core'
import { match, P } from 'ts-pattern'
import { z } from 'zod'

export const LENA_BACKUP_EXTENSION = '.lena' as const
export const LENA_BACKUP_MEDIA_TYPE = 'application/vnd.lena.backup' as const
export const SUPPORTED_MANUAL_ENVELOPE_VERSION = 1 as const

const MANUAL_BACKUP_FILE_NAME_PATTERN =
	/^lena-backup-(\d{4})(\d{2})(\d{2})-([0-9a-f-]{36})\.lena$/i

export const manualBackupCompletedDateSchema = z.iso.date()

export const manualBackupFileIdentitySchema = z
	.strictObject({
		completedDate: manualBackupCompletedDateSchema,
		generationId: generationIdSchema
	})
	.readonly()

export type ManualBackupFileIdentity = z.infer<
	typeof manualBackupFileIdentitySchema
>

export const manualBackupFileNameSchema = z
	.string()
	.max(160)
	.transform((fileName, context): ManualBackupFileIdentity => {
		const parts = MANUAL_BACKUP_FILE_NAME_PATTERN.exec(fileName)
		if (parts === null) {
			context.addIssue({
				code: 'custom',
				message: 'invalid_manual_backup_file_name'
			})
			return z.NEVER
		}

		const [, year, month, day, rawGenerationId] = parts
		const completedDate = `${year}-${month}-${day}`
		const parsedDate = manualBackupCompletedDateSchema.safeParse(completedDate)
		const generationId = generationIdSchema.safeParse(rawGenerationId)
		if (!parsedDate.success || !generationId.success) {
			context.addIssue({
				code: 'custom',
				message: 'invalid_manual_backup_identity'
			})
			return z.NEVER
		}

		return Object.freeze({
			completedDate,
			generationId: generationId.data
		})
	})

const manualBackupFileNameInputSchema = z
	.string()
	.max(160)
	.refine((fileName) => manualBackupFileNameSchema.safeParse(fileName).success)

export const manualBackupImportMetadataSchema = z
	.strictObject({
		byteLength: z.int().min(1).max(MAX_BACKUP_BYTE_LENGTH),
		detectedEnvelopeVersion: z.literal(SUPPORTED_MANUAL_ENVELOPE_VERSION),
		fileName: manualBackupFileNameInputSchema,
		mediaType: z
			.enum([LENA_BACKUP_MEDIA_TYPE, 'application/octet-stream'])
			.nullable()
	})
	.readonly()

export type ManualBackupImportMetadata = z.input<
	typeof manualBackupImportMetadataSchema
>

const stagingCiphertextUriSchema = z
	.string()
	.max(2_048)
	.refine((value) => value.trim().length > 0 && !/[\r\n]/.test(value))

export const manualBackupImportAttemptSchema = z
	.discriminatedUnion('state', [
		z.strictObject({
			identity: manualBackupFileIdentitySchema,
			metadata: manualBackupImportMetadataSchema,
			state: z.literal('selected')
		}),
		z.strictObject({
			identity: manualBackupFileIdentitySchema,
			metadata: manualBackupImportMetadataSchema,
			state: z.literal('copying')
		}),
		z.strictObject({
			identity: manualBackupFileIdentitySchema,
			stagingCiphertextUri: stagingCiphertextUriSchema,
			state: z.literal('copied-to-staging')
		}),
		z.strictObject({ state: z.literal('cancelled') }),
		z.strictObject({
			failureCode: lenaErrorCodeSchema,
			state: z.literal('failed')
		})
	])
	.readonly()

export type ManualBackupImportAttempt = z.infer<
	typeof manualBackupImportAttemptSchema
>

export const manualBackupImportEventSchema = z.discriminatedUnion('type', [
	z.strictObject({ type: z.literal('begin-copy') }),
	z.strictObject({
		byteLength: z.int().nonnegative(),
		stagingCiphertextUri: stagingCiphertextUriSchema,
		type: z.literal('record-copy')
	}),
	z.strictObject({ type: z.literal('cancel') }),
	z.strictObject({
		failureCode: lenaErrorCodeSchema,
		type: z.literal('fail')
	})
])

export type ManualBackupImportEvent = z.infer<
	typeof manualBackupImportEventSchema
>

export interface ManualBackupExportDescriptor {
	readonly encrypted: true
	readonly mediaType: typeof LENA_BACKUP_MEDIA_TYPE
	readonly objectByteLength: number
	readonly objectChecksum: VerifiedGeneration['objectChecksum']
	readonly sourceCiphertextUri: string
	readonly suggestedFileName: string
}

export function parseManualBackupFileName(
	fileName: unknown
): Result<ManualBackupFileIdentity, LenaError> {
	const parsed = manualBackupFileNameSchema.safeParse(fileName)
	if (!parsed.success) {
		return err(new LenaError('invalid_input'))
	}

	return ok(parsed.data)
}

export function createManualBackupExportDescriptor(
	manifest: GenerationManifest,
	verification: VerifiedGeneration
): Result<ManualBackupExportDescriptor, LenaError> {
	const sourceCiphertextUri = getRuntimeLocalCiphertextUri(verification)
	if (
		!isRuntimeVerifiedGeneration(verification) ||
		verification.kind !== 'local' ||
		verification.generationId !== manifest.generationId ||
		verification.vaultId !== manifest.vaultId ||
		sourceCiphertextUri === null
	) {
		return err(new LenaError('integrity_failed'))
	}
	const date = manifest.completedAt.slice(0, 10).replaceAll('-', '')
	return ok(
		Object.freeze({
			encrypted: true as const,
			mediaType: LENA_BACKUP_MEDIA_TYPE,
			objectByteLength: verification.objectByteLength,
			objectChecksum: verification.objectChecksum,
			sourceCiphertextUri,
			suggestedFileName: `lena-backup-${date}-${manifest.generationId}${LENA_BACKUP_EXTENSION}`
		})
	)
}

export function preflightManualBackupImport(
	metadata: unknown
): Result<ManualBackupImportMetadata, LenaError> {
	const parsed = manualBackupImportMetadataSchema.safeParse(metadata)
	if (!parsed.success) {
		return err(new LenaError('invalid_input'))
	}

	return ok(parsed.data)
}

export function createManualBackupImportAttempt(
	metadata: unknown
): Result<ManualBackupImportAttempt, LenaError> {
	const screened = preflightManualBackupImport(metadata)
	if (screened.isErr()) return err(screened.error)
	const identity = parseManualBackupFileName(screened.value.fileName)
	if (identity.isErr()) return err(identity.error)

	return ok(
		Object.freeze({
			identity: identity.value,
			metadata: screened.value,
			state: 'selected' as const
		})
	)
}

export function reduceManualBackupImportAttempt(
	attempt: ManualBackupImportAttempt,
	event: ManualBackupImportEvent
): Result<ManualBackupImportAttempt, LenaError> {
	const parsedAttempt = manualBackupImportAttemptSchema.safeParse(attempt)
	const parsedEvent = manualBackupImportEventSchema.safeParse(event)
	if (!parsedAttempt.success || !parsedEvent.success) {
		return err(new LenaError('invalid_input'))
	}

	return match([parsedAttempt.data, parsedEvent.data] as const)
		.with([{ state: 'selected' }, { type: 'begin-copy' }], ([selected]) =>
			ok(Object.freeze({ ...selected, state: 'copying' as const }))
		)
		.with([{ state: P.union('selected', 'copying') }, { type: 'cancel' }], () =>
			ok(Object.freeze({ state: 'cancelled' as const }))
		)
		.with(
			[{ state: P.union('selected', 'copying') }, { type: 'fail' }],
			([, failed]) =>
				ok(
					Object.freeze({
						failureCode: failed.failureCode,
						state: 'failed' as const
					})
				)
		)
		.with(
			[{ state: 'copying' }, { type: 'record-copy' }],
			([copying, copied]) => {
				if (copied.byteLength !== copying.metadata.byteLength) {
					return err(new LenaError('integrity_failed'))
				}

				return ok(
					Object.freeze({
						identity: copying.identity,
						stagingCiphertextUri: copied.stagingCiphertextUri,
						state: 'copied-to-staging' as const
					})
				)
			}
		)
		.otherwise(([current, nextEvent]) =>
			err(
				new LenaError('invalid_state_transition', {
					event: nextEvent.type,
					state: current.state
				})
			)
		)
}

/**
 * Runs only after the encrypted envelope has authenticated and its manifest has
 * passed backup-core parsing. Picker metadata alone is never trusted.
 */
export function validateManualBackupFileIdentity(
	fileName: unknown,
	manifest: GenerationManifest
): Result<ManualBackupFileIdentity, LenaError> {
	const identity = parseManualBackupFileName(fileName)
	if (identity.isErr()) return err(identity.error)
	if (
		identity.value.generationId !== manifest.generationId ||
		identity.value.completedDate !== manifest.completedAt.slice(0, 10)
	) {
		return err(new LenaError('integrity_failed'))
	}

	return identity
}
