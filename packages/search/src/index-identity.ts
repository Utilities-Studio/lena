import {
	err,
	expectRecord,
	LenaError,
	ok,
	parseSchemaVersion,
	type Result,
	type SchemaVersion
} from '@lena-inc/core'
import { parseVectorIndexMetadata, type VectorIndexMetadata } from './vector'
import { orderBy } from 'es-toolkit'
import { z } from 'zod'

const searchIndexFingerprintSchema = z
	.string()
	.brand<'SearchIndexFingerprint'>()

export type SearchIndexFingerprint = z.infer<
	typeof searchIndexFingerprintSchema
>

export type TokenizerOptionValue = boolean | number | string

export interface SearchTokenizerIdentity {
	readonly name: string
	readonly options: Readonly<Record<string, TokenizerOptionValue>>
	readonly version: string
}

export interface SearchIndexDefinition {
	readonly schemaVersion: SchemaVersion
	readonly sourceProjection: string
	readonly tokenizer: SearchTokenizerIdentity
	readonly vector: VectorIndexMetadata | null
}

export interface SearchIndexIdentity {
	readonly definition: SearchIndexDefinition
	readonly fingerprint: SearchIndexFingerprint
	readonly formatVersion: 1
}

const TOKEN_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/
const OPTION_KEY_PATTERN = /^[A-Za-z][A-Za-z0-9_]{0,63}$/
const MAX_TOKENIZER_OPTIONS = 32
const indexDefinitionShapeSchema = z.strictObject({
	schemaVersion: z.unknown(),
	sourceProjection: z.unknown(),
	tokenizer: z.unknown(),
	vector: z.unknown().optional()
})
const tokenizerShapeSchema = z.strictObject({
	name: z.unknown(),
	options: z.unknown().optional(),
	version: z.unknown()
})

export function createSearchIndexIdentity(
	value: unknown
): Result<SearchIndexIdentity, LenaError> {
	const record = indexDefinitionShapeSchema.safeParse(value)
	if (!record.success) {
		return err(
			new LenaError('invalid_input', {
				boundary: 'search.index-definition'
			})
		)
	}

	const schemaVersion = parseSchemaVersion(record.data.schemaVersion)
	if (schemaVersion.isErr()) return err(schemaVersion.error)
	const sourceProjection = parseToken(
		record.data.sourceProjection,
		'Source projection'
	)
	if (sourceProjection.isErr()) return err(sourceProjection.error)
	const tokenizer = parseTokenizer(record.data.tokenizer)
	if (tokenizer.isErr()) return err(tokenizer.error)

	let vector: VectorIndexMetadata | null = null
	if (record.data.vector !== undefined && record.data.vector !== null) {
		const parsedVector = parseVectorIndexMetadata(record.data.vector)
		if (parsedVector.isErr()) return err(parsedVector.error)
		vector = parsedVector.value
	}

	const definition: SearchIndexDefinition = Object.freeze({
		schemaVersion: schemaVersion.value,
		sourceProjection: sourceProjection.value,
		tokenizer: tokenizer.value,
		vector
	})
	const canonical = {
		schemaVersion: definition.schemaVersion,
		sourceProjection: definition.sourceProjection,
		tokenizer: {
			name: definition.tokenizer.name,
			options: definition.tokenizer.options,
			version: definition.tokenizer.version
		},
		vector:
			definition.vector === null
				? null
				: {
						dimensions: definition.vector.dimensions,
						distanceMetric: definition.vector.distanceMetric,
						modelId: definition.vector.modelId,
						modelVersion: definition.vector.modelVersion
					}
	}
	const fingerprint = searchIndexFingerprintSchema.parse(
		`lena-search-index:v1:${JSON.stringify(canonical)}`
	)

	return ok(
		Object.freeze({
			definition,
			fingerprint,
			formatVersion: 1 as const
		})
	)
}

export function isSameSearchIndexIdentity(
	left: SearchIndexIdentity,
	right: SearchIndexIdentity
): boolean {
	return left.fingerprint === right.fingerprint
}

function parseTokenizer(
	value: unknown
): Result<SearchTokenizerIdentity, LenaError> {
	const record = tokenizerShapeSchema.safeParse(value)
	if (!record.success) {
		return err(
			new LenaError('invalid_input', {
				boundary: 'search.tokenizer-identity'
			})
		)
	}
	const name = parseToken(record.data.name, 'Tokenizer name')
	if (name.isErr()) return err(name.error)
	const version = parseToken(record.data.version, 'Tokenizer version')
	if (version.isErr()) return err(version.error)

	const options = record.data.options ?? {}
	const optionRecord = expectRecord(options, 'search.tokenizer-options')
	if (optionRecord.isErr()) return err(optionRecord.error)
	const entries = orderBy(
		Object.entries(optionRecord.value),
		[([key]) => key],
		['asc']
	)
	if (entries.length > MAX_TOKENIZER_OPTIONS) {
		return err(
			new LenaError('limit_exceeded', {
				maximum: MAX_TOKENIZER_OPTIONS
			})
		)
	}

	const normalizedEntries: [string, TokenizerOptionValue][] = []
	for (const [key, option] of entries) {
		if (!OPTION_KEY_PATTERN.test(key)) {
			return err(new LenaError('invalid_input'))
		}
		if (
			(typeof option !== 'boolean' &&
				typeof option !== 'number' &&
				typeof option !== 'string') ||
			(typeof option === 'number' && !Number.isFinite(option)) ||
			(typeof option === 'string' && option.length > 256)
		) {
			return err(new LenaError('invalid_input'))
		}
		normalizedEntries.push([key, option])
	}

	return ok(
		Object.freeze({
			name: name.value,
			options: Object.freeze(Object.fromEntries(normalizedEntries)),
			version: version.value
		})
	)
}

function parseToken(value: unknown, _name: string): Result<string, LenaError> {
	if (typeof value !== 'string') {
		return err(new LenaError('invalid_input'))
	}
	const normalized = value.normalize('NFC').trim()
	if (!TOKEN_PATTERN.test(normalized)) {
		return err(new LenaError('invalid_input'))
	}
	return ok(normalized)
}
