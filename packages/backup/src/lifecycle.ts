import {
	compareIsoTimestamps,
	effectIdSchema,
	err,
	generationIdSchema,
	isoTimestampSchema,
	LenaError,
	ok,
	vaultIdSchema,
	type EffectId,
	type GenerationId,
	type IsoTimestamp,
	type Result,
	type VaultId
} from '@lena-inc/core'
import { match, P } from 'ts-pattern'
import { z } from 'zod'
import { sha256ChecksumSchema, type Sha256Checksum } from './checksum'
import {
	isRuntimeRemoteObjectReceipt,
	parseRemoteBackupProvider,
	persistedGenerationVerificationClaimSchema,
	remoteBackupProviderSchema,
	type RemoteObjectReceipt,
	type RemoteBackupProvider,
	type PersistedGenerationVerificationClaim,
	type VerifiedGeneration
} from './transport'
import { createRuntimeRemoteVerifiedGeneration } from './runtime-evidence'

export const backupFailureCodeSchema = z.enum([
	'cancelled',
	'filesystem-unavailable',
	'insufficient-space',
	'integrity-check-failed',
	'network-unavailable',
	'remote-authentication-required',
	'remote-conflict',
	'remote-not-found',
	'remote-quota-exceeded',
	'remote-rejected',
	'unexpected'
])

export type BackupFailureCode = z.infer<typeof backupFailureCodeSchema>

const backupObjectByteLengthSchema = z
	.number()
	.int()
	.refine(Number.isSafeInteger)
	.min(0)

const remoteObjectIdSchema = z
	.string()
	.max(512)
	.refine((value) => value.trim().length > 0 && !/[\r\n]/.test(value))

const remoteObjectPathSchema = z
	.string()
	.max(1_024)
	.refine((value) => value.trim().length > 0 && !/[\r\n]/.test(value))

interface BackupAttemptBase {
	readonly generationId: GenerationId
	readonly updatedAt: IsoTimestamp
	readonly vaultId: VaultId
}

export const backupResumeCheckpointSchema = z
	.discriminatedUnion('state', [
		z.strictObject({ state: z.literal('prepared') }),
		z.strictObject({
			objectByteLength: backupObjectByteLengthSchema,
			objectChecksum: sha256ChecksumSchema,
			state: z.literal('local-verified')
		}),
		z.strictObject({
			objectByteLength: backupObjectByteLengthSchema,
			objectChecksum: sha256ChecksumSchema,
			provider: remoteBackupProviderSchema,
			state: z.literal('upload-pending')
		})
	])
	.readonly()

type BackupResumeCheckpoint = z.infer<typeof backupResumeCheckpointSchema>

export type BackupAttempt =
	| (BackupAttemptBase & { readonly state: 'prepared' })
	| (BackupAttemptBase & { readonly state: 'writing' })
	| (BackupAttemptBase & {
			readonly objectByteLength: number
			readonly objectChecksum: Sha256Checksum
			readonly state: 'local-verified'
	  })
	| (BackupAttemptBase & {
			readonly objectByteLength: number
			readonly objectChecksum: Sha256Checksum
			readonly provider: RemoteBackupProvider
			readonly state: 'upload-pending'
	  })
	| (BackupAttemptBase & {
			readonly claimId: EffectId
			readonly objectByteLength: number
			readonly objectChecksum: Sha256Checksum
			readonly provider: RemoteBackupProvider
			readonly state: 'uploading'
	  })
	| (BackupAttemptBase & {
			readonly claimId: EffectId
			readonly objectByteLength: number
			readonly objectChecksum: Sha256Checksum
			readonly provider: RemoteBackupProvider
			readonly remoteObjectId: string
			readonly remoteObjectPath: string
			readonly state: 'remote-uploaded'
	  })
	| (BackupAttemptBase & {
			readonly state: 'verified'
			readonly verification:
				| VerifiedGeneration
				| PersistedGenerationVerificationClaim
	  })
	| (BackupAttemptBase & {
			readonly failureCode: BackupFailureCode
			readonly resume: BackupResumeCheckpoint
			readonly state: 'failed'
	  })

