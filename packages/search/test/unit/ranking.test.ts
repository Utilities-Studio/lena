import { describe, expect, test } from 'bun:test'
import { ok } from '@lena-inc/core'
import { fuseHybridResults, normalizeFtsResults } from '../../src/index'

describe('lexical normalization', () => {
	test('deduplicates by best score and breaks ties by document id', () => {
		const normalized = normalizeFtsResults([
			{ documentId: 'b', score: -4 },
			{ documentId: 'a', score: -4 },
			{ documentId: 'b', score: -2 },
			{ documentId: 'c', score: 0 }
		])

		expect(normalized).toEqual(
			ok([
				{ documentId: 'a', normalizedScore: 1, rank: 1, rawScore: -4 },
				{ documentId: 'b', normalizedScore: 1, rank: 2, rawScore: -4 },
				{ documentId: 'c', normalizedScore: 0, rank: 3, rawScore: 0 }
			])
		)
	})

	test('rejects non-finite scores', () => {
		expect(
			normalizeFtsResults([{ documentId: 'a', score: Number.NaN }]).isOk()
		).toBe(false)
	})
})

describe('reciprocal rank fusion', () => {
	test('fuses modalities deterministically and retains modality ranks', () => {
		const fused = fuseHybridResults({
			lexical: [{ documentId: 'a' }, { documentId: 'b' }, { documentId: 'c' }],
			rankConstant: 10,
			semantic: [{ documentId: 'b' }, { documentId: 'a' }, { documentId: 'd' }]
		})

		if (fused.isErr()) throw fused.error
		expect(fused.value.map((result) => result.documentId)).toEqual([
			'a',
			'b',
			'c',
			'd'
		])
		expect(fused.value[0]).toMatchObject({ lexicalRank: 1, semanticRank: 2 })
		expect(fused.value[1]).toMatchObject({ lexicalRank: 2, semanticRank: 1 })
		expect(fused.value[2]).toMatchObject({ lexicalRank: 3, semanticRank: null })
	})

	test('uses document id as the final stable tie break', () => {
		const fused = fuseHybridResults({
			lexical: [{ documentId: 'z' }],
			lexicalWeight: 1,
			semantic: [{ documentId: 'a' }],
			semanticWeight: 1
		})
		expect(
			fused.isOk() && fused.value.map(({ documentId }) => documentId)
		).toEqual(['a', 'z'])
	})

	test('supports a missing modality and enforces weight bounds', () => {
		expect(
			fuseHybridResults({
				lexical: [{ documentId: 'only' }],
				semantic: [],
				semanticWeight: 0
			}).isOk()
		).toBe(true)
		expect(
			fuseHybridResults({
				lexical: [],
				lexicalWeight: 1.1,
				semantic: []
			}).isOk()
		).toBe(false)
		expect(
			fuseHybridResults({
				lexical: [],
				lexicalWeight: 0,
				semantic: [],
				semanticWeight: 0
			}).isOk()
		).toBe(false)
	})

	test('deduplicates modality lists without leaving rank gaps', () => {
		const fused = fuseHybridResults({
			lexical: [{ documentId: 'a' }, { documentId: 'a' }, { documentId: 'b' }],
			semantic: [],
			semanticWeight: 0
		})
		if (fused.isErr()) throw fused.error
		expect(fused.value).toEqual([
			{
				documentId: 'a',
				lexicalRank: 1,
				score: 1 / 61,
				semanticRank: null
			},
			{
				documentId: 'b',
				lexicalRank: 2,
				score: 1 / 62,
				semanticRank: null
			}
		])
	})
})
