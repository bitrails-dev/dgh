import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

// The backend TenantFeature union (collections/tenantFeatures.ts) and the frontend mirror
// (src/lib/tenant.ts) must define the identical set of feature keys — `hasFeature()`/`routeGated()`
// on the site and the access policy in the CMS branch on the same strings. This static check keeps
// them in sync without a build step.

const backendPath = fileURLToPath(new URL('../src/collections/tenantFeatures.ts', import.meta.url))
const frontendPath = fileURLToPath(new URL('../../src/lib/tenant.ts', import.meta.url))

function featureKeys(source: string, label: string): string[] {
  // Capture the type-alias body only (between `export type TenantFeature =` and the first `;` or
  // blank line), then pull out every quoted token. Stops before the labelled catalogue.
  const match = source.match(/export type TenantFeature\s*=\s*([\s\S]*?)(?:;|\n\s*\n)/)
  assert.ok(match, `${label}: could not locate the TenantFeature union`)
  const tokens = [...match[1].matchAll(/['"]([^'"]+)['"]/g)].map((m) => m[1])
  assert.ok(tokens.length > 0, `${label}: no feature keys parsed`)
  return tokens.sort()
}

test('backend and frontend expose the identical TenantFeature key set', () => {
  const backend = featureKeys(readFileSync(backendPath, 'utf8'), 'backend')
  const frontend = featureKeys(readFileSync(frontendPath, 'utf8'), 'frontend')
  assert.deepEqual(backend, frontend, 'TenantFeature keys drifted between CMS and frontend')
})

test('commerce is registered as a feature key on both sides', () => {
  const backend = featureKeys(readFileSync(backendPath, 'utf8'), 'backend')
  const frontend = featureKeys(readFileSync(frontendPath, 'utf8'), 'frontend')
  assert.ok(backend.includes('commerce'), 'backend missing commerce')
  assert.ok(frontend.includes('commerce'), 'frontend missing commerce')
})
