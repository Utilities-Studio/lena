import { beforeEach, describe, expect, test } from 'bun:test'

import {
	downloadICloudObject,
	iCloudDownloadObjectRequestSchema,
	iCloudReadListRequestSchema,
	iCloudReadRuntimeCapability,
	inspectICloudObject,
	listICloudObjectNames
} from '../../src'
import {
	getCloudStorageMockOperations,
	resetCloudStorageMock,
	setCloudStorageDirectoryEntries,
	setCloudStorageNativeError,
	setCloudStorageObjectStat
} from '../../../test-support/test/react-native-cloud-storage'

beforeEach(resetCloudStorageMock)

describe('iCloud read-only native boundary', () => {
	test('states the implemented and unproven capabilities exactly', () => {
		expect(iCloudReadRuntimeCapability).toEqual({
			deleteImplemented: false,
			deviceEvidenceReady: false,
			immutableCreateImplemented: false,
			readImplemented: true,
			remoteChecksumAvailable: false,
			runtimeReady: false,
			sdk: 'react-native-cloud-storage',
			sdkVersion: '3.1.0'
		})
	})

	test('uses strict provider-neutral path and staging contracts', () => {
		expect(
			iCloudReadListRequestSchema.safeParse({ prefix: 'vaults/active' }).success
		).toBe(true)
		expect(
			iCloudReadListRequestSchema.safeParse({
				prefix: 'vaults/active',
				recursive: true
			}).success
		).toBe(false)
		expect(
			iCloudDownloadObjectRequestSchema.safeParse({
				remotePath: 'vaults/active/generation.lena',
				stagingCiphertextUri: 'file:///staging/generation.lena'
			}).success
		).toBe(true)
		expect(
			iCloudDownloadObjectRequestSchema.safeParse({
				remotePath: 'vaults/active\ngeneration.lena',
				stagingCiphertextUri: 'file:///staging/generation.lena'
			}).success
		).toBe(false)
	})

	test('rejects invalid requests before creating native storage', async () => {
		expect((await listICloudObjectNames({ prefix: '' })).isErr()).toBe(true)
		expect(
			(await inspectICloudObject({ remotePath: 'bad\npath' })).isErr()
		).toBe(true)
		expect(
			(
				await downloadICloudObject({
					remotePath: 'vaults/active/generation.lena',
					stagingCiphertextUri: ''
				})
			).isErr()
		).toBe(true)
		expect(getCloudStorageMockOperations()).toEqual([])
	})

	test('maps iCloud AppData reads without exposing a mutable SDK object', async () => {
		setCloudStorageDirectoryEntries(['generation-2.lena', 'generation-1.lena'])
		const listed = await listICloudObjectNames({ prefix: 'vaults/active' })
		if (listed.isErr()) throw listed.error
		expect(listed.value).toEqual(['generation-2.lena', 'generation-1.lena'])

		setCloudStorageObjectStat({
			isFile: true,
			modifiedAt: new Date('2026-09-02T10:00:00.000Z'),
			size: 4_096
		})
		const inspected = await inspectICloudObject({
			remotePath: 'vaults/active/generation-2.lena'
		})
		if (inspected.isErr()) throw inspected.error
		expect(inspected.value).toMatchObject({
			byteLength: 4_096,
			remotePath: 'vaults/active/generation-2.lena'
		})
		expect(String(inspected.value.modifiedAt)).toBe('2026-09-02T10:00:00.000Z')

		const downloaded = await downloadICloudObject({
			remotePath: 'vaults/active/generation-2.lena',
			stagingCiphertextUri: 'file:///staging/generation-2.lena'
		})
		if (downloaded.isErr()) throw downloaded.error
		expect(downloaded.value).toEqual({
			stagingCiphertextUri: 'file:///staging/generation-2.lena',
			verificationRequired: true
		})

		const operations = getCloudStorageMockOperations()
		expect(operations.map(({ kind }) => kind)).toEqual([
			'construct',
			'readdir',
			'construct',
			'stat',
			'construct',
			'download'
		])
		expect(operations.filter(({ kind }) => kind === 'construct')).toEqual(
			Array.from({ length: 3 }, () => ({
				accessTokenPresent: false,
				kind: 'construct',
				provider: 'icloud',
				scope: 'app_data',
				strictFilenames: false
			}))
		)
		expect(operations.filter(({ kind }) => kind !== 'construct')).toEqual([
			{ kind: 'readdir', path: 'vaults/active', scope: 'app_data' },
			{
				kind: 'stat',
				path: 'vaults/active/generation-2.lena',
				scope: 'app_data'
			},
			{
				kind: 'download',
				localPath: 'file:///staging/generation-2.lena',
				remotePath: 'vaults/active/generation-2.lena',
				scope: 'app_data'
			}
		])
	})

	test('maps a native read failure to a safe retryable error', async () => {
		setCloudStorageNativeError(new Error('sensitive native payload'))
		const listed = await listICloudObjectNames({ prefix: 'vaults/active' })
		if (listed.isOk()) throw new Error('Expected native read failure')

		expect(listed.error.toJSON()).toEqual({
			code: 'temporarily_unavailable',
			details: {
				boundary: 'icloud_read_list',
				reason: 'native_operation_failed',
				retryable: true
			},
			message: 'The operation is temporarily unavailable',
			name: 'LenaError'
		})
	})
})
