import { err, LenaError, type Result } from '@lena-inc/core'

import type { SyncChangeId } from './identifiers'

export type SyncMode = 'hosted_sync' | 'private_vault'

export interface DisabledSyncCapability {
	readonly canDownload: false
	readonly canUpload: false
	readonly mode: SyncMode
	readonly reason: 'milestone_not_approved' | 'private_vault'
	readonly status: 'disabled'
}

export const PRIVATE_VAULT_SYNC_CAPABILITY: DisabledSyncCapability =
	Object.freeze({
		canDownload: false,
		canUpload: false,
		mode: 'private_vault' as const,
		reason: 'private_vault' as const,
		status: 'disabled' as const
	})

export const INITIAL_HOSTED_SYNC_CAPABILITY: DisabledSyncCapability =
	Object.freeze({
		canDownload: false,
		canUpload: false,
		mode: 'hosted_sync' as const,
		reason: 'milestone_not_approved' as const,
		status: 'disabled' as const
	})

export interface SyncUploadPlanRequest {
	readonly changeIds: readonly SyncChangeId[]
}

export interface SyncUploadPlan {
	readonly changeIds: readonly SyncChangeId[]
	readonly mode: 'hosted_sync'
}

export function planSyncUpload(
	capability: DisabledSyncCapability,
	_request: SyncUploadPlanRequest
): Result<SyncUploadPlan, LenaError> {
	return err(
		new LenaError('unsupported', {
			boundary: 'sync_upload_plan',
			mode: capability.mode,
			reason: capability.reason
		})
	)
}