export type BackupAttemptEvent =
	| Readonly<{ at: IsoTimestamp; type: 'begin-write' }>
	| Readonly<{
			at: IsoTimestamp
			objectByteLength: number
			objectChecksum: Sha256Checksum
			type: 'verify-local'
	  }>
	| Readonly<{
			at: IsoTimestamp
			provider: RemoteBackupProvider
			type: 'queue-upload'
	  }>
	| Readonly<{
			at: IsoTimestamp
			claimId: EffectId
			type: 'claim-upload'
	  }>
	| Readonly<{
			at: IsoTimestamp
			claimId: EffectId
			remoteObjectId: string
			remoteObjectPath: string
			type: 'record-upload'
	  }>
	| Readonly<{
			at: IsoTimestamp
			claimId: EffectId
			receipt: RemoteObjectReceipt
			sourceVerification: VerifiedGeneration
			type: 'verify-remote'
	  }>
	| Readonly<{ at: IsoTimestamp; failureCode: BackupFailureCode; type: 'fail' }>
	| Readonly<{ at: IsoTimestamp; type: 'retry' }>

const backupAttemptBaseShape = {
	generationId: generationIdSchema,
	updatedAt: isoTimestampSchema,
	vaultId: vaultIdSchema
}

const localVerifiedShape = {
	objectByteLength: backupObjectByteLengthSchema,
	objectChecksum: sha256ChecksumSchema
}

const uploadShape = {
	...localVerifiedShape,
	provider: remoteBackupProviderSchema
}

export const backupAttemptSchema = z
	.discriminatedUnion('state', [
		z.strictObject({ ...backupAttemptBaseShape, state: z.literal('prepared') }),
		z.strictObject({ ...backupAttemptBaseShape, state: z.literal('writing') }),
		z.strictObject({
			...backupAttemptBaseShape,
			...localVerifiedShape,
			state: z.literal('local-verified')
		}),
		z.strictObject({
			...backupAttemptBaseShape,
			...uploadShape,
			state: z.literal('upload-pending')
		}),
		z.strictObject({
			...backupAttemptBaseShape,
			...uploadShape,
			claimId: effectIdSchema,
			state: z.literal('uploading')
		}),
		z.strictObject({
			...backupAttemptBaseShape,
			...uploadShape,
			claimId: effectIdSchema,
			remoteObjectId: remoteObjectIdSchema,
			remoteObjectPath: remoteObjectPathSchema,
			state: z.literal('remote-uploaded')
		}),
		z.strictObject({
			...backupAttemptBaseShape,
			state: z.literal('verified'),
			verification: persistedGenerationVerificationClaimSchema
		}),
		z.strictObject({
			...backupAttemptBaseShape,
			failureCode: backupFailureCodeSchema,
			resume: backupResumeCheckpointSchema,
			state: z.literal('failed')
		})
	])
	.superRefine((attempt, context) => {
		if (
			attempt.state === 'verified' &&
			(attempt.verification.generationId !== attempt.generationId ||
				attempt.verification.vaultId !== attempt.vaultId ||
				attempt.verification.verifiedAt !== attempt.updatedAt)
		) {
			context.addIssue({
				code: 'custom',
				message: 'verification_does_not_match_checkpoint',
				path: ['verification']
			})
		}
	})
	.readonly()

export type PersistedBackupAttempt = z.infer<typeof backupAttemptSchema>

const runtimeClaimedBackupAttempts = new WeakSet()

export function isRuntimeClaimedBackupAttempt(
	value: unknown
): value is Extract<BackupAttempt, { state: 'remote-uploaded' | 'uploading' }> {
	return (
		typeof value === 'object' &&
		value !== null &&
		runtimeClaimedBackupAttempts.has(value)
	)
}

export function createBackupAttempt(input: {
	createdAt: IsoTimestamp
	generationId: GenerationId
	vaultId: VaultId
}): BackupAttempt {
	return Object.freeze({
		generationId: input.generationId,
		state: 'prepared',
		updatedAt: input.createdAt,
		vaultId: input.vaultId
	})
}

function invalidBackupTransition(
	state: BackupAttempt['state'],
	event: BackupAttemptEvent['type']
): Result<never, LenaError> {
	return err(new LenaError('invalid_state_transition', { event, state }))
}

