import {
	err,
	LenaError,
	ok,
	schemaVersionSchema,
	type Result,
	type SchemaVersion,
	type VaultId
} from '@lena/core'
import { orderBy } from 'es-toolkit'
import type { GenerationManifest } from './manifest'
import {
	isRuntimeVerifiedGeneration,
	type VerifiedGeneration
} from './transport'

export type BackupSource = 'google-drive' | 'icloud' | 'local' | 'manual'

/**
 * A local, post-download candidate. Remote adapters must verify the encrypted
 * object and decrypt its authenticated manifest locally before constructing it.
 * The manifest must never be copied into provider metadata for discovery.
 */
export interface GenerationCandidate {
	readonly available: boolean
	readonly manifest: GenerationManifest
	readonly source: BackupSource
	readonly verification: VerifiedGeneration | null
}

const validatedRestoreCandidateBrand: unique symbol = Symbol(
	'ValidatedRestoreCandidate'
)

export type ValidatedRestoreCandidate = Readonly<
	GenerationCandidate & {
		readonly [validatedRestoreCandidateBrand]: 'ValidatedRestoreCandidate'
		/** Older schemas must be migrated and verified in staging before activation. */
		readonly schemaDisposition: 'current' | 'requires-migration'
		readonly targetSchemaVersion: SchemaVersion
		readonly verification: VerifiedGeneration
	}
>

const runtimeValidatedRestoreCandidates = new WeakSet()

export function isRuntimeValidatedRestoreCandidate(
	value: unknown
): value is ValidatedRestoreCandidate {
	return (
		typeof value === 'object' &&
		value !== null &&
		runtimeValidatedRestoreCandidates.has(value)
	)
}

const SOURCE_ORDER: Readonly<Record<BackupSource, number>> = Object.freeze({
	'google-drive': 2,
	icloud: 1,
	local: 0,
	manual: 3
})

export function orderGenerationCandidates(
	candidates: readonly GenerationCandidate[]
): readonly GenerationCandidate[] {
	return Object.freeze(
		orderBy(
			candidates,
			[
				(candidate) => candidate.manifest.completedAt,
				(candidate) => candidate.manifest.generationId,
				(candidate) => SOURCE_ORDER[candidate.source]
			],
			['desc', 'asc', 'asc']
		)
	)
}

export function validateRestoreCandidate(
	candidate: GenerationCandidate,
	/** Current version of the consuming application's unified Lena plus domain schema. */
	targetSchemaVersion: SchemaVersion,
	expectedVaultId: VaultId
): Result<ValidatedRestoreCandidate, LenaError> {
	if (!candidate.available) {
		return err(new LenaError('temporarily_unavailable'))
	}
	if (candidate.manifest.vaultId !== expectedVaultId) {
		return err(new LenaError('conflict'))
	}
	const verification = candidate.verification
	if (verification === null || !isRuntimeVerifiedGeneration(verification)) {
		return err(new LenaError('integrity_failed'))
	}
	if (
		verification.vaultId !== candidate.manifest.vaultId ||
		verification.generationId !== candidate.manifest.generationId ||
		verification.snapshot.commitSequence !==
			candidate.manifest.snapshot.commitSequence ||
		verification.snapshot.committedAt !==
			candidate.manifest.snapshot.committedAt ||
		verification.snapshot.mutationId !==
			candidate.manifest.snapshot.mutationId ||
		verification.snapshot.vaultInstanceId !==
			candidate.manifest.snapshot.vaultInstanceId
	) {
		return err(new LenaError('integrity_failed'))
	}
	const remoteSource =
		candidate.source === 'google-drive' || candidate.source === 'icloud'
	if (
		(remoteSource &&
			(verification.kind !== 'remote' ||
				verification.provider !== candidate.source)) ||
		(!remoteSource &&
			(verification.kind !== 'local' || verification.provider !== null))
	) {
		return err(new LenaError('integrity_failed'))
	}
	const parsedTarget = schemaVersionSchema.safeParse(targetSchemaVersion)
	if (!parsedTarget.success) {
		return err(
			new LenaError('invalid_input', { boundary: 'restore_target_schema' })
		)
	}
	if (candidate.manifest.schemaVersion > parsedTarget.data) {
		return err(new LenaError('incompatible_schema'))
	}

	const validatedFields: ValidatedRestoreCandidate = {
		...candidate,
		[validatedRestoreCandidateBrand]: 'ValidatedRestoreCandidate',
		schemaDisposition:
			candidate.manifest.schemaVersion === parsedTarget.data
				? 'current'
				: 'requires-migration',
		targetSchemaVersion: parsedTarget.data,
		verification
	}
	const validated = Object.freeze(validatedFields)
	runtimeValidatedRestoreCandidates.add(validated)
	return ok(validated)
}
