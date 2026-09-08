import { describe, expect, test } from 'bun:test'
import { assessExpoSqliteReadiness } from '../../src/index'

const COMPLETE = {
	asyncDatabaseBackup: true,
	consistentSnapshot: true,
	exclusiveTransactions: true,
	expoGo: false,
	foreignKeys: true,
	fts5: true,
	integrityCheck: true,
	sqlCipher: true,
	sqliteVec: false,
	wal: true
} as const

describe('Expo SQLite readiness', () => {
	test('supports lexical Private Vault without requiring vectors', () => {
		const readiness = assessExpoSqliteReadiness(COMPLETE)
		expect(readiness.contractRequirementsSatisfied).toBe(true)
		expect(readiness.runtimeReady).toBe(false)
	})

	test('rejects Expo Go, missing backup, and missing SQLCipher', () => {
		expect(
			assessExpoSqliteReadiness({ ...COMPLETE, expoGo: true })
				.contractRequirementsSatisfied
		).toBe(false)
		expect(
			assessExpoSqliteReadiness({ ...COMPLETE, asyncDatabaseBackup: false })
				.contractRequirementsSatisfied
		).toBe(false)
		expect(
			assessExpoSqliteReadiness({ ...COMPLETE, sqlCipher: false })
				.contractRequirementsSatisfied
		).toBe(false)
	})

	test('keeps derived search optional for canonical vault access', () => {
		const readiness = assessExpoSqliteReadiness({
			...COMPLETE,
			fts5: false,
			wal: false
		})
		expect(readiness.contractRequirementsSatisfied).toBe(true)
		expect(readiness.derivedFeatures.fts5).toBe(false)
		expect(readiness.openSequence).not.toContain('enable-wal')
	})
})
