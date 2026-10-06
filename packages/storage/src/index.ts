import Storage from 'expo-sqlite/kv-store'
import {
	type core,
	type output,
	type ZodExactOptional,
	type ZodObject
} from 'zod'
import { type PersistStorage } from 'zustand/middleware'

export * from 'zustand-x'

type SavedSettings<
	Shape extends core.$ZodShape,
	Config extends core.$ZodObjectConfig
> = output<
	ZodObject<
		{ -readonly [K in keyof Shape]: ZodExactOptional<Shape[K]> },
		Config
	>
>

/**
 * zustand `persist` storage for non-sensitive JSON settings in `expo-sqlite/kv-store`.
 *
 * The persist `name` is the kv key, and the value is the store state as plain JSON, so keys written
 * before zustand-x load unchanged. Reads accept a partial object so persist merges newly added
 * fields from the initial state. Absent, malformed or schema-invalid values load as nothing and are
 * never deleted on read. Writes validate the whole state and never persist an invalid value.
 */
export function createLenaStorage<
	Shape extends core.$ZodShape,
	Config extends core.$ZodObjectConfig
>(
	schema: ZodObject<Shape, Config>
): PersistStorage<SavedSettings<Shape, Config>> {
	const saved = schema.exactPartial()
	return {
		getItem: (key) => {
			const raw = Storage.getItemSync(key)
			if (raw === null) return null
			let json: unknown
			try {
				json = JSON.parse(raw)
			} catch {
				return null
			}
			const parsed = saved.safeParse(json)
			// The saved bytes carry no persist version wrapper, so they always load as version 0.
			return parsed.success ? { state: parsed.data, version: 0 } : null
		},
		setItem: (key, { state }) => {
			const parsed = schema.safeParse(state)
			if (!parsed.success) throw new TypeError('Invalid settings value')
			Storage.setItemSync(key, JSON.stringify(parsed.data))
		},
		removeItem: (key) => {
			Storage.removeItemSync(key)
		}
	}
}
