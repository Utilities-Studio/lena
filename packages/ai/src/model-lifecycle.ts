import {
	err,
	lenaErrorCodeSchema,
	LenaError,
	ok,
	type LenaErrorCode,
	type Result
} from '@lena-inc/core'
import { match } from 'ts-pattern'
import { z } from 'zod'
import {
	modelManifestSchema,
	modelSupportsCapability,
	type LocalAiCapability,
	type ModelManifest
} from './model-manifest'

export interface AbsentModelState {
	readonly status: 'absent'
}

export interface DownloadingModelState {
	readonly downloadedBytes: number
	readonly installId: string
	readonly manifest: ModelManifest
	readonly status: 'downloading'
}

export interface VerifyingModelState {
	readonly installId: string
	readonly manifest: ModelManifest
	readonly status: 'verifying'
}

export interface ReadyModelState {
	readonly installId: string
	readonly manifest: ModelManifest
	readonly status: 'ready'
}

export interface EvictingModelState {
	readonly installId: string
	readonly manifest: ModelManifest
	readonly status: 'evicting'
}

export type ModelLifecyclePhase = 'download' | 'eviction' | 'verification'

export interface FailedModelState {
	readonly artifactDisposition: 'discard_required' | 'retained'
	readonly downloadedBytes: number
	readonly failedPhase: ModelLifecyclePhase
	readonly installId: string
	readonly manifest: ModelManifest
	readonly reasonCode: LenaErrorCode
	readonly retryFrom: ModelLifecyclePhase
	readonly status: 'failed'
}

export type ModelLifecycleState =
	| AbsentModelState
	| DownloadingModelState
	| VerifyingModelState
	| ReadyModelState
	| EvictingModelState
	| FailedModelState

export interface ModelAvailability {
	readonly available: boolean
	readonly cloudFallback: false
	readonly reason:
		| 'available'
		| 'capability_missing'
		| 'model_absent'
		| 'model_not_ready'
}

export const ABSENT_MODEL: AbsentModelState = Object.freeze({
	status: 'absent'
})

const installIdSchema = z.uuidv4()
const sha256Schema = z
	.string()
	.transform((value) => value.toLowerCase())
	.pipe(z.string().regex(/^[0-9a-f]{64}$/))
const lifecycleInstallIdEventFields = { installId: installIdSchema } as const
const modelLifecycleEventSchema = z.discriminatedUnion('type', [
	z.strictObject({
		...lifecycleInstallIdEventFields,
		manifest: modelManifestSchema,
		type: z.literal('install_requested')
	}),
	z.strictObject({
		downloadedBytes: z.number().int().safe().nonnegative(),
		...lifecycleInstallIdEventFields,
		type: z.literal('download_progressed')
	}),
	z.strictObject({
		...lifecycleInstallIdEventFields,
		type: z.literal('download_completed')
	}),
	z.strictObject({
		actualByteLength: z.number().int().safe().nonnegative(),
		actualSha256: sha256Schema,
		...lifecycleInstallIdEventFields,
		type: z.literal('verification_completed')
	}),
	z.strictObject({
		...lifecycleInstallIdEventFields,
		reasonCode: lenaErrorCodeSchema,
		type: z.literal('operation_failed')
	}),
	z.strictObject({
		...lifecycleInstallIdEventFields,
		type: z.literal('retry_requested')
	}),
	z.strictObject({
		...lifecycleInstallIdEventFields,
		type: z.literal('eviction_requested')
	}),
	z.strictObject({
		...lifecycleInstallIdEventFields,
		type: z.literal('eviction_completed')
	}),
	z.strictObject({
		...lifecycleInstallIdEventFields,
		type: z.literal('artifact_discarded')
	})
])

export type ModelLifecycleEvent = Readonly<
	z.infer<typeof modelLifecycleEventSchema>
>

