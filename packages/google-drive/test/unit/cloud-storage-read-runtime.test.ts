import { beforeEach, describe, expect, test } from 'bun:test'

import {
	downloadGoogleDriveObject,
	googleDriveAccessTokenSchema,
	googleDriveDownloadObjectRequestSchema,
	googleDriveReadListRequestSchema,
	googleDriveReadRuntimeCapability,
	inspectGoogleDriveObject,
	listGoogleDriveObjectNames
} from '../../src'
import {
	getCloudStorageMockOperations,
	resetCloudStorageMock,
	setCloudStorageDirectoryEntries,
	setCloudStorageNativeError,
	setCloudStorageObjectStat
} from '../../../test-support/test/react-native-cloud-storage'

beforeEach(resetCloudStorageMock)

describe('Google Drive read-only native boundary', () => {
	test('states the implemented and unproven capabilities exactly', () => {
		expect(googleDriveReadRuntimeCapability).toEqual({
			deleteImplemented: false,
			deviceEvidenceReady: false,
			immutableCreateImplemented: false,
			providerObjectIdentityAvailable: false,
			readImplemented: true,
			remoteChecksumAvailable: false,
			runtimeReady: false,
			sdk: 'react-native-cloud-storage',
			sdkVersion: '3.1.0'
		})
	})

	test('validates access credentials without retaining or projecting them', () => {
		expect(
			googleDriveAccessTokenSchema.safeParse('opaque-access-token').success
		).toBe(true)
		expect(googleDriveAccessTokenSchema.safeParse('token\nleak').success).toBe(
			false
		)
		expect(googleDriveAccessTokenSchema.safeParse(42).success).toBe(false)
	})

	test('uses strict provider-neutral path and staging contracts', () => {
		expect(
			googleDriveReadListRequestSchema.safeParse({ prefix: 'vaults/active' })
				.success
		).toBe(true)
		expect(
			googleDriveReadListRequestSchema.safeParse({
				prefix: 'vaults/active',
				recursive: true
			}).success
		).toBe(false)
		expect(
			googleDriveDownloadObjectRequestSchema.safeParse({
				remotePath: 'vaults/active/generation.lena',
				stagingCiphertextUri: 'file:///staging/generation.lena'
			}).success
		).toBe(true)
	})

	test('rejects invalid requests before creating native storage', async () => {
		expect(
			(await listGoogleDriveObjectNames('', { prefix: 'vaults' })).isErr()
		).toBe(true)
		expect(
			(
				await inspectGoogleDriveObject('opaque-token', {
					remotePath: 'bad\npath'
				})
			).isErr()
		).toBe(true)
		expect(
			(
				await downloadGoogleDriveObject('opaque-token', {
					remotePath: 'vaults/active/generation.lena',
					stagingCiphertextUri: ''
				})
			).isErr()
		).toBe(true)
		expect(getCloudStorageMockOperations()).toEqual([])
	})

	test('maps strict Google Drive AppData reads without retaining the token', async () => {
		setCloudStorageDirectoryEntries(['generation-2.lena'])
		const listed = await listGoogleDriveObjectNames('opaque-token', {
			prefix: 'vaults/active'
		})
		if (listed.isErr()) throw listed.error
		expect(listed.value).toEqual(['generation-2.lena'])

		setCloudStorageObjectStat({
			isFile: true,
			modifiedAt: new Date('2026-09-02T10:00:00.000Z'),
			size: 8_192
		})
		const inspected = await inspectGoogleDriveObject('opaque-token', {
			remotePath: 'vaults/active/generation-2.lena'
		})
		if (inspected.isErr()) throw inspected.error
		expect(inspected.value).toMatchObject({
			byteLength: 8_192,
			remotePath: 'vaults/active/generation-2.lena'
		})
		expect(String(inspected.value.modifiedAt)).toBe('2026-09-02T10:00:00.000Z')

		const downloaded = await downloadGoogleDriveObject('opaque-token', {
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
				accessTokenPresent: true,
				kind: 'construct',
				provider: 'googledrive',
				scope: 'app_data',
				strictFilenames: true
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

	test('maps a native read failure without retaining provider credentials', async () => {
		setCloudStorageNativeError(new Error('opaque-token sensitive payload'))
		const listed = await listGoogleDriveObjectNames('opaque-token', {
			prefix: 'vaults/active'
		})
		if (listed.isOk()) throw new Error('Expected native read failure')

		expect(listed.error.toJSON()).toEqual({
			code: 'temporarily_unavailable',
			details: {
				boundary: 'google_drive_read_list',
				reason: 'native_operation_failed',
				retryable: true
			},
			message: 'The operation is temporarily unavailable',
			name: 'LenaError'
		})
		expect(JSON.stringify(getCloudStorageMockOperations())).not.toContain(
			'opaque-token'
		)
	})
})
