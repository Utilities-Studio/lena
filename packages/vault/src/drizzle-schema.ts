import {
	compareIsoTimestamps,
	effectIdSchema,
	err,
	generationIdSchema,
	isoTimestampSchema,
	LenaError,
	lenaErrorCodeSchema,
	mutationIdSchema,
	ok,
	schemaVersionSchema,
	vaultIdSchema,
	vaultInstanceIdSchema,
	type EffectId,
	type GenerationId,
	type IsoTimestamp,
	type LenaErrorCode,
	type MutationId,
	type Result,
	type SchemaVersion,
	type VaultId,
	type VaultInstanceId
} from '@lena-inc/core'
import { sql } from 'drizzle-orm'
import {
	check,
	foreignKey,
	integer,
	sqliteTable,
	text,
	unique
} from 'drizzle-orm/sqlite-core'
import { createSelectSchema } from 'drizzle-zod'
import { match } from 'ts-pattern'
import { z } from 'zod'

const BACKUP_OUTBOX_STATES = ['pending', 'claimed', 'satisfied'] as const
const PERSISTABLE_ERROR_CODE_SQL = sql.raw(
	lenaErrorCodeSchema.options.map((code) => `'${code}'`).join(', ')
)

export const lenaVaultMetadataTable = sqliteTable(
	'lena_vault_metadata',
	{
		singletonId: integer('singleton_id').$type<1>().primaryKey(),
		vaultId: text('vault_id').$type<VaultId>().notNull(),
		vaultInstanceId: text('vault_instance_id')
			.$type<VaultInstanceId>()
			.notNull()
			.unique('lena_vault_metadata_vault_instance_id_unique'),
		schemaVersion: integer('schema_version').$type<SchemaVersion>().notNull(),
		formatVersion: integer('format_version').notNull(),
		encryptionEnvelopeVersion: integer('encryption_envelope_version').notNull(),
		createdAt: text('created_at').$type<IsoTimestamp>().notNull()
	},
	(table) => [
		check('lena_vault_metadata_singleton_check', sql`${table.singletonId} = 1`),
		check(
			'lena_vault_metadata_schema_version_check',
			sql`${table.schemaVersion} > 0`
		),
		check(
			'lena_vault_metadata_format_version_check',
			sql`${table.formatVersion} > 0`
		),
		check(
			'lena_vault_metadata_encryption_envelope_version_check',
			sql`${table.encryptionEnvelopeVersion} > 0`
		),
		unique('lena_vault_metadata_vault_instance_unique').on(
			table.vaultId,
			table.vaultInstanceId
		)
	]
)

