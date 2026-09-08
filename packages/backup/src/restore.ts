import {
	compareIsoTimestamps,
	err,
	generationIdSchema,
	isoTimestampSchema,
	LenaError,
	ok,
	schemaVersionSchema,
	vaultIdSchema,
	vaultInstanceIdSchema,
	type IsoTimestamp,
	type Result,
	type SchemaVersion,
	type VaultInstanceId
} from '@lena-inc/core'
import { match } from 'ts-pattern'
import { z } from 'zod'
import { sha256ChecksumSchema } from './checksum'
import {
	isRuntimeValidatedRestoreCandidate,
	type ValidatedRestoreCandidate
} from './discovery'

export const restoreFailureCodeSchema = z.enum([
	'cancelled',
	'decryption-failed',
	'incompatible-schema',
	'insufficient-space',
	'integrity-check-failed',
	'manifest-invalid',
	'post-open-verification-failed',
	'staging-build-failed',
	'unexpected',
	'wrong-vault'
])

export type RestoreFailureCode = z.infer<typeof restoreFailureCodeSchema>

export const activePointerUnknownCodeSchema = z.enum([
	'activation-outcome-unknown',
	'rollback-outcome-unknown'
])

export type ActivePointerUnknownCode = z.infer<
	typeof activePointerUnknownCodeSchema
>

const restoreByteLengthSchema = z
	.number()
	.int()
	.refine(Number.isSafeInteger)
	.min(0)

const restoreGenerationBindingShape = {
	contentByteLength: restoreByteLengthSchema,
	contentChecksum: sha256ChecksumSchema,
	generationId: generationIdSchema,
	objectByteLength: restoreByteLengthSchema,
	objectChecksum: sha256ChecksumSchema,
	schemaVersion: schemaVersionSchema,
	vaultId: vaultIdSchema
}

export const restoreGenerationBindingSchema = z
	.strictObject(restoreGenerationBindingShape)
	.readonly()

export type RestoreGenerationBinding = z.infer<
	typeof restoreGenerationBindingSchema
>

type RestoreBase = RestoreGenerationBinding & {
	readonly previousInstanceId: VaultInstanceId | null
	readonly targetSchemaVersion: SchemaVersion
	readonly updatedAt: IsoTimestamp
}

type StagedRestoreBase = RestoreBase & {
	readonly stagingInstanceId: VaultInstanceId
}

export type RestoreAttempt =
	| (RestoreBase & { readonly state: 'discovered' })
	| (RestoreBase & { readonly state: 'staging' })
	| (RestoreBase & { readonly state: 'decrypted' })
	| (RestoreBase & { readonly state: 'manifest-validated' })
	| (StagedRestoreBase & { readonly state: 'vault-built' })
	| (StagedRestoreBase & { readonly state: 'ready-to-activate' })
	| (StagedRestoreBase & { readonly state: 'activating' })
	| (StagedRestoreBase & { readonly state: 'activated' })
	| (StagedRestoreBase & {
			readonly state: 'verified'
			readonly verifiedAt: IsoTimestamp
	  })
	| (StagedRestoreBase & { readonly state: 'rolling-back' })
	| (StagedRestoreBase & { readonly state: 'rolled-back' })
	| (StagedRestoreBase & {
			readonly failureCode: 'rollback-failed'
			readonly state: 'rollback-failed'
	  })
	| (StagedRestoreBase & {
			readonly failureCode: ActivePointerUnknownCode
			readonly state: 'active-pointer-unknown'
	  })
	| (RestoreBase & {
			readonly activePointerState: 'unchanged'
			readonly failureCode: RestoreFailureCode
			readonly state: 'failed'
	  })

export type RestoreEvent =
	| Readonly<{ at: IsoTimestamp; type: 'begin-staging' }>
	| Readonly<{ at: IsoTimestamp; type: 'record-decrypted' }>
	| Readonly<{
			at: IsoTimestamp
			binding: RestoreGenerationBinding
			type: 'record-manifest-valid'
	  }>
	| Readonly<{
			at: IsoTimestamp
			binding: RestoreGenerationBinding
			stagingInstanceId: VaultInstanceId
			type: 'record-vault-built'
	  }>
	| Readonly<{
			/** The keyed staging vault reached targetSchemaVersion and passed integrity checks. */
			at: IsoTimestamp
			targetSchemaVersion: SchemaVersion
			type: 'record-ready'
	  }>
	| Readonly<{ at: IsoTimestamp; type: 'begin-activation' }>
	| Readonly<{
			activeInstanceId: VaultInstanceId
			at: IsoTimestamp
			type: 'record-activated'
	  }>
	| Readonly<{
			activeInstanceId: VaultInstanceId
			at: IsoTimestamp
			binding: RestoreGenerationBinding
			type: 'record-post-open-verified'
	  }>
	| Readonly<{ at: IsoTimestamp; type: 'begin-rollback' }>
	| Readonly<{
			activeInstanceId: VaultInstanceId | null
			at: IsoTimestamp
			type: 'record-rolled-back'
	  }>
	| Readonly<{ at: IsoTimestamp; type: 'record-rollback-failed' }>
	| Readonly<{
			at: IsoTimestamp
			failureCode: ActivePointerUnknownCode
			type: 'record-active-pointer-unknown'
	  }>
	| Readonly<{
			at: IsoTimestamp
			failureCode: RestoreFailureCode
			type: 'fail'
	  }>