export function transitionModelLifecycle(
	state: ModelLifecycleState,
	inputEvent: ModelLifecycleEvent
): Result<ModelLifecycleState, LenaError> {
	const parsedEvent = modelLifecycleEventSchema.safeParse(inputEvent)
	if (!parsedEvent.success) {
		return err(
			new LenaError('invalid_input', {
				boundary: 'model_lifecycle'
			})
		)
	}

	return match(parsedEvent.data)
		.with({ type: 'install_requested' }, (event) => {
			if (state.status !== 'absent') return invalidTransition(state, event.type)
			const installId = parseInstallId(event.installId)
			if (installId.isErr()) return err(installId.error)
			return ok(
				Object.freeze({
					downloadedBytes: 0,
					installId: installId.value,
					manifest: event.manifest,
					status: 'downloading' as const
				})
			)
		})
		.with({ type: 'download_progressed' }, (event) => {
			if (state.status !== 'downloading')
				return invalidTransition(state, event.type)
			const matching = requireInstallId(state.installId, event.installId)
			if (matching.isErr()) return err(matching.error)
			if (
				!Number.isSafeInteger(event.downloadedBytes) ||
				event.downloadedBytes < state.downloadedBytes ||
				event.downloadedBytes > state.manifest.artifact.byteLength
			) {
				return err(
					new LenaError('invalid_input', { boundary: 'model_lifecycle' })
				)
			}
			return ok(
				Object.freeze({ ...state, downloadedBytes: event.downloadedBytes })
			)
		})
		.with({ type: 'download_completed' }, (event) => {
			if (state.status !== 'downloading')
				return invalidTransition(state, event.type)
			const matching = requireInstallId(state.installId, event.installId)
			if (matching.isErr()) return err(matching.error)
			if (state.downloadedBytes !== state.manifest.artifact.byteLength) {
				return err(
					new LenaError('invalid_state_transition', {
						downloadedBytes: state.downloadedBytes,
						expectedBytes: state.manifest.artifact.byteLength
					})
				)
			}
			return ok(
				Object.freeze({
					installId: state.installId,
					manifest: state.manifest,
					status: 'verifying' as const
				})
			)
		})
		.with({ type: 'verification_completed' }, (event) => {
			if (state.status !== 'verifying')
				return invalidTransition(state, event.type)
			const matching = requireInstallId(state.installId, event.installId)
			if (matching.isErr()) return err(matching.error)
			const actualSha256 = parseSha256(event.actualSha256)
			if (actualSha256.isErr()) return err(actualSha256.error)
			if (
				!Number.isSafeInteger(event.actualByteLength) ||
				event.actualByteLength < 0
			) {
				return err(
					new LenaError('invalid_input', { boundary: 'model_lifecycle' })
				)
			}
			if (
				event.actualByteLength !== state.manifest.artifact.byteLength ||
				actualSha256.value !== state.manifest.artifact.sha256
			) {
				return ok(
					createFailedState(
						state.manifest,
						state.installId,
						'discard_required',
						'verification',
						'integrity_failed',
						'download',
						0
					)
				)
			}
			return ok(
				Object.freeze({
					installId: state.installId,
					manifest: state.manifest,
					status: 'ready' as const
				})
			)
		})
		.with({ type: 'operation_failed' }, (event) => {
			if (
				state.status === 'absent' ||
				state.status === 'ready' ||
				state.status === 'failed'
			) {
				return invalidTransition(state, event.type)
			}
			const matching = requireInstallId(state.installId, event.installId)
			if (matching.isErr()) return err(matching.error)
			if (state.status === 'downloading') {
				return ok(
					createFailedState(
						state.manifest,
						state.installId,
						'retained',
						'download',
						event.reasonCode,
						'download',
						state.downloadedBytes
					)
				)
			}
			if (state.status === 'verifying') {
				return ok(
					createFailedState(
						state.manifest,
						state.installId,
						'retained',
						'verification',
						event.reasonCode,
						'verification',
						state.manifest.artifact.byteLength
					)
				)
			}
			if (state.status === 'evicting') {
				return ok(
					createFailedState(
						state.manifest,
						state.installId,
						'retained',
						'eviction',
						event.reasonCode,
						'eviction',
						state.manifest.artifact.byteLength
					)
				)
			}
			return invalidTransition(state, event.type)
		})
		.with({ type: 'retry_requested' }, (event) => {
			if (state.status !== 'failed') return invalidTransition(state, event.type)
			const matching = requireInstallId(state.installId, event.installId)
			if (matching.isErr()) return err(matching.error)
			if (state.artifactDisposition === 'discard_required') {
				return err(
					new LenaError('invalid_state_transition', {
						boundary: 'model_lifecycle',
						reason: 'discard_required'
					})
				)
			}
			if (state.retryFrom === 'download') {
				return ok(
					Object.freeze({
						downloadedBytes: state.downloadedBytes,
						installId: state.installId,
						manifest: state.manifest,
						status: 'downloading' as const
					})
				)
			}
			if (state.retryFrom === 'verification') {
				return ok(
					Object.freeze({
						installId: state.installId,
						manifest: state.manifest,
						status: 'verifying' as const
					})
				)
			}
			return ok(
				Object.freeze({
					installId: state.installId,
					manifest: state.manifest,
					status: 'evicting' as const
				})
			)
		})
		.with({ type: 'eviction_requested' }, (event) => {
			if (state.status !== 'ready') return invalidTransition(state, event.type)
			const matching = requireInstallId(state.installId, event.installId)
			if (matching.isErr()) return err(matching.error)
			return ok(
				Object.freeze({
					installId: state.installId,
					manifest: state.manifest,
					status: 'evicting' as const
				})
			)
		})
		.with({ type: 'eviction_completed' }, (event) => {
			if (state.status !== 'evicting')
				return invalidTransition(state, event.type)
			const matching = requireInstallId(state.installId, event.installId)
			if (matching.isErr()) return err(matching.error)
			return ok(ABSENT_MODEL)
		})
		.with({ type: 'artifact_discarded' }, (event) => {
			if (state.status !== 'failed') return invalidTransition(state, event.type)
			const matching = requireInstallId(state.installId, event.installId)
			if (matching.isErr()) return err(matching.error)
			return ok(ABSENT_MODEL)
		})
		.exhaustive()
}

