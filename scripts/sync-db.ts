import Database from 'better-sqlite3';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync, mkdirSync, readFileSync, unlinkSync } from 'node:fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DB_PATH = join(__dirname, '../data/hospital.db');
const SCHEMA_PATH = join(__dirname, '../worker/src/db/schema.sql');
const WORKER_URL = process.env.WORKER_URL || 'http://localhost:8787';
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || 'change-me-in-production';

const command = process.argv[2];

async function pull() {
  console.log(`Pulling from ${WORKER_URL}/api/sync/export ...`);
  const res = await fetch(`${WORKER_URL}/api/sync/export`, {
    headers: { Authorization: `Bearer ${ADMIN_TOKEN}` },
  });
  if (!res.ok) throw new Error(`Export failed: ${res.status} ${await res.text()}`);
  const { data } = await res.json() as { data: Record<string, unknown[]> };

  const dataDir = dirname(DB_PATH);
  if (!existsSync(dataDir)) mkdirSync(dataDir, { recursive: true });

  const schema = readFileSync(SCHEMA_PATH, 'utf-8');
  const schemaWithoutFts = schema.split('\n').filter(line => !line.includes('fts5') && !line.includes('_fts')).join('\n');

  if (existsSync(DB_PATH)) unlinkSync(DB_PATH);

  const db = new Database(DB_PATH);
  db.exec(schemaWithoutFts);

  for (const [table, rows] of Object.entries(data)) {
    if (!rows.length) continue;
    const cols = Object.keys(rows[0] as Record<string, unknown>);
    const placeholders = cols.map(() => '?').join(', ');
    const stmt = db.prepare(`INSERT INTO ${table} (${cols.join(', ')}) VALUES (${placeholders})`);
    const insertMany = db.transaction((items: Record<string, unknown>[]) => {
      for (const item of items) stmt.run(...cols.map(c => item[c]));
    });
    insertMany(rows as Record<string, unknown>[]);
  }

  db.close();
  console.log(`Database saved to ${DB_PATH}`);
  console.log('Tables:', Object.entries(data).map(([t, r]) => `${t}(${(r as unknown[]).length})`).join(', '));
}

async function push() {
  if (!existsSync(DB_PATH)) throw new Error(`No database at ${DB_PATH}. Run 'pull' first.`);
  const db = new Database(DB_PATH, { readonly: true });
  const tables = ['articles', 'doctors', 'departments', 'achievements', 'awards', 'news'];
  const data: Record<string, unknown[]> = {};
  for (const table of tables) data[table] = db.prepare(`SELECT * FROM ${table}`).all();
  db.close();

  console.log(`Pushing to ${WORKER_URL}/api/sync/import ...`);
  const res = await fetch(`${WORKER_URL}/api/sync/import`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${ADMIN_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ data }),
  });
  if (!res.ok) throw new Error(`Import failed: ${res.status} ${await res.text()}`);
  console.log('Push complete:', await res.json());
}

if (command === 'pull') { pull().catch(console.error); }
else if (command === 'push') { push().catch(console.error); }
else { console.log('Usage: tsx scripts/sync-db.ts [pull|push]'); }
