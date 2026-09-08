import { expect, test } from 'bun:test'
import { assert, property, string } from 'fast-check'

import { buildFts5Query } from '../../src'

function hasForbiddenControl(value: string): boolean {
	return Array.from(value).some((character) => {
		const codePoint = character.codePointAt(0)
		return (
			codePoint !== undefined &&
			(codePoint <= 8 ||
				(codePoint >= 11 && codePoint <= 12) ||
				(codePoint >= 14 && codePoint <= 31) ||
				codePoint === 127)
		)
	})
}

test('FTS phrase compilation preserves arbitrary text as quoted data', () => {
	assert(
		property(
			string({ maxLength: 128 }).filter((value) => {
				const normalized = value.normalize('NFC').replace(/\s+/gu, ' ').trim()
				return normalized.length > 0 && !hasForbiddenControl(value)
			}),
			(text) => {
				const normalized = text.normalize('NFC').replace(/\s+/gu, ' ').trim()
				const compiled = buildFts5Query({
					clauses: [{ kind: 'phrase', text }],
					mode: 'all'
				})

				expect(compiled.isOk()).toBe(true)
				if (compiled.isOk()) {
					expect(compiled.value.matchParameter).toBe(
						`("${normalized.replaceAll('"', '""')}")`
					)
				}
			}
		)
	)
})