export function getModelAvailability(
	state: ModelLifecycleState,
	capability: LocalAiCapability
): ModelAvailability {
	if (state.status === 'absent') {
		return Object.freeze({
			available: false,
			cloudFallback: false,
			reason: 'model_absent' as const
		})
	}
	if (state.status !== 'ready') {
		return Object.freeze({
			available: false,
			cloudFallback: false,
			reason: 'model_not_ready' as const
		})
	}
	if (!modelSupportsCapability(state.manifest, capability)) {
		return Object.freeze({
			available: false,
			cloudFallback: false,
			reason: 'capability_missing' as const
		})
	}
	return Object.freeze({
		available: true,
		cloudFallback: false,
		reason: 'available' as const
	})
}

function createFailedState(
	manifest: ModelManifest,
	installId: string,
	artifactDisposition: FailedModelState['artifactDisposition'],
	failedPhase: ModelLifecyclePhase,
	reasonCode: LenaErrorCode,
	retryFrom: ModelLifecyclePhase,
	downloadedBytes: number
): FailedModelState {
	return Object.freeze({
		artifactDisposition,
		downloadedBytes,
		failedPhase,
		installId,
		manifest,
		reasonCode,
		retryFrom,
		status: 'failed'
	})
}

function parseInstallId(value: unknown): Result<string, LenaError> {
	const parsed = installIdSchema.safeParse(value)
	if (!parsed.success) {
		return err(
			new LenaError('invalid_identifier', { boundary: 'model_install_id' })
		)
	}
	return ok(parsed.data)
}

function requireInstallId(
	activeInstallId: string,
	input: unknown
): Result<true, LenaError> {
	const installId = parseInstallId(input)
	if (installId.isErr()) return err(installId.error)
	return installId.value === activeInstallId
		? ok(true)
		: err(
				new LenaError('conflict', {
					boundary: 'model_lifecycle'
				})
			)
}

function parseSha256(value: unknown): Result<string, LenaError> {
	const parsed = sha256Schema.safeParse(value)
	if (!parsed.success) {
		return err(new LenaError('invalid_input', { boundary: 'model_sha256' }))
	}
	return ok(parsed.data)
}

function invalidTransition(
	state: ModelLifecycleState,
	event: ModelLifecycleEvent['type']
): Result<never, LenaError> {
	return err(
		new LenaError('invalid_state_transition', {
			event,
			state: state.status
		})
	)
}
