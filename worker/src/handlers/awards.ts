import type { Env } from '../middleware/auth';

const TABLE = 'awards';
const FIELDS = ['name', 'name_ar', 'body', 'body_ar', 'year', 'badge_image'] as const;

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
}

export async function listAwards(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const limit = parseInt(url.searchParams.get('limit') || '50', 10);
  const offset = parseInt(url.searchParams.get('offset') || '0', 10);

  const { results } = await env.DB.prepare(
    `SELECT * FROM ${TABLE} ORDER BY year DESC LIMIT ? OFFSET ?`
  ).bind(limit, offset).all();
  return json({ data: results });
}

export async function getAward(_req: Request, env: Env, params: Record<string, string>): Promise<Response> {
  const record = await env.DB.prepare(`SELECT * FROM ${TABLE} WHERE id = ?`).bind(params.id).first();
  if (!record) return json({ error: 'Not found' }, 404);
  return json(record);
}

export async function createAward(request: Request, env: Env): Promise<Response> {
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

  return json({ id: meta.last_row_id }, 201);
}

export async function updateAward(request: Request, env: Env, params: Record<string, string>): Promise<Response> {
  const body = await request.json() as Record<string, unknown>;
  const sets: string[] = [];
  const vals: unknown[] = [];

  for (const f of FIELDS) {
    if (body[f] !== undefined) {
      sets.push(`${f} = ?`);
      vals.push(body[f]);
    }
  }

  if (sets.length === 0) return json({ error: 'No fields to update' }, 400);

  vals.push(params.id);
  await env.DB.prepare(`UPDATE ${TABLE} SET ${sets.join(', ')} WHERE id = ?`).bind(...vals).run();
  return json({ ok: true });
}

export async function deleteAward(_req: Request, env: Env, params: Record<string, string>): Promise<Response> {
  await env.DB.prepare(`DELETE FROM ${TABLE} WHERE id = ?`).bind(params.id).run();
  return json({ ok: true });
}
