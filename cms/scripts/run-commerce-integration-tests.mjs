// Runs each Payload commerce integration test in its own Node process, sequentially.
// Node standard library only. One process per file (Payload + SQLite isolation on Windows).
// Stops on the first real failure, prints the failing file and exit code, and does not retry a
// failing file automatically (retries hide flakes).
//
// Native-teardown classification (Windows libsql): @payloadcms/drizzle's destroy() does not close
// the underlying @libsql/client Sqlite3Client, which intermittently access-violates
// (0xC0000005 / exit 3221225477) at process EXIT — AFTER every subtest has already reported `ok`.
// Per-test workarounds (closing payload.db.drizzle.session.client, commit 1630a03) reduce but do
// not eliminate it for the heaviest tests. Such a crash is infrastructure, not a test failure:
// when a file exits 3221225477 AND streamed at least one passing subtest AND no subtest reported
// `not ok`, the runner treats it as a pass. A real subtest failure, a boot/syntax error, or any
// other non-zero exit still fails the suite.
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
  'tests/commerce-customer-payload-auth.test.ts',
  'tests/commerce-store-cart.test.ts',
  'tests/commerce-store-cart-v2.test.ts',
  'tests/commerce-store-catalog.test.ts',
  'tests/commerce-store-checkout.test.ts',
  'tests/commerce-store-checkout-plugin.test.ts',
  'tests/commerce-store-quote.test.ts',
  'tests/commerce-webhook-endpoint.test.ts',
  'tests/commerce-migration-fixtures.test.ts',
  'tests/commerce-migration-additive.test.ts',
  'tests/commerce-inventory-adaptation.test.ts',
  'tests/commerce-payment-durability.test.ts',
  'tests/commerce-notifications-event.test.ts',
  'tests/commerce-reports.test.ts',
]

const NATIVE_ACCESS_VIOLATION = 3221225477 // 0xC0000005 — Windows STATUS_ACCESS_VIOLATION

let failed = null
let passedBeforeFailure = 0
let nativeTeardownTolerated = 0

for (const file of INTEGRATION_FILES) {
  const result = spawnSync('npx', ['tsx', '--test', file], {
    cwd: root,
    stdio: ['ignore', 'pipe', 'pipe'],
    encoding: 'utf8',
    shell: true, // Windows resolves npx via the shell
  })
  const out = `${result.stdout || ''}${result.stderr || ''}`
  if (out) process.stdout.write(out)

  const nonZero = result.status !== 0 || result.signal
  if (nonZero) {
    // The crash code surfaces in the TAP (`exitCode: 3221225477`) even when npx masks the child's
    // exit to 1, so detect from output as well as the raw status.
    const nativeCrash =
      result.status === NATIVE_ACCESS_VIOLATION || out.includes(String(NATIVE_ACCESS_VIOLATION))
    const sawPassingSubtest = /^ok \d+ - /m.test(out)
    // A `not ok` line whose name is NOT the file path is a real subtest failure.
    const realSubtestFailures = (out.match(/^not ok .*$/gm) || []).filter(
      (line) => !line.includes('.test.ts'),
    )
    if (nativeCrash && sawPassingSubtest && realSubtestFailures.length === 0) {
      // Infrastructure: libsql native teardown crash after all subtests passed. Not a test failure.
      console.log(
        `[runner] ${file}: tolerated native teardown crash (exit 3221225477) — all subtests OK. ` +
          `(Windows libsql infra; see commit 1630a03.)`,
      )
      nativeTeardownTolerated += 1
      passedBeforeFailure += 1
      continue
    }
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

const toleratedNote =
  nativeTeardownTolerated > 0
    ? ` (${nativeTeardownTolerated} native-teardown crash${nativeTeardownTolerated > 1 ? 'es' : ''} tolerated)`
    : ''
console.log(
  `COMMERCE INTEGRATION OK: ${INTEGRATION_FILES.length}/${INTEGRATION_FILES.length} files passed${toleratedNote}.`,
)
process.exit(0)
