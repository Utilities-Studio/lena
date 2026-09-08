import {
	compareIsoTimestamps,
	isoTimestampSchema,
	err,
	LenaError,
	ok,
	mutationIdSchema,
	vaultIdSchema,
	vaultInstanceIdSchema,
	type IsoTimestamp,
	type MutationId,
	type Result,
	type VaultId,
	type VaultInstanceId
} from '@lena-inc/core'
import { max } from 'drizzle-orm'
import type { ExtractTablesWithRelations } from 'drizzle-orm/relations'
import type {
	BaseSQLiteDatabase,
	SQLiteTransaction
} from 'drizzle-orm/sqlite-core'
import { z } from 'zod'
import {
	lenaBackupOutboxTable,
	type LenaVaultDrizzleSchema
} from './drizzle-schema'
import {
	createBackupObligation,
	type PendingBackupObligation
} from './obligations'

/**
 * A database adapter consumes this as one transaction boundary. The domain mutation and the
 * supplied pending obligation must either both commit or both roll back.
 */
export interface AtomicVaultMutationPlan<Mutation> {
	readonly backupObligation: PendingBackupObligation
	readonly mutation: Mutation
}

export const vaultMutationReceiptSchema = z
	.strictObject({
		backupObligationCreated: z.literal(true),
		commitSequence: z.int().min(1).max(Number.MAX_SAFE_INTEGER),
		committedAt: isoTimestampSchema,
		mutationId: mutationIdSchema,
		vaultId: vaultIdSchema,
		vaultInstanceId: vaultInstanceIdSchema
	})
	.readonly()

const vaultMutationReceiptStructureSchema = z.strictObject({
	backupObligationCreated: z.unknown(),
	commitSequence: z.unknown(),
	committedAt: z.unknown(),
	mutationId: z.unknown(),
	vaultId: z.unknown(),
	vaultInstanceId: z.unknown()
})

export type VaultMutationReceipt = z.infer<typeof vaultMutationReceiptSchema>

export function prepareAtomicVaultMutation<Mutation>(input: {
	commitSequence: number
	committedAt: IsoTimestamp
	createdAt: IsoTimestamp
	mutation: Mutation
	mutationId: MutationId
	vaultId: VaultId
	vaultInstanceId: VaultInstanceId
}): AtomicVaultMutationPlan<Mutation> {
	return Object.freeze({
		backupObligation: createBackupObligation({
			commitSequence: input.commitSequence,
			committedAt: input.committedAt,
			createdAt: input.createdAt,
			mutationId: input.mutationId,
			vaultId: input.vaultId,
			vaultInstanceId: input.vaultInstanceId
		}),
		mutation: input.mutation
	})
}

/**
 * Database adapters call this only after the transaction represented by the plan has committed.
 * This pure factory validates the persisted receipt shape but does not itself prove a native commit.
 */
export function createVaultMutationReceipt<Mutation>(
	plan: AtomicVaultMutationPlan<Mutation>,
	committedAt: IsoTimestamp
): Result<VaultMutationReceipt, LenaError> {
	if (compareIsoTimestamps(committedAt, plan.backupObligation.createdAt) < 0) {
		return err(new LenaError('invalid_timestamp'))
	}

	return ok(
		Object.freeze({
			backupObligationCreated: true,
			commitSequence: plan.backupObligation.commitSequence,
			committedAt,
			mutationId: plan.backupObligation.mutationId,
			vaultId: plan.backupObligation.vaultId,
			vaultInstanceId: plan.backupObligation.vaultInstanceId
		})
	)
}

type VaultRelationalSchema = ExtractTablesWithRelations<LenaVaultDrizzleSchema>

export type AsyncVaultDatabase<RunResult = unknown> = BaseSQLiteDatabase<
	'async',
	RunResult,
	LenaVaultDrizzleSchema,
	VaultRelationalSchema
>

export type AsyncVaultTransaction<RunResult = unknown> = SQLiteTransaction<
	'async',
	RunResult,
	LenaVaultDrizzleSchema,
	VaultRelationalSchema
>

export type SyncVaultDatabase<RunResult = unknown> = BaseSQLiteDatabase<
	'sync',
	RunResult,
	LenaVaultDrizzleSchema,
	VaultRelationalSchema
>

export type SyncVaultTransaction<RunResult = unknown> = SQLiteTransaction<
	'sync',
	RunResult,
	LenaVaultDrizzleSchema,
	VaultRelationalSchema
>

export interface CommittedVaultMutation<MutationResult> {
	readonly mutationResult: MutationResult
	readonly receipt: VaultMutationReceipt
}

interface VaultMutationCommitInput {
	readonly committedAt: IsoTimestamp
	readonly createdAt: IsoTimestamp
	readonly mutationId: MutationId
	readonly vaultId: VaultId
	readonly vaultInstanceId: VaultInstanceId
}

class AbortVaultMutation extends Error {
	constructor(readonly lenaError: LenaError) {
		super('abort-vault-mutation')
	}
}

function nextCommitSequence(current: number | null): Result<number, LenaError> {
	const next = (current ?? 0) + 1
	return Number.isSafeInteger(next) && next > 0
		? ok(next)
		: err(
				new LenaError('limit_exceeded', { boundary: 'vault_commit_sequence' })
			)
}

function committedMutation<MutationResult>(
	mutationResult: MutationResult,
	obligation: PendingBackupObligation,
	committedAt: IsoTimestamp
): CommittedVaultMutation<MutationResult> {
	return Object.freeze({
		mutationResult,
		receipt: Object.freeze({
			backupObligationCreated: true as const,
			commitSequence: obligation.commitSequence,
			committedAt,
			mutationId: obligation.mutationId,
			vaultId: obligation.vaultId,
			vaultInstanceId: obligation.vaultInstanceId
		})
	})
}

