import {
	effectIdSchema,
	err,
	isoTimestampSchema,
	LenaError,
	mutationIdSchema,
	ok,
	type EffectId,
	type IsoTimestamp,
	type MutationId,
	type Result,
	type VaultId,
	type VaultInstanceId,
	vaultIdSchema,
	vaultInstanceIdSchema
} from '@lena-inc/core'
import { z } from 'zod'

export const processedEffectKindSchema = z.literal('backup-obligation')
export type ProcessedEffectKind = z.infer<typeof processedEffectKindSchema>

export const processedEffectRecordSchema = z
	.strictObject({
		effectId: effectIdSchema,
		effectKind: processedEffectKindSchema,
		mutationId: mutationIdSchema,
		processedAt: isoTimestampSchema,
		vaultId: vaultIdSchema,
		vaultInstanceId: vaultInstanceIdSchema
	})
	.readonly()

const processedEffectRecordStructureSchema = z.strictObject({
	effectId: z.unknown(),
	effectKind: z.unknown(),
	mutationId: z.unknown(),
	processedAt: z.unknown(),
	vaultId: z.unknown(),
	vaultInstanceId: z.unknown()
})

export type ProcessedEffectRecord = z.infer<typeof processedEffectRecordSchema>

export type ProcessedEffectDecision =
	| Readonly<{ status: 'already-processed'; record: ProcessedEffectRecord }>
	| Readonly<{ status: 'unprocessed' }>

export function createProcessedEffectRecord(input: {
	effectId: EffectId
	effectKind: ProcessedEffectKind
	mutationId: MutationId
	processedAt: IsoTimestamp
	vaultId: VaultId
	vaultInstanceId: VaultInstanceId
}): ProcessedEffectRecord {
	return Object.freeze({
		effectId: input.effectId,
		effectKind: input.effectKind,
		mutationId: input.mutationId,
		processedAt: input.processedAt,
		vaultId: input.vaultId,
		vaultInstanceId: input.vaultInstanceId
	})
}

export function parseProcessedEffectRecord(
	value: unknown
): Result<ProcessedEffectRecord, LenaError> {
	const structure = processedEffectRecordStructureSchema.safeParse(value)
	if (!structure.success) {
		return err(
			new LenaError('invalid_input', {
				boundary: 'processed_effect'
			})
		)
	}

	const parsed = processedEffectRecordSchema.safeParse(structure.data)
	if (parsed.success) return ok(parsed.data)

	const failedField = parsed.error.issues[0]?.path[0]
	if (failedField === 'effectKind') {
		return err(new LenaError('invalid_input'))
	}
	if (failedField === 'processedAt') {
		return err(new LenaError('invalid_timestamp'))
	}
	if (
		failedField === 'effectId' ||
		failedField === 'mutationId' ||
		failedField === 'vaultId' ||
		failedField === 'vaultInstanceId'
	) {
		const kinds = {
			effectId: 'EffectId',
			mutationId: 'MutationId',
			vaultId: 'VaultId',
			vaultInstanceId: 'VaultInstanceId'
		} as const
		const kind = kinds[failedField]
		return err(new LenaError('invalid_identifier', { kind }))
	}

	return err(
		new LenaError('invalid_input', {
			boundary: 'processed_effect'
		})
	)
}

export function classifyProcessedEffect(
	existing: ProcessedEffectRecord | null,
	expected: Omit<ProcessedEffectRecord, 'processedAt'>
): Result<ProcessedEffectDecision, LenaError> {
	if (existing === null) return ok(Object.freeze({ status: 'unprocessed' }))

	if (
		existing.effectId !== expected.effectId ||
		existing.effectKind !== expected.effectKind ||
		existing.mutationId !== expected.mutationId ||
		existing.vaultId !== expected.vaultId ||
		existing.vaultInstanceId !== expected.vaultInstanceId
	) {
		return err(new LenaError('conflict'))
	}

	return ok(Object.freeze({ record: existing, status: 'already-processed' }))
}
