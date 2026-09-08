import {
	transportCiphertextUriSchema,
	transportRemotePathSchema
} from '@lena/backup'
import {
	errAsync,
	isoTimestampSchema,
	LenaError,
	ResultAsync
} from '@lena/core'
import {
	CloudStorage,
	CloudStorageProvider,
	CloudStorageScope
} from 'react-native-cloud-storage'
import { z } from 'zod'

export const iCloudReadRuntimeCapability = Object.freeze({
	deleteImplemented: false as const,
	deviceEvidenceReady: false as const,
	immutableCreateImplemented: false as const,
	readImplemented: true as const,
	remoteChecksumAvailable: false as const,
	runtimeReady: false as const,
	sdk: 'react-native-cloud-storage' as const,
	sdkVersion: '3.1.0' as const
})

export const iCloudReadListRequestSchema = z
	.strictObject({ prefix: transportRemotePathSchema })
	.readonly()
export const iCloudReadObjectRequestSchema = z
	.strictObject({ remotePath: transportRemotePathSchema })
	.readonly()
export const iCloudDownloadObjectRequestSchema = iCloudReadObjectRequestSchema
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

export type ICloudObjectStat = z.infer<typeof cloudObjectStatSchema>

function nativeFailure(boundary: string): LenaError {
	return new LenaError('temporarily_unavailable', {
		boundary,
		reason: 'native_operation_failed',
		retryable: true
	})
}

function createICloudStorage(): CloudStorage {
	return new CloudStorage(CloudStorageProvider.ICloud, {
		scope: CloudStorageScope.AppData
	})
}

export function listICloudObjectNames(
	input: unknown
): ResultAsync<readonly string[], LenaError> {
	const request = iCloudReadListRequestSchema.safeParse(input)
	if (!request.success) {
		return errAsync(
			new LenaError('invalid_input', { boundary: 'icloud_read_list' })
		)
	}
	return ResultAsync.fromPromise(
		(async () => {
			const names = await createICloudStorage().readdir(
				request.data.prefix,
				CloudStorageScope.AppData
			)
			return Object.freeze(z.array(cloudObjectNameSchema).parse(names))
		})(),
		() => nativeFailure('icloud_read_list')
	)
}

export function inspectICloudObject(
	input: unknown
): ResultAsync<ICloudObjectStat, LenaError> {
	const request = iCloudReadObjectRequestSchema.safeParse(input)
	if (!request.success) {
		return errAsync(
			new LenaError('invalid_input', { boundary: 'icloud_read_inspect' })
		)
	}
	return ResultAsync.fromPromise(
		(async () => {
			const stat = await createICloudStorage().stat(
				request.data.remotePath,
				CloudStorageScope.AppData
			)
			if (!stat.isFile()) {
				throw new LenaError('invalid_input', {
					boundary: 'icloud_read_inspect'
				})
			}
			return cloudObjectStatSchema.parse({
				byteLength: stat.size,
				modifiedAt: stat.mtime.toISOString(),
				remotePath: request.data.remotePath
			})
		})(),
		(error) =>
			error instanceof LenaError ? error : nativeFailure('icloud_read_inspect')
	)
}

export function downloadICloudObject(
	input: unknown
): ResultAsync<
	Readonly<{ stagingCiphertextUri: string; verificationRequired: true }>,
	LenaError
> {
	const request = iCloudDownloadObjectRequestSchema.safeParse(input)
	if (!request.success) {
		return errAsync(
			new LenaError('invalid_input', { boundary: 'icloud_read_download' })
		)
	}
	return ResultAsync.fromPromise(
		(async () => {
			await createICloudStorage().downloadFile(
				request.data.remotePath,
				request.data.stagingCiphertextUri,
				CloudStorageScope.AppData
			)
			return Object.freeze({
				stagingCiphertextUri: request.data.stagingCiphertextUri,
				verificationRequired: true as const
			})
		})(),
		() => nativeFailure('icloud_read_download')
	)
}
