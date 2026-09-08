import { expect, test } from 'bun:test'
import { assert, integer, property, string } from 'fast-check'

import { chunkText } from '../../src'

test('zero-overlap chunks reconstruct every generated source exactly', () => {
	assert(
		property(
			string({ maxLength: 512 }),
			integer({ min: 1, max: 64 }),
			(text, maximumCodePoints) => {
				const chunks = chunkText({
					maximumCodePoints,
					overlapCodePoints: 0,
					sourceId: 'property-source',
					sourceRevision: 'revision-1',
					text
				})

				expect(chunks.isOk()).toBe(true)
				if (chunks.isOk()) {
					expect(chunks.value.map((chunk) => chunk.text).join('')).toBe(text)
					expect(
						chunks.value.every(
							(chunk) => chunk.endCodePoint > chunk.startCodePoint
						)
					).toBe(true)
				}
			}
		)
	)
})