const restoreAttemptBaseShape = {
	...restoreGenerationBindingShape,
	previousInstanceId: vaultInstanceIdSchema.nullable(),
	targetSchemaVersion: schemaVersionSchema,
	updatedAt: isoTimestampSchema
}

const stagedRestoreAttemptShape = {
	...restoreAttemptBaseShape,
	stagingInstanceId: vaultInstanceIdSchema
}

export const restoreAttemptSchema = z
	.discriminatedUnion('state', [
		z.strictObject({
			...restoreAttemptBaseShape,
			state: z.literal('discovered')
		}),
		z.strictObject({ ...restoreAttemptBaseShape, state: z.literal('staging') }),
		z.strictObject({
			...restoreAttemptBaseShape,
			state: z.literal('decrypted')
		}),
		z.strictObject({
			...restoreAttemptBaseShape,
			state: z.literal('manifest-validated')
		}),
		z.strictObject({
			...stagedRestoreAttemptShape,
			state: z.literal('vault-built')
		}),
		z.strictObject({
			...stagedRestoreAttemptShape,
			state: z.literal('ready-to-activate')
		}),
		z.strictObject({
			...stagedRestoreAttemptShape,
			state: z.literal('activating')
		}),
		z.strictObject({
			...stagedRestoreAttemptShape,
			state: z.literal('activated')
		}),
		z.strictObject({
			...stagedRestoreAttemptShape,
			state: z.literal('verified'),
			verifiedAt: isoTimestampSchema
		}),
		z.strictObject({
			...stagedRestoreAttemptShape,
			state: z.literal('rolling-back')
		}),
		z.strictObject({
			...stagedRestoreAttemptShape,
			state: z.literal('rolled-back')
		}),
		z.strictObject({
			...stagedRestoreAttemptShape,
			failureCode: z.literal('rollback-failed'),
			state: z.literal('rollback-failed')
		}),
		z.strictObject({
			...stagedRestoreAttemptShape,
			failureCode: activePointerUnknownCodeSchema,
			state: z.literal('active-pointer-unknown')
		}),
		z.strictObject({
			...restoreAttemptBaseShape,
			activePointerState: z.literal('unchanged'),
			failureCode: restoreFailureCodeSchema,
			state: z.literal('failed')
		})
	])
	.superRefine((attempt, context) => {
		if (
			'stagingInstanceId' in attempt &&
			attempt.stagingInstanceId === attempt.previousInstanceId
		) {
			context.addIssue({
				code: 'custom',
				message: 'staging_instance_reuses_live_instance',
				path: ['stagingInstanceId']
			})
		}
		if (
			attempt.state === 'verified' &&
			attempt.verifiedAt !== attempt.updatedAt
		) {
			context.addIssue({
				code: 'custom',
				message: 'verification_timestamp_is_incoherent',
				path: ['verifiedAt']
			})
		}
		if (attempt.schemaVersion > attempt.targetSchemaVersion) {
			context.addIssue({
				code: 'custom',
				message: 'source_schema_is_newer_than_target',
				path: ['schemaVersion']
			})
		}
	})
	.readonly()

export type PersistedRestoreAttempt = z.infer<typeof restoreAttemptSchema>

