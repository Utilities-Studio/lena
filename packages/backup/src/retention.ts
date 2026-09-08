import {
	err,
	LenaError,
	ok,
	type GenerationId,
	type IsoTimestamp,
	type Result,
	type VaultId
} from '@lena-inc/core'
import { orderBy, uniq } from 'es-toolkit'
import { z } from 'zod'
import type { BackupReason } from './manifest'
import {
	isRuntimeVerifiedGeneration,
	type VerifiedGeneration
} from './transport'

export interface RetentionGeneration {
	readonly completedAt: IsoTimestamp
	readonly generationId: GenerationId
	readonly pinned: boolean
	readonly reason: BackupReason
	readonly vaultId: VaultId
	readonly verification: VerifiedGeneration | null
}

const MAX_RETENTION_COUNT = 10_000

const retentionCountSchema = z
	.number()
	.int()
	.refine(Number.isSafeInteger)
	.min(0)
	.max(MAX_RETENTION_COUNT)

export const retentionPolicySchema = z
	.strictObject({
		daily: retentionCountSchema,
		monthly: retentionCountSchema,
		recent: retentionCountSchema
	})
	.readonly()

export type RetentionPolicy = z.infer<typeof retentionPolicySchema>

export type LastKnownGoodGeneration = VerifiedGeneration

const retentionPlanMarker = Symbol('lena.retention-plan')
const authorizedRetentionPlans = new WeakSet()

export type RetentionPlan = Readonly<{
	readonly [retentionPlanMarker]: true
	readonly delete: readonly GenerationId[]
	readonly keep: readonly GenerationId[]
	readonly vaultId: VaultId | null
}>

export function isAuthorizedRetentionPlan(
	value: unknown
): value is RetentionPlan {
	return (
		typeof value === 'object' &&
		value !== null &&
		(value as { readonly [retentionPlanMarker]?: unknown })[
			retentionPlanMarker
		] === true &&
		authorizedRetentionPlans.has(value)
	)
}

export function validateRetentionPolicy(
	policy: RetentionPolicy
): Result<Readonly<RetentionPolicy>, LenaError> {
	const parsed = retentionPolicySchema.safeParse(policy)
	if (!parsed.success) {
		return err(
			new LenaError('invalid_input', {
				maximum: MAX_RETENTION_COUNT
			})
		)
	}
	return ok(parsed.data)
}

export function planGenerationRetention(
	generations: readonly RetentionGeneration[],
	policy: RetentionPolicy,
	lastKnownGood: LastKnownGoodGeneration | null
): Result<RetentionPlan, LenaError> {
	const validPolicy = validateRetentionPolicy(policy)
	if (validPolicy.isErr()) return err(validPolicy.error)

	const vaultIds = uniq(generations.map((generation) => generation.vaultId))
	if (vaultIds.length > 1) {
		return err(new LenaError('conflict'))
	}
	const vaultId = generations[0]?.vaultId ?? null
	const seenGenerationIds = new Set<GenerationId>()
	for (const generation of generations) {
		if (seenGenerationIds.has(generation.generationId)) {
			return err(new LenaError('conflict'))
		}
		seenGenerationIds.add(generation.generationId)
		if (
			generation.verification !== null &&
			(!isRuntimeVerifiedGeneration(generation.verification) ||
				generation.verification.generationId !== generation.generationId ||
				generation.verification.vaultId !== generation.vaultId)
		) {
			return err(new LenaError('integrity_failed'))
		}
	}

	if (lastKnownGood !== null) {
		if (
			!isRuntimeVerifiedGeneration(lastKnownGood) ||
			vaultId === null ||
			lastKnownGood.vaultId !== vaultId
		) {
			return err(new LenaError('conflict'))
		}
		const record = generations.find(
			(generation) => generation.generationId === lastKnownGood.generationId
		)
		if (record === undefined || record.verification !== lastKnownGood) {
			return err(new LenaError('integrity_failed'))
		}
	}

	const ordered = orderBy(
		generations,
		[
			(generation) => generation.completedAt,
			(generation) => generation.generationId
		],
		['desc', 'asc']
	)
	const keep = new Set<GenerationId>()

	for (const generation of ordered) {
		if (generation.verification === null || generation.pinned) {
			keep.add(generation.generationId)
		}
	}

	const newestVerified = ordered.find(
		(generation) => generation.verification !== null
	)
	if (newestVerified !== undefined) keep.add(newestVerified.generationId)
	if (lastKnownGood !== null) keep.add(lastKnownGood.generationId)

	for (const generation of ordered
		.filter((item) => item.verification !== null)
		.slice(0, validPolicy.value.recent)) {
		keep.add(generation.generationId)
	}

	keepBucketed(ordered, keep, 'day', validPolicy.value.daily)
	keepBucketed(ordered, keep, 'month', validPolicy.value.monthly)

	const deletable = ordered.filter(
		(item) => item.verification !== null && !keep.has(item.generationId)
	)
	if (deletable.length > 0 && lastKnownGood === null) {
		return err(new LenaError('invalid_state_transition'))
	}

	const plan = Object.freeze({
		[retentionPlanMarker]: true as const,
		delete: Object.freeze(deletable.map((item) => item.generationId)),
		keep: Object.freeze(
			ordered
				.filter((item) => keep.has(item.generationId))
				.map((item) => item.generationId)
		),
		vaultId
	})
	authorizedRetentionPlans.add(plan)
	return ok(plan)
}

function keepBucketed(
	ordered: readonly RetentionGeneration[],
	keep: Set<GenerationId>,
	granularity: 'day' | 'month',
	maximum: number
): void {
	if (maximum === 0) return
	const buckets = new Set<string>()
	for (const generation of ordered) {
		if (generation.verification === null) continue
		const bucket =
			granularity === 'day'
				? generation.completedAt.slice(0, 10)
				: generation.completedAt.slice(0, 7)
		if (buckets.has(bucket)) continue
		buckets.add(bucket)
		keep.add(generation.generationId)
		if (buckets.size >= maximum) return
	}
}
