// Runbook §8 — "Empty + copied-real DB rehearsals" automation. Operator gate: before a release,
// prove the versioned migrations apply cleanly to (1) a fresh empty SQLite DB and (2) a temp copy
// of the dev cms.db. Never touches the real cms.db — always operates on throwaway temp copies.
//
// Two legs, each printed as PASS/FAIL/SKIP:
//   1. EMPTY-DB     — fresh temp file, run ALL migrations, assert they apply cleanly (at head).
//   2. COPIED-REAL  — temp copy of cms.db, boot, confirm AT HEAD, prove re-running migrate is a
//                     no-op (idempotent). Cleanly SKIPs if cms.db doesn't exist.
//
// TWO BOOTS IN ONE PROCESS AREN'T SAFE — the sqlite adapter captures DATABASE_URI at config-build
// time, so the second leg would reuse the first leg's URI. This file is BOTH orchestrator and
// worker: the orchestrator spawns a fresh `npx tsx` worker subprocess per leg for clean env-var
// isolation (same Windows-safe spawn pattern as scripts/run-commerce-integration-tests.mjs). The
// worker writes a one-line JSON result to a temp file so stdout parsing isn't fragile against
// Payload's boot noise.
import 'dotenv/config'
import { spawnSync } from 'node:child_process'
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const SELF = resolve(HERE, 'rehearse-migrations.ts')
const ROOT = resolve(HERE, '..')
// DEV_DB_OVERRIDE lets operators point the COPIED-REAL leg at a snapshot elsewhere (e.g. a staging
// DB pull) without copying it to cms.db first. Defaults to the local dev DB at cms/cms.db.
const DEV_DB = process.env.DEV_DB_OVERRIDE ? resolve(process.env.DEV_DB_OVERRIDE) : resolve(ROOT, 'cms.db')

type LegResult = { name: string; status: 'PASS' | 'FAIL' | 'SKIP'; detail: string }
type WorkerResult = { ok: true; applied: number; atHead: number } | { ok: false; error: string }

// ── worker mode: argv = ['node', SELF, 'worker', <dbPath>, <resultPath>] ───────────────────────
async function runWorker(): Promise<void> {
  const dbPath = process.argv[3]!
  const resultPath = process.argv[4]!
  process.env.DATABASE_URI = `file:${dbPath}`
  process.env.PAYLOAD_SECRET = process.env.PAYLOAD_SECRET || 'rehearse-migrations-secret'
  process.env.PAYLOAD_PUBLIC_SERVER_URL = process.env.PAYLOAD_PUBLIC_SERVER_URL || 'http://localhost:3001'
  const write = (r: WorkerResult) => { try { writeFileSync(resultPath, JSON.stringify(r)) } catch { /* */ } }
  try {
    const { default: config } = await import('../src/payload.config')
    const { getPayload } = await import('payload')
    const payload = await getPayload({ config })
    try {
      // Count of recorded migrations, tolerant of a fresh DB where payload_migrations doesn't exist
      // yet (migrate() creates it). Returns 0 pre-migrate on a truly empty DB.
      const safeCount = async (): Promise<number> => {
        try {
          return (await payload.count({ collection: 'payload-migrations', overrideAccess: true })).totalDocs
        } catch {
          return 0
        }
      }
      // Drop the dev-push marker (batch=-1) so payload.db.migrate() skips its non-TTY segfault
      // prompt — same trick as scripts/migrate-dev.ts. No-op when the marker (or the table) is absent.
      try {
        await payload.delete({
          collection: 'payload-migrations',
          where: { batch: { equals: -1 } },
          overrideAccess: true,
        })
      } catch { /* fresh DB — payload_migrations table doesn't exist yet */ }
      const before = await safeCount()
      await (payload.db as any).migrate()
      const after = await safeCount() // table exists for sure now
      write({ ok: true, applied: after - before, atHead: after })
    } finally {
      try { await (payload.db as any).drizzle?.session?.client?.close?.() } catch { /* Windows libsql native teardown */ }
      try { await payload.destroy() } catch { /* */ }
    }
  } catch (e) {
    write({ ok: false, error: (e as Error)?.message ?? String(e) })
  }
}

// ── orchestrator helper: spawn a worker, read back its result file ─────────────────────────────
function runLeg(dbPath: string, resultPath: string): { result: WorkerResult; stdout: string; stderr: string } {
  const child = spawnSync('npx', ['tsx', SELF, 'worker', dbPath, resultPath], {
    cwd: ROOT,
    stdio: ['ignore', 'pipe', 'pipe'],
    encoding: 'utf8',
    shell: true, // Windows resolves npx via the shell
    env: { ...process.env, DATABASE_URI: `file:${dbPath}` },
  })
  let result: WorkerResult
  try {
    result = JSON.parse(readFileSync(resultPath, 'utf8')) as WorkerResult
  } catch {
    result = { ok: false, error: 'worker produced no result file (boot crash before result write)' }
  }
  return { result, stdout: child.stdout || '', stderr: child.stderr || '' }
}