function pendingOutboxRow(obligation: PendingBackupObligation) {
	return {
		attemptCount: obligation.attemptCount,
		commitSequence: obligation.commitSequence,
		committedAt: obligation.committedAt,
		createdAt: obligation.createdAt,
		mutationId: obligation.mutationId,
		state: obligation.state,
		vaultId: obligation.vaultId,
		vaultInstanceId: obligation.vaultInstanceId
	} as const
}

/**
 * Commits the application callback and its backup outbox row in one exclusive Drizzle transaction.
 * The callback is the caller-selected domain mutation, not an injected module dependency.
 */
export async function commitAsyncVaultMutation<RunResult, MutationResult>(
	database: AsyncVaultDatabase<RunResult>,
	input: VaultMutationCommitInput,
	mutate: (
		transaction: AsyncVaultTransaction<RunResult>
	) => Promise<Result<MutationResult, LenaError>>
): Promise<Result<CommittedVaultMutation<MutationResult>, LenaError>> {
	if (compareIsoTimestamps(input.committedAt, input.createdAt) < 0) {
		return err(new LenaError('invalid_timestamp'))
	}

	try {
		const committed = await database.transaction(
			async (transaction) => {
				const latest = await transaction
					.select({ commitSequence: max(lenaBackupOutboxTable.commitSequence) })
					.from(lenaBackupOutboxTable)
					.get()
				const sequence = nextCommitSequence(latest?.commitSequence ?? null)
				if (sequence.isErr()) throw new AbortVaultMutation(sequence.error)

				const obligation = createBackupObligation({
					commitSequence: sequence.value,
					committedAt: input.committedAt,
					createdAt: input.createdAt,
					mutationId: input.mutationId,
					vaultId: input.vaultId,
					vaultInstanceId: input.vaultInstanceId
				})
				const mutation = await mutate(transaction)
				if (mutation.isErr()) throw new AbortVaultMutation(mutation.error)

				await transaction
					.insert(lenaBackupOutboxTable)
					.values(pendingOutboxRow(obligation))
					.run()
				return committedMutation(mutation.value, obligation, input.committedAt)
			},
			{ behavior: 'exclusive' }
		)
		return ok(committed)
	} catch (cause) {
		return err(
			cause instanceof AbortVaultMutation
				? cause.lenaError
				: new LenaError('internal', { boundary: 'vault_mutation_transaction' })
		)
	}
}

/** Sync-driver variant for adapters whose Drizzle transaction is synchronous. */
export function commitSyncVaultMutation<RunResult, MutationResult>(
	database: SyncVaultDatabase<RunResult>,
	input: VaultMutationCommitInput,
	mutate: (
		transaction: SyncVaultTransaction<RunResult>
	) => Result<MutationResult, LenaError>
): Result<CommittedVaultMutation<MutationResult>, LenaError> {
	if (compareIsoTimestamps(input.committedAt, input.createdAt) < 0) {
		return err(new LenaError('invalid_timestamp'))
	}

	try {
		return ok(
			database.transaction(
				(transaction) => {
					const latest = transaction
						.select({
							commitSequence: max(lenaBackupOutboxTable.commitSequence)
						})
						.from(lenaBackupOutboxTable)
						.get()
					const sequence = nextCommitSequence(latest?.commitSequence ?? null)
					if (sequence.isErr()) throw new AbortVaultMutation(sequence.error)

					const obligation = createBackupObligation({
						commitSequence: sequence.value,
						committedAt: input.committedAt,
						createdAt: input.createdAt,
						mutationId: input.mutationId,
						vaultId: input.vaultId,
						vaultInstanceId: input.vaultInstanceId
					})
					const mutation = mutate(transaction)
					if (mutation.isErr()) throw new AbortVaultMutation(mutation.error)

					transaction
						.insert(lenaBackupOutboxTable)
						.values(pendingOutboxRow(obligation))
						.run()
					return committedMutation(
						mutation.value,
						obligation,
						input.committedAt
					)
				},
				{ behavior: 'exclusive' }
			)
		)
	} catch (cause) {
		return err(
			cause instanceof AbortVaultMutation
				? cause.lenaError
				: new LenaError('internal', { boundary: 'vault_mutation_transaction' })
		)
	}
}

export function parseVaultMutationReceipt(
	value: unknown
): Result<VaultMutationReceipt, LenaError> {
	const structure = vaultMutationReceiptStructureSchema.safeParse(value)
	if (!structure.success) {
		return err(
			new LenaError('invalid_input', {
				boundary: 'vault_mutation_receipt'
			})
		)
	}

	const parsed = vaultMutationReceiptSchema.safeParse(structure.data)
	if (parsed.success) return ok(parsed.data)

	const failedField = parsed.error.issues[0]?.path[0]
	if (failedField === 'backupObligationCreated') {
		return err(new LenaError('invalid_state_transition'))
	}
	if (failedField === 'committedAt') {
		return err(new LenaError('invalid_timestamp'))
	}
	if (
		failedField === 'mutationId' ||
		failedField === 'vaultId' ||
		failedField === 'vaultInstanceId'
	) {
		const kind =
			failedField === 'mutationId'
				? 'MutationId'
				: failedField === 'vaultId'
					? 'VaultId'
					: 'VaultInstanceId'
		return err(new LenaError('invalid_identifier', { kind }))
	}

	return err(
		new LenaError('invalid_input', {
			boundary: 'vault_mutation_receipt'
		})
	)
}
