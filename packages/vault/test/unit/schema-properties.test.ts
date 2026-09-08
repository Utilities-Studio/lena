import { describe, expect, test } from 'bun:test'
import {
	isoTimestampSchema,
	mutationIdSchema,
	vaultIdSchema,
	vaultInstanceIdSchema
} from '@lena-inc/core'
import fc from 'fast-check'
import {
	backupObligationSchema,
	parseBackupObligation,
	pendingBackupObligationSchema
} from '../../src/index'

describe('vault persisted schema properties', () => {
	test('valid pending obligations survive JSON round trips', () => {
		fc.assert(
			fc.property(
				fc.uuid({ version: 4 }),
				fc.uuid({ version: 4 }),
				fc.uuid({ version: 4 }),
				fc.date({
					max: new Date('2099-12-31T23:59:59.999Z'),
					min: new Date('2000-01-01T00:00:00.000Z'),
					noInvalidDate: true
				}),
				(vaultId, vaultInstanceId, mutationId, createdAt) => {
					const persisted = {
						attemptCount: 0,
						committedAt: isoTimestampSchema.parse(createdAt.toISOString()),
						commitSequence: 1,
						createdAt: isoTimestampSchema.parse(createdAt.toISOString()),
						mutationId: mutationIdSchema.parse(mutationId),
						state: 'pending' as const,
						vaultId: vaultIdSchema.parse(vaultId),
						vaultInstanceId: vaultInstanceIdSchema.parse(vaultInstanceId)
					}

					const parsed = parseBackupObligation(
						JSON.parse(JSON.stringify(persisted))
					)
					expect(parsed.isOk()).toBe(true)
					if (parsed.isErr()) throw parsed.error
					expect(backupObligationSchema.safeParse(parsed.value).success).toBe(
						true
					)
					expect(Object.isFrozen(parsed.value)).toBe(true)
					expect(parsed.value).toEqual(persisted)
				}
			)
		)
	})

	test('pending attempt counts require the matching persisted failure state', () => {
		fc.assert(
			fc.property(fc.nat({ max: 1_000 }), (attemptCount) => {
				const candidate = {
					attemptCount,
					committedAt: '2026-09-01T08:00:00.000Z',
					commitSequence: 1,
					createdAt: '2026-09-01T08:00:00.000Z',
					mutationId: '018f3f5a-1d2c-4abc-8def-2123456789ab',
					state: 'pending',
					vaultId: '018f3f5a-1d2c-4abc-8def-0123456789ab',
					vaultInstanceId: '018f3f5a-1d2c-4abc-8def-1123456789ab'
				}

				expect(parseBackupObligation(candidate).isOk()).toBe(attemptCount === 0)
				expect(pendingBackupObligationSchema.safeParse(candidate).success).toBe(
					attemptCount === 0
				)
				expect(
					parseBackupObligation({
						...candidate,
						providerToken: 'forbidden'
					}).isOk()
				).toBe(false)
			})
		)
	})
})
