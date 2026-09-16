import { beforeEach, describe, expect, mock, test } from 'bun:test'
import { assert, jsonValue, property, string } from 'fast-check'
import { z } from 'zod'

const values = new Map<string, string>()
const getItemSync = mock((key: string) => values.get(key) ?? null)
const setItemSync = mock((key: string, value: string) => {
	values.set(key, value)
})
const removeItemSync = mock((key: string) => {
	values.delete(key)
})
await mock.module('expo-sqlite/kv-store', () => ({
	default: { getItemSync, setItemSync, removeItemSync }
}))
const { defineStore } = await import('../src/index')
const schema = z.strictObject({ name: z.string().min(1) })
const makeStore = () => defineStore({ key: 'profile', schema })
beforeEach(() => {
	values.clear()
})

describe('Expo settings store', () => {
	test('missing settings return null', () => {
		expect(makeStore().read()).toBeNull()
	})
	test('round-trips an existing app key without changing its JSON representation', () => {
		values.set('profile', '{"name":"Ada"}')
		const store = makeStore()
		expect(store.read()).toEqual({ name: 'Ada' })
		store.write({ name: 'Lin' })
		expect(setItemSync).toHaveBeenLastCalledWith('profile', '{"name":"Lin"}')
	})
	test('malformed JSON is unavailable but never deleted', () => {
		values.set('profile', 'not json')
		expect(makeStore().read()).toBeNull()
		expect(values.get('profile')).toBe('not json')
	})
	test('schema-invalid JSON is unavailable but never deleted', () => {
		values.set('profile', '{"name":""}')
		expect(makeStore().read()).toBeNull()
		expect(values.get('profile')).toBe('{"name":""}')
	})
	test('unchanged raw data keeps a stable snapshot', () => {
		const store = makeStore()
		store.write({ name: 'Ada' })
		expect(store.read()).toBe(store.read())
	})
	test('changed raw data replaces the snapshot', () => {
		const store = makeStore()
		store.write({ name: 'Ada' })
		const first = store.read()
		store.write({ name: 'Lin' })
		expect(store.read()).not.toBe(first)
	})
	test('clear removes only the selected key', () => {
		values.set('neighbor', 'preserved')
		const store = makeStore()
		store.write({ name: 'Ada' })
		store.clear()
		expect(store.read()).toBeNull()
		expect(values.get('neighbor')).toBe('preserved')
	})
	test('successful writes and clear notify subscribers', () => {
		const store = makeStore()
		let calls = 0
		store.subscribe(() => {
			calls += 1
		})
		store.write({ name: 'Ada' })
		store.clear()
		expect(calls).toBe(2)
	})
	test('unsubscribe removes the listener', () => {
		const store = makeStore()
		let calls = 0
		const unsubscribe = store.subscribe(() => {
			calls += 1
		})
		unsubscribe()
		store.write({ name: 'Ada' })
		expect(calls).toBe(0)
	})
	test('invalid writes preserve the old value without exposing Zod payloads', () => {
		const store = makeStore()
		store.write({ name: 'Ada' })
		let calls = 0
		store.subscribe(() => {
			calls += 1
		})
		expect(() => store.write({ name: '' })).toThrow('Invalid settings value')
		expect(store.read()).toEqual({ name: 'Ada' })
		expect(calls).toBe(0)
	})
	test('Expo failures never notify or replace the last committed value', () => {
		values.set('profile', '{"name":"Ada"}')
		const store = makeStore()
		let calls = 0
		store.subscribe(() => {
			calls += 1
		})
		setItemSync.mockImplementationOnce(() => {
			throw new Error('write unavailable')
		})
		removeItemSync.mockImplementationOnce(() => {
			throw new Error('remove unavailable')
		})
		expect(() => store.write({ name: 'Lin' })).toThrow('write unavailable')
		expect(() => store.clear()).toThrow('remove unavailable')
		expect(store.read()).toEqual({ name: 'Ada' })
		expect(calls).toBe(0)
	})
	test('JSON settings round-trip without changing neighboring keys', () => {
		assert(
			property(jsonValue(), (value) => {
				values.set('neighbor', 'preserved')
				const store = defineStore({ key: 'settings', schema: z.json() })
				store.write(z.json().parse(value))
				expect(store.read()).toEqual(JSON.parse(JSON.stringify(value)))
				expect(values.get('neighbor')).toBe('preserved')
			})
		)
	})
	test('arbitrary corrupt reads never mutate persisted bytes', () => {
		assert(
			property(string(), (raw) => {
				values.set('profile', raw)
				makeStore().read()
				expect(values.get('profile')).toBe(raw)
			})
		)
	})
})