export const lenaBackupOutboxTable = sqliteTable(
	'lena_backup_outbox',
	{
		commitSequence: integer('commit_sequence')
			.notNull()
			.unique('lena_backup_outbox_commit_sequence_unique'),
		mutationId: text('mutation_id').$type<MutationId>().primaryKey(),
		vaultId: text('vault_id').$type<VaultId>().notNull(),
		vaultInstanceId: text('vault_instance_id')
			.$type<VaultInstanceId>()
			.notNull(),
		state: text('state', { enum: BACKUP_OUTBOX_STATES }).notNull(),
		attemptCount: integer('attempt_count').notNull().default(0),
		claimId: text('claim_id').$type<EffectId>(),
		generationId: text('generation_id').$type<GenerationId>(),
		createdAt: text('created_at').$type<IsoTimestamp>().notNull(),
		committedAt: text('committed_at').$type<IsoTimestamp>().notNull(),
		claimedAt: text('claimed_at').$type<IsoTimestamp>(),
		coveredCommitAt: text('covered_commit_at').$type<IsoTimestamp>(),
		completedAt: text('completed_at').$type<IsoTimestamp>(),
		lastFailureCode: text('last_failure_code').$type<LenaErrorCode>()
	},
	(table) => [
		check(
			'lena_backup_outbox_commit_sequence_check',
			sql`${table.commitSequence} > 0`
		),
		check(
			'lena_backup_outbox_state_check',
			sql`${table.state} IN ('pending', 'claimed', 'satisfied')`
		),
		check(
			'lena_backup_outbox_attempt_count_check',
			sql`${table.attemptCount} >= 0`
		),
		check(
			'lena_backup_outbox_commit_chronology_check',
			sql`${table.committedAt} >= ${table.createdAt}`
		),
		check(
			'lena_backup_outbox_last_failure_code_check',
			sql`${table.lastFailureCode} IS NULL OR ${table.lastFailureCode} IN (${PERSISTABLE_ERROR_CODE_SQL})`
		),
		check(
			'lena_backup_outbox_state_chronology_check',
			sql`(
        (
          ${table.state} = 'pending'
          AND ${table.claimId} IS NULL
          AND ${table.generationId} IS NULL
          AND ${table.claimedAt} IS NULL
          AND ${table.coveredCommitAt} IS NULL
          AND ${table.completedAt} IS NULL
          AND (
            (${table.attemptCount} = 0 AND ${table.lastFailureCode} IS NULL)
            OR (${table.attemptCount} > 0 AND ${table.lastFailureCode} IS NOT NULL)
          )
        )
        OR (
          ${table.state} = 'claimed'
          AND ${table.attemptCount} > 0
          AND ${table.claimId} IS NOT NULL
          AND ${table.generationId} IS NULL
          AND ${table.claimedAt} IS NOT NULL
          AND ${table.claimedAt} >= ${table.createdAt}
          AND ${table.coveredCommitAt} IS NULL
          AND ${table.completedAt} IS NULL
          AND ${table.lastFailureCode} IS NULL
        )
        OR (
          ${table.state} = 'satisfied'
          AND ${table.attemptCount} > 0
          AND ${table.claimId} IS NOT NULL
          AND ${table.generationId} IS NOT NULL
          AND ${table.claimedAt} IS NOT NULL
          AND ${table.claimedAt} >= ${table.createdAt}
          AND ${table.coveredCommitAt} IS NOT NULL
          AND ${table.coveredCommitAt} >= ${table.committedAt}
          AND ${table.coveredCommitAt} <= ${table.claimedAt}
          AND ${table.completedAt} IS NOT NULL
          AND ${table.completedAt} >= ${table.claimedAt}
          AND ${table.completedAt} >= ${table.coveredCommitAt}
          AND ${table.lastFailureCode} IS NULL
        )
      )`
		),
		foreignKey({
			name: 'lena_backup_outbox_vault_instance_fk',
			columns: [table.vaultId, table.vaultInstanceId],
			foreignColumns: [
				lenaVaultMetadataTable.vaultId,
				lenaVaultMetadataTable.vaultInstanceId
			]
		}),
		unique('lena_backup_outbox_commit_identity_unique').on(
			table.commitSequence,
			table.mutationId,
			table.vaultId,
			table.vaultInstanceId
		)
	]
)

export const lenaVerifiedBackupGenerationsTable = sqliteTable(
	'lena_verified_backup_generations',
	{
		generationId: text('generation_id').$type<GenerationId>().primaryKey(),
		vaultId: text('vault_id').$type<VaultId>().notNull(),
		vaultInstanceId: text('vault_instance_id')
			.$type<VaultInstanceId>()
			.notNull(),
		commitSequence: integer('commit_sequence').notNull(),
		mutationId: text('mutation_id').$type<MutationId>().notNull(),
		committedAt: text('committed_at').$type<IsoTimestamp>().notNull(),
		verifiedAt: text('verified_at').$type<IsoTimestamp>().notNull()
	},
	(table) => [
		check(
			'lena_verified_backup_generations_commit_sequence_check',
			sql`${table.commitSequence} > 0`
		),
		check(
			'lena_verified_backup_generations_chronology_check',
			sql`${table.verifiedAt} >= ${table.committedAt}`
		),
		foreignKey({
			name: 'lena_verified_backup_generations_vault_instance_fk',
			columns: [table.vaultId, table.vaultInstanceId],
			foreignColumns: [
				lenaVaultMetadataTable.vaultId,
				lenaVaultMetadataTable.vaultInstanceId
			]
		}),
		foreignKey({
			name: 'lena_verified_backup_generations_commit_fk',
			columns: [
				table.commitSequence,
				table.mutationId,
				table.vaultId,
				table.vaultInstanceId
			],
			foreignColumns: [
				lenaBackupOutboxTable.commitSequence,
				lenaBackupOutboxTable.mutationId,
				lenaBackupOutboxTable.vaultId,
				lenaBackupOutboxTable.vaultInstanceId
			]
		})
	]
)

