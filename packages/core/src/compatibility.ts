import { z } from 'zod'
import { LenaError } from './errors'
import { err, ok, type Result } from './result'

export const schemaVersionSchema = z.int().min(1).brand<'SchemaVersion'>()

export type SchemaVersion = z.infer<typeof schemaVersionSchema>

export function parseSchemaVersion(
	value: unknown
): Result<SchemaVersion, LenaError> {
	const parsed = schemaVersionSchema.safeParse(value)
	if (!parsed.success) {
		return err(new LenaError('invalid_input'))
	}

	return ok(parsed.data)
}