export function createRestoreAttempt(input: {
	candidate: ValidatedRestoreCandidate
	discoveredAt: IsoTimestamp
	previousInstanceId: VaultInstanceId | null
}): Result<RestoreAttempt, LenaError> {
	if (!isRuntimeValidatedRestoreCandidate(input.candidate)) {
		return err(new LenaError('integrity_failed'))
	}
	return ok(
		Object.freeze({
			contentByteLength: input.candidate.manifest.payload.contentByteLength,
			contentChecksum: input.candidate.manifest.payload.contentChecksum,
			generationId: input.candidate.manifest.generationId,
			objectByteLength: input.candidate.verification.objectByteLength,
			objectChecksum: input.candidate.verification.objectChecksum,
			previousInstanceId: input.previousInstanceId,
			schemaVersion: input.candidate.manifest.schemaVersion,
			state: 'discovered',
			targetSchemaVersion: input.candidate.targetSchemaVersion,
			updatedAt: input.discoveredAt,
			vaultId: input.candidate.manifest.vaultId
		})
	)
}

function invalidRestoreTransition(
	state: RestoreAttempt['state'],
	event: RestoreEvent['type']
): Result<never, LenaError> {
	return err(new LenaError('invalid_state_transition', { event, state }))
}

function bindingMatches(
	attempt: RestoreAttempt,
	binding: RestoreGenerationBinding
): boolean {
	return (
		binding.contentByteLength === attempt.contentByteLength &&
		binding.contentChecksum === attempt.contentChecksum &&
		binding.generationId === attempt.generationId &&
		binding.objectByteLength === attempt.objectByteLength &&
		binding.objectChecksum === attempt.objectChecksum &&
		binding.schemaVersion === attempt.schemaVersion &&
		binding.vaultId === attempt.vaultId
	)
}

function bindingMismatch(): Result<never, LenaError> {
	return err(new LenaError('integrity_failed'))
}

