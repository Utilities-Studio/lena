import type { VaultInstanceId } from '@lena-inc/core'

// Opaque evidence and activation authority are intentionally process-local.
// Consumers must load one physical @lena-inc/vault module instance. Duplicate
// copies do not share authority and therefore fail closed.
const runtimeActiveVaultInstances = new WeakMap<object, VaultInstanceId>()

export function getRuntimeActiveVaultInstance(
	registry: object
): VaultInstanceId | undefined {
	return runtimeActiveVaultInstances.get(registry)
}

export function setRuntimeActiveVaultInstance(
	registry: object,
	vaultInstanceId: VaultInstanceId
): void {
	runtimeActiveVaultInstances.set(registry, vaultInstanceId)
}

export function preserveRuntimeActiveVaultInstance(
	source: object,
	target: object
): void {
	const activeVaultInstanceId = getRuntimeActiveVaultInstance(source)
	if (activeVaultInstanceId !== undefined) {
		setRuntimeActiveVaultInstance(target, activeVaultInstanceId)
	}
}
