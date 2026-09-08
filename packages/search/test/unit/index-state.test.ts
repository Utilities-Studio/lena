import { describe, expect, test } from 'bun:test'
import { ok } from '@lena-inc/core'
import {
	ABSENT_SEARCH_INDEX,
	createSearchDeletionPlan,
	createSearchIndexIdentity,
	isSameSearchIndexIdentity,
	parseVectorIndexMetadata,
	transitionSearchIndexRebuild,
	validateEmbeddingForIndex
} from '../../src/index'

const MODEL_ID = '11111111-1111-4111-8111-111111111111'

function indexIdentity(dimensions = 384) {
	const identity = createSearchIndexIdentity({
		schemaVersion: 2,
		sourceProjection: 'journal-search-v3',
		tokenizer: {
			name: 'unicode61',
			options: { tokenchars: '-_', remove_diacritics: 2 },
			version: 'fts5-v1'
		},
		vector: {
			dimensions,
			distanceMetric: 'cosine',
			modelId: MODEL_ID,
			modelVersion: '1.2.0'
		}
	})
	if (identity.isErr()) throw identity.error
	return identity.value
}

describe('index identity and vectors', () => {
	test('canonicalizes tokenizer option order', () => {
		const first = indexIdentity()
		const second = createSearchIndexIdentity({
			schemaVersion: 2,
			sourceProjection: 'journal-search-v3',
			tokenizer: {
				name: 'unicode61',
				options: { remove_diacritics: 2, tokenchars: '-_' },
				version: 'fts5-v1'
			},
			vector: {
				dimensions: 384,
				distanceMetric: 'cosine',
				modelId: MODEL_ID,
				modelVersion: '1.2.0'
			}
		})
		expect(
			second.isOk() && isSameSearchIndexIdentity(first, second.value)
		).toBe(true)
		expect(isSameSearchIndexIdentity(first, indexIdentity(768))).toBe(false)
	})

	test('validates vector dimensions and finite components', () => {
		const metadata = parseVectorIndexMetadata({
			dimensions: 3,
			distanceMetric: 'dot',
			modelId: MODEL_ID,
			modelVersion: 'v1'
		})
		if (metadata.isErr()) throw metadata.error
		expect(validateEmbeddingForIndex([1, 2, 3], metadata.value).isOk()).toBe(
			true
		)
		expect(validateEmbeddingForIndex([1, 2], metadata.value).isOk()).toBe(false)
		expect(
			validateEmbeddingForIndex(
				[1, Number.POSITIVE_INFINITY, 3],
				metadata.value
			).isOk()
		).toBe(false)
	})
})

describe('rebuild lifecycle', () => {
	test('resumes exactly from a committed checkpoint', () => {
		const requested = transitionSearchIndexRebuild(ABSENT_SEARCH_INDEX, {
			rebuildId: 'rebuild-1',
			sourceRevision: 'entries-r42',
			targetIdentity: indexIdentity(),
			type: 'rebuild_requested'
		})
		if (requested.isErr()) throw requested.error
		const committed = transitionSearchIndexRebuild(requested.value, {
			nextCursor: 'entry-100',
			rebuildId: 'rebuild-1',
			removedDocuments: 2,
			type: 'batch_committed',
			upsertedDocuments: 100
		})
		if (committed.isErr()) throw committed.error
		const failed = transitionSearchIndexRebuild(committed.value, {
			errorCode: 'temporarily_unavailable',
			rebuildId: 'rebuild-1',
			type: 'rebuild_failed'
		})
		if (failed.isErr()) throw failed.error
		const resumed = transitionSearchIndexRebuild(failed.value, {
			rebuildId: 'rebuild-1',
			type: 'resume_requested'
		})

		if (resumed.isErr()) throw resumed.error
		expect(resumed.value.status).toBe('rebuilding')
		if (resumed.value.status !== 'rebuilding') {
			throw new Error('Expected a rebuilding search index state')
		}
		expect(resumed.value.checkpoint).toEqual({
			cursor: 'entry-100',
			removedDocuments: 2,
			upsertedDocuments: 100
		})

		const completed = transitionSearchIndexRebuild(resumed.value, {
			documentCount: 98,
			rebuildId: 'rebuild-1',
			type: 'rebuild_completed'
		})
		expect(completed.isOk() && completed.value.status).toBe('ready')
	})

	test('discarding a failed replacement preserves the prior ready index', () => {
		const initial = transitionSearchIndexRebuild(ABSENT_SEARCH_INDEX, {
			rebuildId: 'rebuild-1',
			sourceRevision: 'r1',
			targetIdentity: indexIdentity(),
			type: 'rebuild_requested'
		})
		if (initial.isErr()) throw initial.error
		const ready = transitionSearchIndexRebuild(initial.value, {
			documentCount: 10,
			rebuildId: 'rebuild-1',
			type: 'rebuild_completed'
		})
		if (ready.isErr()) throw ready.error
		const replacement = transitionSearchIndexRebuild(ready.value, {
			rebuildId: 'rebuild-2',
			sourceRevision: 'r2',
			targetIdentity: indexIdentity(768),
			type: 'rebuild_requested'
		})
		if (replacement.isErr()) throw replacement.error
		const failed = transitionSearchIndexRebuild(replacement.value, {
			errorCode: 'integrity_failed',
			rebuildId: 'rebuild-2',
			type: 'rebuild_failed'
		})
		if (failed.isErr()) throw failed.error
		const discarded = transitionSearchIndexRebuild(failed.value, {
			rebuildId: 'rebuild-2',
			type: 'discard_requested'
		})

		expect(discarded).toEqual(ready)
	})

	test('rejects late work from a superseded rebuild', () => {
		const first = transitionSearchIndexRebuild(ABSENT_SEARCH_INDEX, {
			rebuildId: 'rebuild-old',
			sourceRevision: 'r1',
			targetIdentity: indexIdentity(),
			type: 'rebuild_requested'
		})
		if (first.isErr()) throw first.error
		const replacement = transitionSearchIndexRebuild(first.value, {
			rebuildId: 'rebuild-new',
			sourceRevision: 'r2',
			targetIdentity: indexIdentity(768),
			type: 'rebuild_requested'
		})
		if (replacement.isErr()) throw replacement.error

		expect(
			transitionSearchIndexRebuild(replacement.value, {
				documentCount: 100,
				rebuildId: 'rebuild-old',
				type: 'rebuild_completed'
			}).isOk()
		).toBe(false)
		expect(
			transitionSearchIndexRebuild(replacement.value, {
				nextCursor: 'late-cursor',
				rebuildId: 'rebuild-old',
				removedDocuments: 0,
				type: 'batch_committed',
				upsertedDocuments: 1
			}).isOk()
		).toBe(false)
	})

	test('canonical deletion always targets lexical and vector derivatives', () => {
		expect(createSearchDeletionPlan('entry-7', 'revision-9')).toEqual(
			ok({
				documentId: 'entry-7',
				operations: ['delete_lexical', 'delete_vector'],
				sourceRevision: 'revision-9'
			})
		)
	})
})