export function reduceRestoreAttempt(
	attempt: RestoreAttempt,
	event: RestoreEvent
): Result<RestoreAttempt, LenaError> {
	if (compareIsoTimestamps(event.at, attempt.updatedAt) < 0) {
		return err(new LenaError('invalid_timestamp'))
	}
	const base: RestoreBase = {
		contentByteLength: attempt.contentByteLength,
		contentChecksum: attempt.contentChecksum,
		generationId: attempt.generationId,
		objectByteLength: attempt.objectByteLength,
		objectChecksum: attempt.objectChecksum,
		previousInstanceId: attempt.previousInstanceId,
		schemaVersion: attempt.schemaVersion,
		targetSchemaVersion: attempt.targetSchemaVersion,
		updatedAt: event.at,
		vaultId: attempt.vaultId
	}

	return match(event)
		.with({ type: 'begin-staging' }, (nextEvent) =>
			attempt.state === 'discovered'
				? ok(Object.freeze({ ...base, state: 'staging' as const }))
				: invalidRestoreTransition(attempt.state, nextEvent.type)
		)
		.with({ type: 'record-decrypted' }, (nextEvent) =>
			attempt.state === 'staging'
				? ok(Object.freeze({ ...base, state: 'decrypted' as const }))
				: invalidRestoreTransition(attempt.state, nextEvent.type)
		)
		.with({ type: 'record-manifest-valid' }, (nextEvent) => {
			if (attempt.state !== 'decrypted') {
				return invalidRestoreTransition(attempt.state, nextEvent.type)
			}
			return bindingMatches(attempt, nextEvent.binding)
				? ok(Object.freeze({ ...base, state: 'manifest-validated' as const }))
				: bindingMismatch()
		})
		.with({ type: 'record-vault-built' }, (nextEvent) => {
			if (attempt.state !== 'manifest-validated') {
				return invalidRestoreTransition(attempt.state, nextEvent.type)
			}
			if (!bindingMatches(attempt, nextEvent.binding)) return bindingMismatch()
			if (nextEvent.stagingInstanceId === attempt.previousInstanceId) {
				return err(new LenaError('conflict'))
			}
			return ok(
				Object.freeze({
					...base,
					stagingInstanceId: nextEvent.stagingInstanceId,
					state: 'vault-built' as const
				})
			)
		})
		.with({ type: 'record-ready' }, (nextEvent) => {
			if (attempt.state !== 'vault-built') {
				return invalidRestoreTransition(attempt.state, nextEvent.type)
			}
			if (nextEvent.targetSchemaVersion !== attempt.targetSchemaVersion) {
				return err(new LenaError('incompatible_schema'))
			}
			return ok(
				Object.freeze({
					...base,
					stagingInstanceId: attempt.stagingInstanceId,
					state: 'ready-to-activate' as const
				})
			)
		})
		.with({ type: 'begin-activation' }, (nextEvent) =>
			attempt.state === 'ready-to-activate'
				? ok(
						Object.freeze({
							...base,
							stagingInstanceId: attempt.stagingInstanceId,
							state: 'activating' as const
						})
					)
				: invalidRestoreTransition(attempt.state, nextEvent.type)
		)
		.with({ type: 'record-activated' }, (nextEvent) => {
			if (attempt.state !== 'activating') {
				return invalidRestoreTransition(attempt.state, nextEvent.type)
			}
			if (nextEvent.activeInstanceId !== attempt.stagingInstanceId) {
				return err(new LenaError('conflict'))
			}
			return ok(
				Object.freeze({
					...base,
					stagingInstanceId: attempt.stagingInstanceId,
					state: 'activated' as const
				})
			)
		})
		.with({ type: 'record-post-open-verified' }, (nextEvent) => {
			if (attempt.state !== 'activated') {
				return invalidRestoreTransition(attempt.state, nextEvent.type)
			}
			if (!bindingMatches(attempt, nextEvent.binding)) return bindingMismatch()
			if (nextEvent.activeInstanceId !== attempt.stagingInstanceId) {
				return err(new LenaError('conflict'))
			}
			return ok(
				Object.freeze({
					...base,
					stagingInstanceId: attempt.stagingInstanceId,
					state: 'verified' as const,
					verifiedAt: nextEvent.at
				})
			)
		})
		.with({ type: 'record-active-pointer-unknown' }, (nextEvent) => {
			if (attempt.state !== 'activating' && attempt.state !== 'rolling-back') {
				return invalidRestoreTransition(attempt.state, nextEvent.type)
			}
			if (
				(attempt.state === 'activating' &&
					nextEvent.failureCode !== 'activation-outcome-unknown') ||
				(attempt.state === 'rolling-back' &&
					nextEvent.failureCode !== 'rollback-outcome-unknown')
			) {
				return err(new LenaError('invalid_input'))
			}
			return ok(
				Object.freeze({
					...base,
					failureCode: nextEvent.failureCode,
					stagingInstanceId: attempt.stagingInstanceId,
					state: 'active-pointer-unknown' as const
				})
			)
		})
		.with({ type: 'begin-rollback' }, (nextEvent) =>
			attempt.state === 'activated' ||
			attempt.state === 'activating' ||
			attempt.state === 'active-pointer-unknown' ||
			attempt.state === 'rollback-failed'
				? ok(
						Object.freeze({
							...base,
							stagingInstanceId: attempt.stagingInstanceId,
							state: 'rolling-back' as const
						})
					)
				: invalidRestoreTransition(attempt.state, nextEvent.type)
		)
		.with({ type: 'record-rolled-back' }, (nextEvent) => {
			if (attempt.state !== 'rolling-back') {
				return invalidRestoreTransition(attempt.state, nextEvent.type)
			}
			if (nextEvent.activeInstanceId !== attempt.previousInstanceId) {
				return err(new LenaError('conflict'))
			}
			return ok(
				Object.freeze({
					...base,
					stagingInstanceId: attempt.stagingInstanceId,
					state: 'rolled-back' as const
				})
			)
		})
		.with({ type: 'record-rollback-failed' }, (nextEvent) =>
			attempt.state === 'rolling-back'
				? ok(
						Object.freeze({
							...base,
							failureCode: 'rollback-failed' as const,
							stagingInstanceId: attempt.stagingInstanceId,
							state: 'rollback-failed' as const
						})
					)
				: invalidRestoreTransition(attempt.state, nextEvent.type)
		)
		.with({ type: 'fail' }, (nextEvent) => {
			if (!restoreFailureCodeSchema.safeParse(nextEvent.failureCode).success) {
				return err(new LenaError('invalid_input'))
			}
			if (
				attempt.state === 'activating' ||
				attempt.state === 'activated' ||
				attempt.state === 'active-pointer-unknown' ||
				attempt.state === 'rolling-back' ||
				attempt.state === 'rollback-failed' ||
				attempt.state === 'verified'
			) {
				return err(
					new LenaError('invalid_state_transition', { state: attempt.state })
				)
			}
			if (attempt.state === 'failed' || attempt.state === 'rolled-back') {
				return invalidRestoreTransition(attempt.state, nextEvent.type)
			}
			return ok(
				Object.freeze({
					...base,
					activePointerState: 'unchanged' as const,
					failureCode: nextEvent.failureCode,
					state: 'failed' as const
				})
			)
		})
		.exhaustive()
}

/**
 * Parses durable restore state only. Structural validation never authorizes pointer activation.
 */
export function parseRestoreAttempt(
	value: unknown
): Result<RestoreAttempt, LenaError> {
	const parsed = restoreAttemptSchema.safeParse(value)
	if (!parsed.success) {
		return err(new LenaError('invalid_input'))
	}

	return ok(parsed.data)
}
