import {
	err,
	expectRecord,
	LenaError,
	modelIdSchema,
	ok,
	type Result
} from '@lena-inc/core'
import { validate as isVersion } from 'compare-versions'
import { uniq } from 'es-toolkit'
import { z } from 'zod'

export const MAX_EMBEDDING_DIMENSIONS = 65_536

export const localAiCapabilitySchema = z.enum([
	'embedding',
	'reranking',
	'structured-generation',
	'summarization'
])
export const localAiRuntimeSchema = z.enum(['executorch', 'llama-rn'])
export const localAiPlatformSchema = z.enum(['android', 'ios'])
export const localAiArchitectureSchema = z.enum(['arm64', 'x86_64'])

export type LocalAiCapability = z.infer<typeof localAiCapabilitySchema>
export type LocalAiRuntime = z.infer<typeof localAiRuntimeSchema>
export type LocalAiPlatform = z.infer<typeof localAiPlatformSchema>
export type LocalAiArchitecture = z.infer<typeof localAiArchitectureSchema>

const CAPABILITIES = localAiCapabilitySchema.options
const PLATFORMS = localAiPlatformSchema.options
const ARCHITECTURES = localAiArchitectureSchema.options
const SHA256_PATTERN = /^[0-9a-f]{64}$/
const OS_VERSION_PATTERN = /^\d+(?:\.\d+){0,3}$/

function orderedUnique<Value extends string>(
	values: readonly Value[],
	order: readonly Value[]
): readonly Value[] {
	const uniqueValues = new Set(uniq(values))
	return Object.freeze(order.filter((value) => uniqueValues.has(value)))
}

function normalizeOsVersion(value: string): string {
	return value
		.split('.')
		.map((part) => String(Number(part)))
		.join('.')
}

const versionSchema = z
	.string()
	.max(128)
	.transform((value) => value.normalize('NFC').trim())
	.pipe(z.string().refine(isVersion))

const osVersionSchema = z
	.string()
	.regex(OS_VERSION_PATTERN)
	.transform(normalizeOsVersion)

export const modelArtifactManifestSchema = z
	.strictObject({
		byteLength: z.number().int().safe().positive(),
		sha256: z
			.string()
			.transform((value) => value.toLowerCase())
			.pipe(z.string().regex(SHA256_PATTERN))
	})
	.transform((artifact) => Object.freeze(artifact))

export const modelEmbeddingManifestSchema = z
	.strictObject({
		dimensions: z.number().int().safe().min(1).max(MAX_EMBEDDING_DIMENSIONS),
		normalized: z.boolean()
	})
	.transform((embedding) => Object.freeze(embedding))

const minimumOsVersionsSchema = z.strictObject({
	android: osVersionSchema.optional(),
	ios: osVersionSchema.optional()
})

export const modelDeviceRequirementsSchema = z
	.strictObject({
		architectures: z
			.array(localAiArchitectureSchema)
			.min(1)
			.transform((values) => orderedUnique(values, ARCHITECTURES)),
		minimumAvailableMemoryBytes: z.number().int().safe().positive(),
		minimumFreeStorageBytes: z.number().int().safe().positive(),
		minimumOsVersions: minimumOsVersionsSchema,
		platforms: z
			.array(localAiPlatformSchema)
			.min(1)
			.transform((values) => orderedUnique(values, PLATFORMS))
	})
	.superRefine((requirements, context) => {
		for (const platform of requirements.platforms) {
			if (requirements.minimumOsVersions[platform] === undefined) {
				context.addIssue({
					code: 'custom',
					message: 'Every supported platform requires a minimum OS version',
					path: ['minimumOsVersions', platform]
				})
			}
		}
	})
	.transform((requirements) => {
		const minimumOsVersions: Partial<Record<LocalAiPlatform, string>> = {}
		for (const platform of requirements.platforms) {
			const version = requirements.minimumOsVersions[platform]
			if (version !== undefined) minimumOsVersions[platform] = version
		}

		return Object.freeze({
			...requirements,
			minimumOsVersions: Object.freeze(minimumOsVersions)
		})
	})

export const modelManifestSchema = z
	.strictObject({
		artifact: modelArtifactManifestSchema,
		capabilities: z
			.array(localAiCapabilitySchema)
			.min(1)
			.transform((values) => orderedUnique(values, CAPABILITIES)),
		embedding: modelEmbeddingManifestSchema
			.nullable()
			.optional()
			.transform((value) => value ?? null),
		formatVersion: z.literal(1),
		modelId: modelIdSchema,
		requirements: modelDeviceRequirementsSchema,
		runtime: localAiRuntimeSchema,
		version: versionSchema
	})
	.superRefine((manifest, context) => {
		if (
			manifest.requirements.minimumFreeStorageBytes <
			manifest.artifact.byteLength
		) {
			context.addIssue({
				code: 'custom',
				message: 'Minimum free storage cannot be smaller than the artifact',
				path: ['requirements', 'minimumFreeStorageBytes']
			})
		}
		if (
			manifest.capabilities.includes('embedding') !==
			(manifest.embedding !== null)
		) {
			context.addIssue({
				code: 'custom',
				message: 'Embedding capability and manifest must appear together',
				path: ['embedding']
			})
		}
	})
	.transform((manifest) => Object.freeze(manifest))

export type ModelArtifactManifest = Readonly<
	z.infer<typeof modelArtifactManifestSchema>
>
export type ModelEmbeddingManifest = Readonly<
	z.infer<typeof modelEmbeddingManifestSchema>
>
export type ModelDeviceRequirements = Readonly<
	z.infer<typeof modelDeviceRequirementsSchema>
>
export type ModelManifest = Readonly<z.infer<typeof modelManifestSchema>>

export function parseModelManifest(
	value: unknown
): Result<ModelManifest, LenaError> {
	const record = expectRecord(value, 'ai.model-manifest')
	if (record.isErr()) return err(record.error)
	if (record.value['formatVersion'] !== 1) {
		return err(new LenaError('unsupported', { boundary: 'ai.model-manifest' }))
	}

	const parsed = modelManifestSchema.safeParse(value)
	if (!parsed.success) {
		return err(
			new LenaError('invalid_input', {
				boundary: 'ai.model-manifest'
			})
		)
	}

	return ok(parsed.data)
}

export function getModelIntegrityIdentity(manifest: ModelManifest): string {
	return [
		'lena-model',
		'v1',
		manifest.modelId,
		manifest.version,
		manifest.artifact.byteLength,
		`sha256:${manifest.artifact.sha256}`
	].join(':')
}

export function modelSupportsCapability(
	manifest: ModelManifest,
	capability: LocalAiCapability
): boolean {
	return manifest.capabilities.includes(capability)
}
