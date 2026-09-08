import { mock } from 'bun:test'

type CloudStorageProvider = 'googledrive' | 'icloud'
type CloudStorageScope = 'app_data' | 'documents'

type CloudStorageOperation = Readonly<
	| {
			accessTokenPresent: boolean
			kind: 'construct'
			provider: CloudStorageProvider
			scope: CloudStorageScope | null
			strictFilenames: boolean
	  }
	| {
			kind: 'download'
			localPath: string
			remotePath: string
			scope: CloudStorageScope
	  }
	| { kind: 'readdir'; path: string; scope: CloudStorageScope }
	| { kind: 'stat'; path: string; scope: CloudStorageScope }
>

type CloudStorageStat = Readonly<{
	isFile: boolean
	modifiedAt: Date
	size: number
}>

let directoryEntries: readonly string[] = []
let nativeError: Error | null = null
let objectStat: CloudStorageStat = Object.freeze({
	isFile: true,
	modifiedAt: new Date('2026-09-02T10:00:00.000Z'),
	size: 1
})
const operations: CloudStorageOperation[] = []

export function getCloudStorageMockOperations(): readonly CloudStorageOperation[] {
	return Object.freeze([...operations])
}

export function resetCloudStorageMock(): void {
	directoryEntries = []
	nativeError = null
	objectStat = Object.freeze({
		isFile: true,
		modifiedAt: new Date('2026-09-02T10:00:00.000Z'),
		size: 1
	})
	operations.length = 0
}

export function setCloudStorageDirectoryEntries(
	entries: readonly string[]
): void {
	directoryEntries = Object.freeze([...entries])
}

export function setCloudStorageNativeError(error: Error | null): void {
	nativeError = error
}

export function setCloudStorageObjectStat(stat: CloudStorageStat): void {
	objectStat = Object.freeze({ ...stat })
}

function throwNativeError(): void {
	if (nativeError !== null) throw nativeError
}

class MockCloudStorage {
	constructor(
		provider: CloudStorageProvider,
		options: Readonly<{
			accessToken?: unknown
			scope?: CloudStorageScope
			strictFilenames?: boolean
		}> = {}
	) {
		operations.push(
			Object.freeze({
				accessTokenPresent:
					typeof options.accessToken === 'string' &&
					options.accessToken.length > 0,
				kind: 'construct',
				provider,
				scope: options.scope ?? null,
				strictFilenames: options.strictFilenames === true
			})
		)
	}

	async downloadFile(
		remotePath: string,
		localPath: string,
		scope: CloudStorageScope
	): Promise<void> {
		operations.push(
			Object.freeze({ kind: 'download', localPath, remotePath, scope })
		)
		throwNativeError()
	}

	async readdir(
		path: string,
		scope: CloudStorageScope
	): Promise<readonly string[]> {
		operations.push(Object.freeze({ kind: 'readdir', path, scope }))
		throwNativeError()
		return directoryEntries
	}

	async stat(
		path: string,
		scope: CloudStorageScope
	): Promise<Readonly<{ isFile(): boolean; mtime: Date; size: number }>> {
		operations.push(Object.freeze({ kind: 'stat', path, scope }))
		throwNativeError()
		return Object.freeze({
			isFile: () => objectStat.isFile,
			mtime: objectStat.modifiedAt,
			size: objectStat.size
		})
	}
}

void mock.module('react-native-cloud-storage', () => ({
	CloudStorage: MockCloudStorage,
	CloudStorageProvider: Object.freeze({
		GoogleDrive: 'googledrive',
		ICloud: 'icloud'
	}),
	CloudStorageScope: Object.freeze({
		AppData: 'app_data',
		Documents: 'documents'
	})
}))
