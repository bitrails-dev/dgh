import type { Env } from '../middleware/auth';

const TABLE = 'doctors';
const FTS = 'doctors_fts';
const FIELDS = ['name', 'name_ar', 'specialty', 'specialty_ar', 'photo', 'bio', 'bio_ar', 'certified', 'featured', 'role', 'role_ar', 'sort_order'] as const;

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
}

export async function listDoctors(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const q = url.searchParams.get('q');
  const limit = parseInt(url.searchParams.get('limit') || '50', 10);
  const offset = parseInt(url.searchParams.get('offset') || '0', 10);

  if (q) {
    const { results } = await env.DB.prepare(
      `SELECT d.* FROM ${TABLE} d JOIN ${FTS} f ON d.rowid = f.rowid WHERE ${FTS} MATCH ? ORDER BY rank LIMIT ? OFFSET ?`
    ).bind(q, limit, offset).all();
    return json({ data: results });
  }

  const { results } = await env.DB.prepare(
    `SELECT * FROM ${TABLE} ORDER BY sort_order ASC, name ASC LIMIT ? OFFSET ?`
  ).bind(limit, offset).all();
  return json({ data: results });
}

export async function getDoctor(_req: Request, env: Env, params: Record<string, string>): Promise<Response> {
  const record = await env.DB.prepare(`SELECT * FROM ${TABLE} WHERE id = ?`).bind(params.id).first();
  if (!record) return json({ error: 'Not found' }, 404);
  return json(record);
}

export async function createDoctor(request: Request, env: Env): Promise<Response> {
  const body = await request.json() as Record<string, unknown>;
  const cols: string[] = [];
  const vals: unknown[] = [];

  for (const f of FIELDS) {
    if (body[f] !== undefined) { cols.push(f); vals.push(body[f]); }
  }

  const placeholders = cols.map(() => '?').join(', ');
  const { meta } = await env.DB.prepare(
    `INSERT INTO ${TABLE} (${cols.join(', ')}) VALUES (${placeholders})`
  ).bind(...vals).run();

  const insertedId = (body.id as string) || String(meta.last_row_id);
  await env.DB.prepare(
    `INSERT INTO ${FTS}(rowid, id, name, name_ar, specialty, specialty_ar, bio, bio_ar)
     SELECT rowid, id, name, name_ar, specialty, specialty_ar, bio, bio_ar FROM ${TABLE} WHERE id = ?`
  ).bind(insertedId).run();

  return json({ id: insertedId }, 201);
}

export async function updateDoctor(request: Request, env: Env, params: Record<string, string>): Promise<Response> {
  const body = await request.json() as Record<string, unknown>;
  const sets: string[] = [];
  const vals: unknown[] = [];

  for (const f of FIELDS) {
    if (body[f] !== undefined) { sets.push(`${f} = ?`); vals.push(body[f]); }
  }

  if (sets.length === 0) return json({ error: 'No fields to update' }, 400);

  vals.push(params.id);
  await env.DB.prepare(`UPDATE ${TABLE} SET ${sets.join(', ')} WHERE id = ?`).bind(...vals).run();

  await env.DB.prepare(`DELETE FROM ${FTS} WHERE rowid = (SELECT rowid FROM ${TABLE} WHERE id = ?)`).bind(params.id).run();
  await env.DB.prepare(
    `INSERT INTO ${FTS}(rowid, id, name, name_ar, specialty, specialty_ar, bio, bio_ar)
     SELECT rowid, id, name, name_ar, specialty, specialty_ar, bio, bio_ar FROM ${TABLE} WHERE id = ?`
  ).bind(params.id).run();

  return json({ ok: true });
}

export async function deleteDoctor(_req: Request, env: Env, params: Record<string, string>): Promise<Response> {
  await env.DB.prepare(`DELETE FROM ${FTS} WHERE rowid = (SELECT rowid FROM ${TABLE} WHERE id = ?)`).bind(params.id).run();
  await env.DB.prepare(`DELETE FROM ${TABLE} WHERE id = ?`).bind(params.id).run();
  return json({ ok: true });
}
