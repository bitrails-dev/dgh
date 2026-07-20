// One-off: run pending migrations programmatically. Bypasses the `payload migrate` CLI's dev-mode
// interactive prompt (which segfaults in a non-TTY shell). Equivalent to `npx payload migrate`.
import 'dotenv/config'
import { getPayload } from 'payload'
import config from '../src/payload.config'

const payload = await getPayload({ config })
try {
  // Drop the dev-push marker (batch=-1) so payload.db.migrate() skips its interactive prompt
  // (which segfaults in a non-TTY shell). Equivalent to answering "y" to that prompt.
  await payload.delete({
    collection: 'payload-migrations',
    where: { batch: { equals: -1 } },
    overrideAccess: true,
  })
  await (payload.db as any).migrate()
  console.log('MIGRATE OK')
} catch (e) {
  console.error('MIGRATE ERROR:', e)
  process.exitCode = 1
} finally {
  try { await (payload.db as any).drizzle?.session?.client?.close?.() } catch { /* libsql teardown */ }
  try { await payload.destroy() } catch { /* */ }
}