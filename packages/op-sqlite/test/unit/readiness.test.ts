import { describe, expect, test } from 'bun:test'
import { assessOpSqliteReadiness } from '../../src/index'

const COMPLETE = {
	consistentSnapshot: true,
	exclusiveTransactions: true,
	foreignKeys: true,
	fts5: true,
	integrityCheck: true,
	libsqlRemoteMode: false,
	sqlCipher: true,
	sqliteVec: true,
	wal: true
} as const

describe('OP-SQLite readiness', () => {
	test('requires keying before metadata and migrations', () => {
		const readiness = assessOpSqliteReadiness(COMPLETE)
		expect(readiness.contractRequirementsSatisfied).toBe(true)
		expect(readiness.runtimeReady).toBe(false)
		expect(readiness.openSequence.indexOf('open-with-key')).toBeLessThan(
			readiness.openSequence.indexOf('read-vault-metadata')
		)
		expect(readiness.openSequence.indexOf('open-with-key')).toBeLessThan(
			readiness.openSequence.indexOf('apply-transactional-migrations')
		)
	})

	test('rejects libSQL remote mode and missing SQLCipher', () => {
		expect(
			assessOpSqliteReadiness({ ...COMPLETE, libsqlRemoteMode: true })
				.contractRequirementsSatisfied
		).toBe(false)
		expect(
			assessOpSqliteReadiness({ ...COMPLETE, sqlCipher: false })
				.contractRequirementsSatisfied
		).toBe(false)
	})

	test('does not gate canonical access on derived search or optional WAL', () => {
		const readiness = assessOpSqliteReadiness({
			...COMPLETE,
			fts5: false,
			sqliteVec: false,
			wal: false
		})
		expect(readiness.contractRequirementsSatisfied).toBe(true)
		expect(readiness.derivedFeatures).toEqual({
			fts5: false,
			sqliteVec: false,
			wal: false
		})
		expect(readiness.openSequence).not.toContain('enable-wal')
	})
})