function validObjectByteLength(value: number): boolean {
	return Number.isSafeInteger(value) && value >= 0
}

function validRemoteObjectId(value: string): boolean {
	return value.trim().length > 0 && value.length <= 512 && !/[\r\n]/.test(value)
}

function validRemoteObjectPath(value: string): boolean {
	return (
		value.trim().length > 0 && value.length <= 1_024 && !/[\r\n]/.test(value)
	)
}

export function reduceBackupAttempt(
	attempt: BackupAttempt,
	event: BackupAttemptEvent
): Result<BackupAttempt, LenaError> {
	if (compareIsoTimestamps(event.at, attempt.updatedAt) < 0) {
		return err(new LenaError('invalid_timestamp'))
	}
	const base = {
		generationId: attempt.generationId,
		updatedAt: event.at,
		vaultId: attempt.vaultId
	}

	return match(event)
		.with({ type: 'begin-write' }, (nextEvent) =>
			attempt.state === 'prepared'
				? ok(Object.freeze({ ...base, state: 'writing' as const }))
				: invalidBackupTransition(attempt.state, nextEvent.type)
		)
		.with({ type: 'verify-local' }, (nextEvent) => {
			if (attempt.state !== 'writing') {
				return invalidBackupTransition(attempt.state, nextEvent.type)
			}
			if (!validObjectByteLength(nextEvent.objectByteLength)) {
				return err(new LenaError('invalid_input'))
			}
			return ok(
				Object.freeze({
					...base,
					objectByteLength: nextEvent.objectByteLength,
					objectChecksum: nextEvent.objectChecksum,
					state: 'local-verified' as const
				})
			)
		})
		.with({ type: 'queue-upload' }, (nextEvent) => {
			if (attempt.state !== 'local-verified') {
				return invalidBackupTransition(attempt.state, nextEvent.type)
			}
			const provider = parseRemoteBackupProvider(nextEvent.provider)
			if (provider.isErr()) return err(provider.error)
			return ok(
				Object.freeze({
					...base,
					objectByteLength: attempt.objectByteLength,
					objectChecksum: attempt.objectChecksum,
					provider: provider.value,
					state: 'upload-pending' as const
				})
			)
		})
		.with({ type: 'claim-upload' }, (nextEvent) => {
			if (attempt.state !== 'upload-pending') {
				return invalidBackupTransition(attempt.state, nextEvent.type)
			}
			const claimed = Object.freeze({
				...base,
				claimId: nextEvent.claimId,
				objectByteLength: attempt.objectByteLength,
				objectChecksum: attempt.objectChecksum,
				provider: attempt.provider,
				state: 'uploading' as const
			})
			runtimeClaimedBackupAttempts.add(claimed)
			return ok(claimed)
		})
		.with({ type: 'record-upload' }, (nextEvent) => {
			if (attempt.state !== 'uploading') {
				return invalidBackupTransition(attempt.state, nextEvent.type)
			}
			if (!isRuntimeClaimedBackupAttempt(attempt)) {
				return err(new LenaError('integrity_failed'))
			}
			if (nextEvent.claimId !== attempt.claimId) {
				return err(new LenaError('conflict'))
			}
			if (!validRemoteObjectId(nextEvent.remoteObjectId)) {
				return err(new LenaError('invalid_input'))
			}
			if (!validRemoteObjectPath(nextEvent.remoteObjectPath)) {
				return err(new LenaError('invalid_input'))
			}
			if (
				nextEvent.remoteObjectPath !==
				`vaults/${attempt.vaultId}/generations/${attempt.generationId}.lena`
			) {
				return err(new LenaError('conflict'))
			}
			const uploaded = Object.freeze({
				...base,
				claimId: attempt.claimId,
				objectByteLength: attempt.objectByteLength,
				objectChecksum: attempt.objectChecksum,
				provider: attempt.provider,
				remoteObjectId: nextEvent.remoteObjectId,
				remoteObjectPath: nextEvent.remoteObjectPath,
				state: 'remote-uploaded' as const
			})
			runtimeClaimedBackupAttempts.add(uploaded)
			return ok(uploaded)
		})
		.with({ type: 'verify-remote' }, (nextEvent) => {
			if (attempt.state !== 'remote-uploaded') {
				return invalidBackupTransition(attempt.state, nextEvent.type)
			}
			if (nextEvent.claimId !== attempt.claimId) {
				return err(new LenaError('conflict'))
			}
			if (!isRuntimeClaimedBackupAttempt(attempt)) {
				return err(new LenaError('integrity_failed'))
			}
			if (!isRuntimeRemoteObjectReceipt(nextEvent.receipt)) {
				return err(new LenaError('integrity_failed'))
			}
			if (nextEvent.receipt.verifiedAt !== nextEvent.at) {
				return err(new LenaError('integrity_failed'))
			}
			const verification = createRuntimeRemoteVerifiedGeneration({
				activeClaimId: attempt.claimId,
				expectedGenerationId: attempt.generationId,
				expectedObjectByteLength: attempt.objectByteLength,
				expectedObjectChecksum: attempt.objectChecksum,
				expectedProvider: attempt.provider,
				expectedProviderObjectId: attempt.remoteObjectId,
				expectedProviderObjectPath: attempt.remoteObjectPath,
				expectedVaultId: attempt.vaultId,
				receipt: nextEvent.receipt,
				sourceVerification: nextEvent.sourceVerification
			})
			if (verification.isErr()) return err(verification.error)
			return ok(
				Object.freeze({
					...base,
					state: 'verified' as const,
					verification: verification.value
				})
			)
		})
		.with({ type: 'fail' }, (nextEvent) => {
			if (!backupFailureCodeSchema.safeParse(nextEvent.failureCode).success) {
				return err(new LenaError('invalid_input'))
			}
			const resume = getBackupResumeCheckpoint(attempt)
			if (resume === null) {
				return invalidBackupTransition(attempt.state, nextEvent.type)
			}
			return ok(
				Object.freeze({
					...base,
					failureCode: nextEvent.failureCode,
					resume,
					state: 'failed' as const
				})
			)
		})
		.with({ type: 'retry' }, (nextEvent) => {
			if (attempt.state !== 'failed') {
				return invalidBackupTransition(attempt.state, nextEvent.type)
			}
			return match(attempt.resume)
				.with({ state: 'prepared' }, () =>
					ok(Object.freeze({ ...base, state: 'prepared' as const }))
				)
				.with({ state: 'local-verified' }, (resume) =>
					ok(
						Object.freeze({
							...base,
							objectByteLength: resume.objectByteLength,
							objectChecksum: resume.objectChecksum,
							state: 'local-verified' as const
						})
					)
				)
				.with({ state: 'upload-pending' }, (resume) =>
					ok(
						Object.freeze({
							...base,
							objectByteLength: resume.objectByteLength,
							objectChecksum: resume.objectChecksum,
							provider: resume.provider,
							state: 'upload-pending' as const
						})
					)
				)
				.exhaustive()
		})
		.exhaustive()
}

function getBackupResumeCheckpoint(
	attempt: BackupAttempt
): BackupResumeCheckpoint | null {
	return match(attempt)
		.with({ state: P.union('prepared', 'writing') }, () =>
			Object.freeze({ state: 'prepared' as const })
		)
		.with({ state: 'local-verified' }, (current) =>
			Object.freeze({
				objectByteLength: current.objectByteLength,
				objectChecksum: current.objectChecksum,
				state: 'local-verified' as const
			})
		)
		.with(
			{ state: P.union('upload-pending', 'uploading', 'remote-uploaded') },
			(current) =>
				Object.freeze({
					objectByteLength: current.objectByteLength,
					objectChecksum: current.objectChecksum,
					provider: current.provider,
					state: 'upload-pending' as const
				})
		)
		.with({ state: P.union('failed', 'verified') }, () => null)
		.exhaustive()
}

/**
 * Parses durable lifecycle state only. Parsed uploading states never receive runtime claim authority.
 */
export function parseBackupAttempt(
	value: unknown
): Result<BackupAttempt, LenaError> {
	const parsed = backupAttemptSchema.safeParse(value)
	if (!parsed.success) {
		return err(new LenaError('invalid_input'))
	}

	return ok(parsed.data)
}
