import { z } from 'zod'
import { LenaError } from './errors'
import { err, ok, type Result } from './result'

function idSchema<Name extends string>(name: Name) {
	return z
		.uuidv4()
		.transform((value) => value.toLowerCase())
		.brand(name)
}

export const vaultIdSchema = idSchema('VaultId')
export const vaultInstanceIdSchema = idSchema('VaultInstanceId')
export const generationIdSchema = idSchema('GenerationId')
export const mutationIdSchema = idSchema('MutationId')
export const effectIdSchema = idSchema('EffectId')
export const modelIdSchema = idSchema('ModelId')
export const indexIdSchema = idSchema('IndexId')

export type VaultId = z.infer<typeof vaultIdSchema>
export type VaultInstanceId = z.infer<typeof vaultInstanceIdSchema>
export type GenerationId = z.infer<typeof generationIdSchema>
export type MutationId = z.infer<typeof mutationIdSchema>
export type EffectId = z.infer<typeof effectIdSchema>
export type ModelId = z.infer<typeof modelIdSchema>
export type IndexId = z.infer<typeof indexIdSchema>

function parseId<Schema extends z.ZodType>(
	value: unknown,
	schema: Schema,
	kind: string
): Result<z.output<Schema>, LenaError> {
	const parsed = schema.safeParse(value)
	if (!parsed.success) {
		return err(new LenaError('invalid_identifier', { kind }))
	}

	return ok(parsed.data)
}

export function parseVaultId(value: unknown): Result<VaultId, LenaError> {
	return parseId(value, vaultIdSchema, 'VaultId')
}

export function parseVaultInstanceId(
	value: unknown
): Result<VaultInstanceId, LenaError> {
	return parseId(value, vaultInstanceIdSchema, 'VaultInstanceId')
}

export function parseGenerationId(
	value: unknown
): Result<GenerationId, LenaError> {
	return parseId(value, generationIdSchema, 'GenerationId')
}

export function parseMutationId(value: unknown): Result<MutationId, LenaError> {
	return parseId(value, mutationIdSchema, 'MutationId')
}

export function parseEffectId(value: unknown): Result<EffectId, LenaError> {
	return parseId(value, effectIdSchema, 'EffectId')
}

export function parseModelId(value: unknown): Result<ModelId, LenaError> {
	return parseId(value, modelIdSchema, 'ModelId')
}

export function parseIndexId(value: unknown): Result<IndexId, LenaError> {
	return parseId(value, indexIdSchema, 'IndexId')
}