export const lenaProcessedEffectsTable = sqliteTable(
	'lena_processed_effects',
	{
		effectId: text('effect_id').$type<EffectId>().primaryKey(),
		effectKind: text('effect_kind', { enum: ['backup-obligation'] }).notNull(),
		mutationId: text('mutation_id').$type<MutationId>().notNull(),
		vaultId: text('vault_id').$type<VaultId>().notNull(),
		vaultInstanceId: text('vault_instance_id')
			.$type<VaultInstanceId>()
			.notNull(),
		processedAt: text('processed_at').$type<IsoTimestamp>().notNull()
	},
	(table) => [
		check(
			'lena_processed_effects_effect_kind_check',
			sql`${table.effectKind} = 'backup-obligation'`
		),
		unique('lena_processed_effects_identity_unique').on(
			table.vaultInstanceId,
			table.effectKind,
			table.mutationId
		),
		foreignKey({
			name: 'lena_processed_effects_vault_instance_fk',
			columns: [table.vaultId, table.vaultInstanceId],
			foreignColumns: [
				lenaVaultMetadataTable.vaultId,
				lenaVaultMetadataTable.vaultInstanceId
			]
		})
	]
)

export const lenaVaultDrizzleSchema = Object.freeze({
	backupOutbox: lenaBackupOutboxTable,
	processedEffects: lenaProcessedEffectsTable,
	vaultMetadata: lenaVaultMetadataTable,
	verifiedBackupGenerations: lenaVerifiedBackupGenerationsTable
})

export type LenaVaultDrizzleSchema = typeof lenaVaultDrizzleSchema
export type VaultMetadataRow = typeof lenaVaultMetadataTable.$inferSelect
export type BackupOutboxRow = typeof lenaBackupOutboxTable.$inferSelect
export type ProcessedEffectRow = typeof lenaProcessedEffectsTable.$inferSelect
export type VerifiedBackupGenerationRow =
	typeof lenaVerifiedBackupGenerationsTable.$inferSelect

const positiveSafeIntegerSchema = z.int().min(1).max(Number.MAX_SAFE_INTEGER)
const nonNegativeSafeIntegerSchema = z.int().min(0).max(Number.MAX_SAFE_INTEGER)

const derivedVaultMetadataRowSchema = createSelectSchema(
	lenaVaultMetadataTable,
	{
		createdAt: isoTimestampSchema,
		encryptionEnvelopeVersion: positiveSafeIntegerSchema,
		formatVersion: positiveSafeIntegerSchema,
		schemaVersion: schemaVersionSchema,
		singletonId: z.literal(1),
		vaultId: vaultIdSchema,
		vaultInstanceId: vaultInstanceIdSchema
	}
)

export const vaultMetadataRowSchema = z.strictObject(
	derivedVaultMetadataRowSchema.shape
)

const derivedBackupOutboxRowSchema = createSelectSchema(lenaBackupOutboxTable, {
	attemptCount: nonNegativeSafeIntegerSchema,
	claimId: effectIdSchema.nullable(),
	claimedAt: isoTimestampSchema.nullable(),
	commitSequence: positiveSafeIntegerSchema,
	committedAt: isoTimestampSchema,
	completedAt: isoTimestampSchema.nullable(),
	coveredCommitAt: isoTimestampSchema.nullable(),
	createdAt: isoTimestampSchema,
	generationId: generationIdSchema.nullable(),
	lastFailureCode: lenaErrorCodeSchema.nullable(),
	mutationId: mutationIdSchema,
	state: z.enum(BACKUP_OUTBOX_STATES),
	vaultId: vaultIdSchema,
	vaultInstanceId: vaultInstanceIdSchema
})

