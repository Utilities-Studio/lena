import { err, LenaError, ok, type Result } from '@lena-inc/core'
import { compareVersions } from 'compare-versions'
import { orderBy, uniq } from 'es-toolkit'
import {
	localAiArchitectureSchema,
	localAiPlatformSchema,
	localAiRuntimeSchema,
	type ModelManifest
} from './model-manifest'
import { z } from 'zod'

export const deviceThermalStateSchema = z.enum([
	'critical',
	'fair',
	'nominal',
	'serious'
])
export type DeviceThermalState = z.infer<typeof deviceThermalStateSchema>
export type ModelIneligibilityReason =
	| 'architecture_unsupported'
	| 'insufficient_memory'
	| 'insufficient_storage'
	| 'os_version_unsupported'
	| 'platform_unsupported'
	| 'runtime_unavailable'
	| 'thermal_restricted'

export interface ModelEligibility {
	readonly decision: 'defer' | 'load'
	readonly eligible: boolean
	readonly inferenceMode: 'on-device-only'
	readonly memoryHeadroomBytes: number
	readonly reasons: readonly ModelIneligibilityReason[]
	readonly storageHeadroomBytes: number
}

const OS_VERSION_PATTERN = /^\d+(?:\.\d+){0,3}$/
const localAiDeviceProfileSchema = z
	.strictObject({
		architecture: localAiArchitectureSchema,
		availableMemoryBytes: z.number().int().safe().nonnegative(),
		availableRuntimes: z.array(localAiRuntimeSchema),
		freeStorageBytes: z.number().int().safe().nonnegative(),
		osVersion: z.string().regex(OS_VERSION_PATTERN),
		platform: localAiPlatformSchema,
		thermalState: deviceThermalStateSchema
	})
	.transform((profile) =>
		Object.freeze({
			...profile,
			availableRuntimes: Object.freeze(
				orderBy(
					uniq(profile.availableRuntimes).map((runtime) => ({ runtime })),
					[({ runtime }) => runtime],
					['asc']
				).map(({ runtime }) => runtime)
			),
			osVersion: normalizeOsVersion(profile.osVersion)
		})
	)

export type LocalAiDeviceProfile = Readonly<
	z.infer<typeof localAiDeviceProfileSchema>
>
const REASON_ORDER: readonly ModelIneligibilityReason[] = Object.freeze([
	'platform_unsupported',
	'os_version_unsupported',
	'architecture_unsupported',
	'runtime_unavailable',
	'insufficient_memory',
	'insufficient_storage',
	'thermal_restricted'
])

export function evaluateModelEligibility(
	manifest: ModelManifest,
	deviceValue: unknown
): Result<ModelEligibility, LenaError> {
	const device = parseDeviceProfile(deviceValue)
	if (device.isErr()) return err(device.error)

	const reasons = new Set<ModelIneligibilityReason>()
	if (!manifest.requirements.platforms.includes(device.value.platform)) {
		reasons.add('platform_unsupported')
	} else {
		const minimumOsVersion =
			manifest.requirements.minimumOsVersions[device.value.platform]
		if (
			minimumOsVersion === undefined ||
			compareVersions(device.value.osVersion, minimumOsVersion) < 0
		) {
			reasons.add('os_version_unsupported')
		}
	}
	if (
		!manifest.requirements.architectures.includes(device.value.architecture)
	) {
		reasons.add('architecture_unsupported')
	}
	if (!device.value.availableRuntimes.includes(manifest.runtime)) {
		reasons.add('runtime_unavailable')
	}
	if (
		device.value.availableMemoryBytes <
		manifest.requirements.minimumAvailableMemoryBytes
	) {
		reasons.add('insufficient_memory')
	}
	if (
		device.value.freeStorageBytes <
		manifest.requirements.minimumFreeStorageBytes
	) {
		reasons.add('insufficient_storage')
	}
	if (
		device.value.thermalState === 'serious' ||
		device.value.thermalState === 'critical'
	) {
		reasons.add('thermal_restricted')
	}

	const orderedReasons = REASON_ORDER.filter((reason) => reasons.has(reason))
	return ok(
		Object.freeze({
			decision: orderedReasons.length === 0 ? 'load' : 'defer',
			eligible: orderedReasons.length === 0,
			inferenceMode: 'on-device-only' as const,
			memoryHeadroomBytes:
				device.value.availableMemoryBytes -
				manifest.requirements.minimumAvailableMemoryBytes,
			reasons: Object.freeze(orderedReasons),
			storageHeadroomBytes:
				device.value.freeStorageBytes -
				manifest.requirements.minimumFreeStorageBytes
		})
	)
}

function parseDeviceProfile(
	value: unknown
): Result<LocalAiDeviceProfile, LenaError> {
	const parsed = localAiDeviceProfileSchema.safeParse(value)
	return parsed.success
		? ok(parsed.data)
		: err(
				new LenaError('invalid_input', {
					boundary: 'ai.device-profile'
				})
			)
}

function normalizeOsVersion(value: string): string {
	return value
		.split('.')
		.map((part) => String(Number(part)))
		.join('.')
}
