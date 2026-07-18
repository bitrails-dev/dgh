// Runs each Payload commerce integration test in its own Node process, sequentially.
// Node standard library only. One process per file (Payload + SQLite isolation on Windows —
// see remediation plan §0 rule 13). Stops on the first non-zero exit, prints the failing file
// and exit code, and does not retry a failing file automatically (retries hide flakes).
//
// Pure (non-Payload) unit tests are NOT listed here — they run via `npm run test:commerce:unit`.

import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')

// Explicit ordered list of Payload-initializing commerce integration tests.
const INTEGRATION_FILES = [
  'tests/commerce-capture-commit.test.ts',
  'tests/commerce-carts-customers.test.ts',
  'tests/commerce-checkout.test.ts',
  'tests/commerce-inventory.test.ts',
  'tests/commerce-orders.test.ts',
  'tests/commerce-payments-ingest.test.ts',
  'tests/commerce-state-enforcement.test.ts',
  'tests/commerce-store-auth.test.ts',
  'tests/commerce-store-cart.test.ts',
  'tests/commerce-store-catalog.test.ts',
  'tests/commerce-store-checkout.test.ts',
  'tests/commerce-store-quote.test.ts',
  'tests/commerce-webhook-endpoint.test.ts',
]

let failed = null
let passedBeforeFailure = 0

for (const file of INTEGRATION_FILES) {
  const result = spawnSync('npx', ['tsx', '--test', file], {
    cwd: root,
    stdio: 'inherit',
    shell: true, // Windows resolves npx via the shell
  })
  // A native process crash (null status / killed by signal) is not a pass.
  if (result.status !== 0 || result.signal) {
    failed = { file, status: result.signal ? `signal ${result.signal}` : result.status }
    break
  }
  passedBeforeFailure += 1
}

console.log('')
if (failed) {
  console.error(
    `COMMERCE INTEGRATION FAILURE: ${failed.file} exited with ${failed.status}. ` +
      `${passedBeforeFailure}/${INTEGRATION_FILES.length} files passed before the failure.`,
  )
  process.exit(typeof failed.status === 'number' ? failed.status : 1)
}

console.log(`COMMERCE INTEGRATION OK: ${INTEGRATION_FILES.length}/${INTEGRATION_FILES.length} files passed.`)
process.exit(0)