export const backupOutboxRowSchema = z
	.strictObject(derivedBackupOutboxRowSchema.shape)
	.superRefine((row, context) => {
		if (compareIsoTimestamps(row.committedAt, row.createdAt) < 0) {
			context.addIssue({ code: 'custom', message: 'commit_chronology' })
		}
		match(row.state)
			.with('pending', () => {
				if (
					row.claimId !== null ||
					row.generationId !== null ||
					row.claimedAt !== null ||
					row.coveredCommitAt !== null ||
					row.completedAt !== null ||
					(row.attemptCount === 0) !== (row.lastFailureCode === null)
				) {
					context.addIssue({ code: 'custom', message: 'pending_state' })
				}
			})
			.with('claimed', () => {
				if (
					row.attemptCount < 1 ||
					row.claimId === null ||
					row.generationId !== null ||
					row.claimedAt === null ||
					row.coveredCommitAt !== null ||
					row.completedAt !== null ||
					row.lastFailureCode !== null ||
					(row.claimedAt !== null &&
						compareIsoTimestamps(row.claimedAt, row.createdAt) < 0)
				) {
					context.addIssue({ code: 'custom', message: 'claimed_state' })
				}
			})
			.with('satisfied', () => {
				if (
					row.attemptCount < 1 ||
					row.claimId === null ||
					row.generationId === null ||
					row.claimedAt === null ||
					row.coveredCommitAt === null ||
					row.completedAt === null ||
					row.lastFailureCode !== null ||
					(row.claimedAt !== null &&
						compareIsoTimestamps(row.claimedAt, row.createdAt) < 0) ||
					(row.coveredCommitAt !== null &&
						compareIsoTimestamps(row.coveredCommitAt, row.committedAt) < 0) ||
					(row.coveredCommitAt !== null &&
						row.claimedAt !== null &&
						compareIsoTimestamps(row.coveredCommitAt, row.claimedAt) > 0) ||
					(row.completedAt !== null &&
						row.claimedAt !== null &&
						compareIsoTimestamps(row.completedAt, row.claimedAt) < 0) ||
					(row.completedAt !== null &&
						row.coveredCommitAt !== null &&
						compareIsoTimestamps(row.completedAt, row.coveredCommitAt) < 0)
				) {
					context.addIssue({ code: 'custom', message: 'satisfied_state' })
				}
			})
			.exhaustive()
	})

const derivedProcessedEffectRowSchema = createSelectSchema(
	lenaProcessedEffectsTable,
	{
		effectId: effectIdSchema,
		effectKind: z.literal('backup-obligation'),
		mutationId: mutationIdSchema,
		processedAt: isoTimestampSchema,
		vaultId: vaultIdSchema,
		vaultInstanceId: vaultInstanceIdSchema
	}
)

export const processedEffectRowSchema = z.strictObject(
	derivedProcessedEffectRowSchema.shape
)

const derivedVerifiedBackupGenerationRowSchema = createSelectSchema(
	lenaVerifiedBackupGenerationsTable,
	{
		commitSequence: positiveSafeIntegerSchema,
		committedAt: isoTimestampSchema,
		generationId: generationIdSchema,
		mutationId: mutationIdSchema,
		vaultId: vaultIdSchema,
		vaultInstanceId: vaultInstanceIdSchema,
		verifiedAt: isoTimestampSchema
	}
)

export const verifiedBackupGenerationRowSchema = z
	.strictObject(derivedVerifiedBackupGenerationRowSchema.shape)
	.superRefine((row, context) => {
		if (compareIsoTimestamps(row.verifiedAt, row.committedAt) < 0) {
			context.addIssue({
				code: 'custom',
				message: 'verification_predates_commit'
			})
		}
	})

function parseDatabaseRow<Row>(
	schema: z.ZodType<Row>,
	value: unknown,
	boundary: string
): Result<Row, LenaError> {
	const parsed = schema.safeParse(value)
	if (!parsed.success) {
		return err(new LenaError('invalid_input', { boundary }))
	}

	return ok(parsed.data)
}

export function parseVaultMetadataRow(
	value: unknown
): Result<VaultMetadataRow, LenaError> {
	return parseDatabaseRow(
		vaultMetadataRowSchema,
		value,
		'lena_vault_metadata_row'
	)
}

export function parseBackupOutboxRow(
	value: unknown
): Result<BackupOutboxRow, LenaError> {
	return parseDatabaseRow(
		backupOutboxRowSchema,
		value,
		'lena_backup_outbox_row'
	)
}

export function parseProcessedEffectRow(
	value: unknown
): Result<ProcessedEffectRow, LenaError> {
	return parseDatabaseRow(
		processedEffectRowSchema,
		value,
		'lena_processed_effect_row'
	)
}

export function parseVerifiedBackupGenerationRow(
	value: unknown
): Result<VerifiedBackupGenerationRow, LenaError> {
	return parseDatabaseRow(
		verifiedBackupGenerationRowSchema,
		value,
		'lena_verified_backup_generation_row'
	)
}
