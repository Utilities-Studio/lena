import { defineConfig } from 'tsdown'

export default defineConfig({
	attw: {
		level: 'error',
		profile: 'esm-only'
	},
	clean: true,
	deps: {
		neverBundle: true
	},
	dts: true,
	entry: ['src/index.ts'],
	failOnWarn: true,
	format: 'esm',
	hash: false,
	platform: 'neutral',
	publint: {
		level: 'error'
	},
	sourcemap: false,
	suppressWarnings: [
		'TypeScript 7.0 does not yet have a stable API and is experimental. Some options will be unavailable.'
	],
	target: 'es2022',
	treeshake: true,
	workspace: 'packages/*'
})
