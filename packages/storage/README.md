# @lena-inc/storage

Typed settings for Expo apps, backed by `expo-sqlite/kv-store`.

```ts
import { defineStore, useStoreValue } from '@lena-inc/storage'
import { z } from 'zod'

export const languageStore = defineStore({
	key: 'my-app.language',
	schema: z.strictObject({ preference: z.string() })
})

// In a component:
// const language = useStoreValue(languageStore)
languageStore.write({ preference: 'en' })
```

One entry point. No backend selection, adapters or React/Expo subpaths.
React and Expo SQLite are required host peers. Apps own keys, schemas and defaults.

- Reads return `null` for absent, malformed or schema-invalid JSON without deleting saved bytes.
- Valid snapshots keep a stable reference while raw storage is unchanged.
- Writes validate before persisting. Invalid caller values throw a safe `TypeError`, not raw Zod
  diagnostics. Expo I/O failures propagate without notifying subscribers.
- Successful writes and clears notify that store's subscribers. `useStoreValue` uses React's
  `useSyncExternalStore`. Keep one exported store instance per key; direct SQLite writes do not
  broadcast through this store.

This is ordinary settings persistence, not encryption, SecureStore, backups, sync or a vault
database. Never use it for secrets, canonical travel/journal data or access authority. A saved
identifier remains a hint. The app's existing vault validation still owns all authority.

Tests mock `expo-sqlite/kv-store` at its owning module. They do not prove native/device behavior.
