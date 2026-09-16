import Storage from 'expo-sqlite/kv-store'
import { useSyncExternalStore } from 'react'
import { type output, type ZodType } from 'zod'

export type Store<Value> = {
	read: () => Value | null
	write: (value: Value) => void
	clear: () => void
	subscribe: (listener: () => void) => () => void
}

export type DefineStoreOptions<Schema extends ZodType> = {
	key: string
	schema: Schema
}

/** Non-sensitive JSON settings. Invalid saved values are unavailable, never deleted on read. */
export function defineStore<Schema extends ZodType>({
	key,
	schema
}: DefineStoreOptions<Schema>): Store<output<Schema>> {
	type Value = output<Schema>
	const listeners = new Set<() => void>()
	let cache: { raw: string | null; value: Value | null } | null = null

	function decode(raw: string | null): Value | null {
		if (raw === null) return null
		try {
			const parsed = schema.safeParse(JSON.parse(raw))
			return parsed.success ? parsed.data : null
		} catch {
			return null
		}
	}
	function notify() {
		for (const listener of listeners) listener()
	}
	function read(): Value | null {
		const raw = Storage.getItemSync(key)
		if (cache !== null && cache.raw === raw) return cache.value
		const value = decode(raw)
		cache = { raw, value }
		return value
	}

	return {
		read,
		write: (value) => {
			const parsed = schema.safeParse(value)
			if (!parsed.success) throw new TypeError('Invalid settings value')
			Storage.setItemSync(key, JSON.stringify(parsed.data))
			notify()
		},
		clear: () => {
			Storage.removeItemSync(key)
			notify()
		},
		subscribe: (listener) => {
			listeners.add(listener)
			return () => {
				listeners.delete(listener)
			}
		}
	}
}

export function useStoreValue<Value>(store: Store<Value>): Value | null {
	return useSyncExternalStore(store.subscribe, store.read, store.read)
}
