import {
	transportCiphertextUriSchema,
	transportRemotePathSchema
} from '@lena-inc/backup'
import {
	errAsync,
	isoTimestampSchema,
	LenaError,
	ResultAsync
} from '@lena-inc/core'
import {
	CloudStorage,
	CloudStorageProvider,
	CloudStorageScope
} from 'react-native-cloud-storage'
import { z } from 'zod'

export const googleDriveReadRuntimeCapability = Object.freeze({
	deleteImplemented: false as const,
	deviceEvidenceReady: false as const,
	immutableCreateImplemented: false as const,
	providerObjectIdentityAvailable: false as const,
	readImplemented: true as const,
	remoteChecksumAvailable: false as const,
	runtimeReady: false as const,
	sdk: 'react-native-cloud-storage' as const,
	sdkVersion: '3.1.0' as const
})

export const googleDriveAccessTokenSchema = z
	.string()
	.min(1)
	.max(8_192)
	.refine((value) => !/[\r\n]/.test(value))
export const googleDriveReadListRequestSchema = z
	.strictObject({ prefix: transportRemotePathSchema })
	.readonly()
export const googleDriveReadObjectRequestSchema = z
	.strictObject({ remotePath: transportRemotePathSchema })
	.readonly()
export const googleDriveDownloadObjectRequestSchema =
	googleDriveReadObjectRequestSchema
		.unwrap()
		.extend({ stagingCiphertextUri: transportCiphertextUriSchema })
		.readonly()

const cloudObjectNameSchema = z
	.string()
	.min(1)
	.max(512)
	.refine((value) => !/[\r\n/]/.test(value))
const cloudObjectStatSchema = z
	.strictObject({
		byteLength: z.int().nonnegative(),
		modifiedAt: isoTimestampSchema,
		remotePath: transportRemotePathSchema
	})
	.readonly()

export type GoogleDriveObjectStat = z.infer<typeof cloudObjectStatSchema>

function nativeFailure(boundary: string): LenaError {
	return new LenaError('temporarily_unavailable', {
		boundary,
		reason: 'native_operation_failed',
		retryable: true
	})
}

function parseAccessToken(input: unknown) {
	return googleDriveAccessTokenSchema.safeParse(input)
}

function createGoogleDriveStorage(accessToken: string): CloudStorage {
	return new CloudStorage(CloudStorageProvider.GoogleDrive, {
		accessToken,
		scope: CloudStorageScope.AppData,
		strictFilenames: true
	})
}

export function listGoogleDriveObjectNames(
	accessToken: unknown,
	input: unknown
): ResultAsync<readonly string[], LenaError> {
	const token = parseAccessToken(accessToken)
	const request = googleDriveReadListRequestSchema.safeParse(input)
	if (!token.success || !request.success) {
		return errAsync(
			new LenaError('invalid_input', { boundary: 'google_drive_read_list' })
		)
	}
	return ResultAsync.fromPromise(
		(async () => {
			const names = await createGoogleDriveStorage(token.data).readdir(
				request.data.prefix,
				CloudStorageScope.AppData
			)
			return Object.freeze(z.array(cloudObjectNameSchema).parse(names))
		})(),
		() => nativeFailure('google_drive_read_list')
	)
}

export function inspectGoogleDriveObject(
	accessToken: unknown,
	input: unknown
): ResultAsync<GoogleDriveObjectStat, LenaError> {
	const token = parseAccessToken(accessToken)
	const request = googleDriveReadObjectRequestSchema.safeParse(input)
	if (!token.success || !request.success) {
		return errAsync(
			new LenaError('invalid_input', { boundary: 'google_drive_read_inspect' })
		)
	}
	return ResultAsync.fromPromise(
		(async () => {
			const stat = await createGoogleDriveStorage(token.data).stat(
				request.data.remotePath,
				CloudStorageScope.AppData
			)
			if (!stat.isFile()) {
				throw new LenaError('invalid_input', {
					boundary: 'google_drive_read_inspect'
				})
			}
			return cloudObjectStatSchema.parse({
				byteLength: stat.size,
				modifiedAt: stat.mtime.toISOString(),
				remotePath: request.data.remotePath
			})
		})(),
		(error) =>
			error instanceof LenaError
				? error
				: nativeFailure('google_drive_read_inspect')
	)
}

export function downloadGoogleDriveObject(
	accessToken: unknown,
	input: unknown
): ResultAsync<
	Readonly<{ stagingCiphertextUri: string; verificationRequired: true }>,
	LenaError
> {
	const token = parseAccessToken(accessToken)
	const request = googleDriveDownloadObjectRequestSchema.safeParse(input)
	if (!token.success || !request.success) {
		return errAsync(
			new LenaError('invalid_input', { boundary: 'google_drive_read_download' })
		)
	}
	return ResultAsync.fromPromise(
		(async () => {
			await createGoogleDriveStorage(token.data).downloadFile(
				request.data.remotePath,
				request.data.stagingCiphertextUri,
				CloudStorageScope.AppData
			)
			return Object.freeze({
				stagingCiphertextUri: request.data.stagingCiphertextUri,
				verificationRequired: true as const
			})
		})(),
		() => nativeFailure('google_drive_read_download')
	)
}
