import {
	err,
	LenaError,
	ok,
	parseModelId,
	type ModelId,
	type Result
} from '@lena-inc/core'
import { z } from 'zod'

export const MAX_VECTOR_DIMENSIONS = 65_536

export const vectorDistanceMetricSchema = z.enum(['cosine', 'dot', 'l2'])
export type VectorDistanceMetric = z.infer<typeof vectorDistanceMetricSchema>

const vectorIndexMetadataShapeSchema = z.strictObject({
	dimensions: z.int().min(1).max(MAX_VECTOR_DIMENSIONS),
	distanceMetric: z.unknown(),
	modelId: z.unknown(),
	modelVersion: z.unknown()
})

export interface VectorIndexMetadata {
	readonly dimensions: number
	readonly distanceMetric: VectorDistanceMetric
	readonly modelId: ModelId
	readonly modelVersion: string
}

export function parseVectorIndexMetadata(
	value: unknown
): Result<VectorIndexMetadata, LenaError> {
	const record = vectorIndexMetadataShapeSchema.safeParse(value)
	if (!record.success) {
		return err(
			new LenaError('invalid_input', {
				boundary: 'search.vector-index-metadata'
			})
		)
	}

	const modelId = parseModelId(record.data.modelId)
	if (modelId.isErr()) return err(modelId.error)
	const modelVersion = parseVersion(record.data.modelVersion)
	if (modelVersion.isErr()) return err(modelVersion.error)
	const distanceMetric = vectorDistanceMetricSchema.safeParse(
		record.data.distanceMetric
	)
	if (!distanceMetric.success) {
		return err(new LenaError('invalid_input'))
	}

	return ok(
		Object.freeze({
			dimensions: record.data.dimensions,
			distanceMetric: distanceMetric.data,
			modelId: modelId.value,
			modelVersion: modelVersion.value
		})
	)
}

export function validateEmbeddingForIndex(
	value: unknown,
	metadata: VectorIndexMetadata
): Result<readonly number[], LenaError> {
	const numericArraySchema = z.union([
		z.array(z.number().finite()),
		z.instanceof(Float32Array)
	])
	const parsed = numericArraySchema.safeParse(value)
	if (!parsed.success) {
		return err(new LenaError('invalid_input'))
	}
	if (parsed.data.length !== metadata.dimensions) {
		return err(
			new LenaError('invalid_input', {
				actual: parsed.data.length,
				expected: metadata.dimensions
			})
		)
	}

	const embedding = Array.from(parsed.data)

	return ok(Object.freeze(embedding))
}

function parseVersion(value: unknown): Result<string, LenaError> {
	const parsed = z.string().safeParse(value)
	if (!parsed.success) {
		return err(new LenaError('invalid_input'))
	}
	const normalized = parsed.data.normalize('NFC').trim()
	if (normalized.length === 0 || normalized.length > 128) {
		return err(new LenaError('invalid_input'))
	}
	return ok(normalized)
}