// ── orchestrator mode ─────────────────────────────────────────────────────────────────────────
async function runOrchestrator(): Promise<void> {
  const { migrations } = await import('../src/migrations')
  const HEAD = migrations.length
  const tmpRoot = mkdtempSync(join(tmpdir(), `rehearse-migrations-${process.pid}-`))
  const EMPTY_DB = join(tmpRoot, 'empty.db')
  const COPY_DB = join(tmpRoot, 'copy.db')
  const EMPTY_RESULT = join(tmpRoot, 'empty.result.json')
  const COPY_RESULT = join(tmpRoot, 'copy.result.json')
  const results: LegResult[] = []
  const logs: string[] = []

  // --- Leg 1: EMPTY-DB ---
  {
    const { result, stdout, stderr } = runLeg(EMPTY_DB, EMPTY_RESULT)
    if (result.ok && result.atHead === HEAD) {
      results.push({
        name: 'EMPTY-DB (fresh temp file, all migrations)',
        status: 'PASS',
        detail: `applied all ${result.applied}/${HEAD} migrations cleanly`,
      })
    } else {
      results.push({
        name: 'EMPTY-DB (fresh temp file, all migrations)',
        status: 'FAIL',
        detail: result.ok
          ? `applied ${result.applied}, at head ${result.atHead}, expected ${HEAD}`
          : `error: ${result.error}`,
      })
      logs.push(`--- EMPTY-DB worker stdout ---\n${stdout}`, `--- EMPTY-DB worker stderr ---\n${stderr}`)
    }
  }

  // --- Leg 2: COPIED-REAL-DB ---
  if (!existsSync(DEV_DB)) {
    results.push({
      name: 'COPIED-REAL-DB (temp copy of cms.db)',
      status: 'SKIP',
      detail: `dev DB not found at ${DEV_DB} — nothing to copy`,
    })
  } else {
    try {
      cpSync(DEV_DB, COPY_DB)
      // Copy WAL/SHM sidecars if present so the snapshot is consistent (quiescent dev DB usually has none).
      for (const ext of ['-wal', '-shm']) {
        if (existsSync(DEV_DB + ext)) cpSync(DEV_DB + ext, COPY_DB + ext)
      }
      const { result, stdout, stderr } = runLeg(COPY_DB, COPY_RESULT)
      if (result.ok && result.atHead === HEAD) {
        const idempotent = result.applied === 0
        results.push({
          name: 'COPIED-REAL-DB (temp copy of cms.db)',
          status: 'PASS',
          detail: idempotent
            ? `copy booted, at head ${result.atHead}/${HEAD}, re-running migrate was a no-op (0 pending) — idempotent`
            : `copy booted, dev DB was behind head — ${result.applied} pending applied, now at head ${result.atHead}/${HEAD}`,
        })
      } else {
        results.push({
          name: 'COPIED-REAL-DB (temp copy of cms.db)',
          status: 'FAIL',
          detail: result.ok
            ? `at head ${result.atHead}, expected ${HEAD}`
            : `error: ${result.error}`,
        })
        logs.push(`--- COPIED-REAL-DB worker stdout ---\n${stdout}`, `--- COPIED-REAL-DB worker stderr ---\n${stderr}`)
      }
    } catch (e) {
      results.push({
        name: 'COPIED-REAL-DB (temp copy of cms.db)',
        status: 'FAIL',
        detail: `orchestrator error: ${(e as Error)?.message ?? String(e)}`,
      })
    }
  }

  // Best-effort cleanup of temp files (leg failures may leave them; that's fine).
  try { rmSync(tmpRoot, { recursive: true, force: true }) } catch { /* */ }

  // Report.
  console.log('\n=== MIGRATION REHEARSAL REPORT ===')
  for (const r of results) console.log(`[${r.status}] ${r.name}: ${r.detail}`)
  const failed = results.filter((r) => r.status === 'FAIL')
  if (failed.length) {
    console.error(`\n${failed.length} leg(s) FAILED`)
    if (logs.length) console.error('\n' + logs.join('\n\n'))
    process.exitCode = 1
  } else {
    console.log('\nALL LEGS PASSED (or cleanly skipped)')
  }
}

const mode = process.argv[2]
if (mode === 'worker') {
  await runWorker()
} else {
  await runOrchestrator()
}
