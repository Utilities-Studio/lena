import { beforeEach, describe, expect, mock, test } from 'bun:test'
import { assert, constantFrom, property, record, string } from 'fast-check'
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
// react-tracked's browser build imports react-dom; Metro resolves its React Native build instead.
await mock.module('react-dom', () => ({
	unstable_batchedUpdates: (update: () => void) => {
		update()
	}
}))
const { createLenaStorage, createStore } = await import('../src/index')

const schema = z.strictObject({
	name: z.string().min(1),
	theme: z.enum(['light', 'dark'])
})
type Profile = z.output<typeof schema>
const initial: Profile = { name: 'Guest', theme: 'light' }
const makeStore = () =>
	createStore(initial, {
		name: 'profile',
		mutative: true,
		persist: { enabled: true, storage: createLenaStorage(schema) }
	})

beforeEach(() => {
	values.clear()
	values.set('neighbor', 'preserved')
	setItemSync.mockClear()
	removeItemSync.mockClear()
})

describe('Lena zustand-x storage', () => {
	test('missing settings keep the initial state and write nothing', () => {
		const store = makeStore()
		expect(store.get('state')).toEqual(initial)
		expect(setItemSync).not.toHaveBeenCalled()
		expect(values.has('profile')).toBe(false)
	})
	test('saved settings load synchronously when the store is created', () => {
		values.set('profile', '{"name":"Ada","theme":"dark"}')
		const store = makeStore()
		expect(store.store.persist.hasHydrated()).toBe(true)
		expect(store.get('state')).toEqual({ name: 'Ada', theme: 'dark' })
		expect(setItemSync).not.toHaveBeenCalled()
	})
	test('writes keep the existing raw JSON format under the same key', () => {
		values.set('profile', '{"name":"Ada","theme":"dark"}')
		const store = makeStore()
		store.set('name', 'Lin')
		expect(setItemSync).toHaveBeenLastCalledWith(
			'profile',
			'{"name":"Lin","theme":"dark"}'
		)
		expect(values.get('neighbor')).toBe('preserved')
	})
	test('saved settings without a newer field merge with its initial value', () => {
		values.set('profile', '{"name":"Ada"}')
		const store = makeStore()
		expect(store.get('state')).toEqual({ name: 'Ada', theme: 'light' })
		expect(values.get('profile')).toBe('{"name":"Ada"}')
	})
	test.each([
		['malformed JSON', 'not json'],
		['a non-object value', '"Ada"'],
		['a schema-invalid field', '{"name":"","theme":"dark"}'],
		['an unknown field', '{"name":"Ada","theme":"dark","extra":true}']
	])(
		'%s loads the initial state and is never deleted on read',
		(_case, raw) => {
			values.set('profile', raw)
			const store = makeStore()
			expect(store.get('state')).toEqual(initial)
			expect(values.get('profile')).toBe(raw)
			expect(setItemSync).not.toHaveBeenCalled()
			expect(removeItemSync).not.toHaveBeenCalled()
		}
	)
	test('an invalid state is never persisted and fails without Zod details', () => {
		values.set('profile', '{"name":"Ada","theme":"dark"}')
		const store = makeStore()
		expect(() => store.set('name', '')).toThrow(
			new TypeError('Invalid settings value')
		)
		expect(values.get('profile')).toBe('{"name":"Ada","theme":"dark"}')
		expect(makeStore().get('name')).toBe('Ada')
	})
	test('actions that validate before set keep memory and storage unchanged', () => {
		const store = makeStore().extendActions(({ set }) => ({
			rename: (name: string) => {
				set('name', schema.shape.name.parse(name))
			}
		}))
		store.actions.rename('Ada')
		expect(() => store.actions.rename('')).toThrow()
		expect(store.get('name')).toBe('Ada')
		expect(values.get('profile')).toBe('{"name":"Ada","theme":"light"}')
	})
	test('Expo write failures propagate and keep the saved bytes', () => {
		values.set('profile', '{"name":"Ada","theme":"dark"}')
		const store = makeStore()
		setItemSync.mockImplementationOnce(() => {
			throw new Error('write unavailable')
		})
		expect(() => store.set('name', 'Lin')).toThrow('write unavailable')
		expect(values.get('profile')).toBe('{"name":"Ada","theme":"dark"}')
	})
	test('clearing storage removes only the store key', () => {
		const store = makeStore()
		store.set('name', 'Ada')
		store.store.persist.clearStorage()
		expect(removeItemSync).toHaveBeenCalledWith('profile')
		expect(values.has('profile')).toBe(false)
		expect(values.get('neighbor')).toBe('preserved')
	})
	test('object schemas with refinements are rejected when the storage is created', () => {
		const refined = schema.refine((profile) => profile.name !== profile.theme)
		expect(() => createLenaStorage(refined)).toThrow()
	})
	test('valid states persist byte-identically and load back unchanged', () => {
		assert(
			property(
				record({
					name: string({ minLength: 1 }),
					theme: constantFrom('light', 'dark')
				}),
				(profile) => {
					values.delete('profile')
					makeStore().set('state', profile)
					expect(values.get('profile')).toBe(JSON.stringify(profile))
					expect(makeStore().get('state')).toEqual(profile)
					expect(values.get('neighbor')).toBe('preserved')
				}
			)
		)
	})
	test('arbitrary corrupt bytes never change when a store loads', () => {
		assert(
			property(string(), (raw) => {
				values.set('profile', raw)
				makeStore()
				expect(values.get('profile')).toBe(raw)
			})
		)
	})
})
