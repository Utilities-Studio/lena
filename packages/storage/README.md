# @lena-inc/storage

zustand-x settings stores for Expo apps, persisted in `expo-sqlite/kv-store`.

```ts
import {
	createLenaStorage,
	createStore,
	useStoreValue
} from '@lena-inc/storage'
import { z } from 'zod'

const languageSchema = z.strictObject({
	preference: z.enum(['system', 'en', 'fr'])
})
const initialLanguage: z.output<typeof languageSchema> = {
	preference: 'system'
}

export const languageStore = createStore(initialLanguage, {
	name: 'my-app.language',
	mutative: true,
	persist: { enabled: true, storage: createLenaStorage(languageSchema) }
}).extendActions(({ set }) => ({
	setPreference: (value: unknown) => {
		set('preference', languageSchema.shape.preference.parse(value))
	}
}))

// In a component:
// const preference = useStoreValue(languageStore, 'preference')
```

One entry point. It re-exports zustand-x unchanged and adds `createLenaStorage`. React, Expo
SQLite and zustand are host peers; zustand-x and mutative come with Lena. Apps own store names,
schemas, initial state and actions.

- The store `name` is the kv key. The value is the store state as plain JSON with no persist
  wrapper, so keys written by `defineStore` in 0.2 load unchanged.
- Saved settings load synchronously while the store is created, so the first render already has
  them.
- Reads accept a partial object. A field added after the value was saved takes its initial value.
- Absent, malformed or schema-invalid saved JSON loads as the initial state. Reads never delete or
  rewrite saved bytes, but the next write saves the whole current state over them.
- Writes validate the whole state. An invalid state is never persisted and throws a safe
  `TypeError`, not raw Zod diagnostics. Expo I/O failures propagate.
- zustand's `persist` saves after the in-memory state changes, so a rejected or failed write
  leaves memory ahead of storage. Validate input in actions before calling `set`.
- The schema must be a Zod object without object-level refinements, because reads use its
  partial form. Keep cross-field rules in actions.
- Do not set a persist `version` or `migrate`. Saved bytes carry no version, so shape changes
  belong in the schema.

This is ordinary settings persistence, not encryption, SecureStore, backups, sync or a vault
database. Never use it for secrets, canonical travel/journal data or access authority. A saved
identifier remains a hint. The app's existing vault validation still owns all authority.

## Migrating from 0.2

`defineStore` and the old `useStoreValue(store)` are removed. For each `defineStore({ key, schema })`:

1. Create `createStore(initial, { name: key, mutative: true, persist: { enabled: true, storage:
createLenaStorage(schema) } })`, where `initial` is the default the app used for a `null` read.
   Model "not saved yet" as a nullable field in the state and schema.
2. Move `read`/`write` helpers into `extendActions` and derived values into `extendSelectors`.
3. Replace `useStoreValue(store) ?? DEFAULT` with `useStoreValue(store, 'field')` for each field a
   component reads, and `store.read()` with `store.get('state')`.
4. Replace `store.clear()` with `store.set('state', initial)` followed by
   `store.store.persist.clearStorage()`, so memory resets and the key is removed.

Install `zustand` in the app. Every app in a repository must move to the same Lena version.

Tests mock `expo-sqlite/kv-store` at its owning module and replace the `react-dom` import of
react-tracked's browser build. They do not prove native/device behavior.
