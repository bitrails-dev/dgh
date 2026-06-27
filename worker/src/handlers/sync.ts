import type { Env } from '../middleware/auth';

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
}

export async function exportDatabase(_req: Request, env: Env): Promise<Response> {
  const [articles, doctors, departments, achievements, awards, news] = await Promise.all([
    env.DB.prepare('SELECT * FROM articles').all(),
    env.DB.prepare('SELECT * FROM doctors').all(),
    env.DB.prepare('SELECT * FROM departments').all(),
    env.DB.prepare('SELECT * FROM achievements').all(),
    env.DB.prepare('SELECT * FROM awards').all(),
    env.DB.prepare('SELECT * FROM news').all(),
  ]);

  return json({
    data: {
      articles: articles.results,
      doctors: doctors.results,
      departments: departments.results,
      achievements: achievements.results,
      awards: awards.results,
      news: news.results,
    },
    exported_at: new Date().toISOString(),
  });
}

interface TableDump {
  articles?: Record<string, unknown>[];
  doctors?: Record<string, unknown>[];
  departments?: Record<string, unknown>[];
  achievements?: Record<string, unknown>[];
  awards?: Record<string, unknown>[];
  news?: Record<string, unknown>[];
}

export async function importDatabase(request: Request, env: Env): Promise<Response> {
  const { data } = await request.json() as { data: TableDump };

  // Clear FTS indexes first, then data tables
  await env.DB.batch([
    env.DB.prepare('DELETE FROM articles_fts'),
    env.DB.prepare('DELETE FROM doctors_fts'),
    env.DB.prepare('DELETE FROM news_fts'),
    env.DB.prepare('DELETE FROM articles'),
    env.DB.prepare('DELETE FROM doctors'),
    env.DB.prepare('DELETE FROM departments'),
    env.DB.prepare('DELETE FROM achievements'),
    env.DB.prepare('DELETE FROM awards'),
    env.DB.prepare('DELETE FROM news'),
  ]);

  // Re-insert all rows
  const inserts: D1PreparedStatement[] = [];

  const tableFields: Record<string, string[]> = {
    articles: ['id', 'title', 'title_ar', 'date', 'category', 'thumbnail', 'excerpt', 'excerpt_ar', 'featured', 'author', 'lang', 'body', 'body_ar'],
    doctors: ['id', 'name', 'name_ar', 'specialty', 'specialty_ar', 'photo', 'bio', 'bio_ar', 'certified', 'featured', 'role', 'role_ar', 'sort_order'],
    departments: ['id', 'name', 'name_ar', 'description', 'description_ar', 'icon', 'center_of_excellence', 'featured', 'image'],
    achievements: ['id', 'year', 'title', 'title_ar', 'description', 'description_ar', 'icon'],
    awards: ['id', 'name', 'name_ar', 'body', 'body_ar', 'year', 'badge_image'],
    news: ['id', 'title', 'title_ar', 'date', 'category', 'thumbnail', 'excerpt', 'excerpt_ar', 'featured', 'author', 'body', 'body_ar'],
  };

  for (const [table, fields] of Object.entries(tableFields)) {
    const rows = (data as Record<string, Record<string, unknown>[] | undefined>)[table] || [];
    const placeholders = fields.map(() => '?').join(', ');
    for (const row of rows) {
      const vals = fields.map(f => row[f] ?? null);
      inserts.push(env.DB.prepare(`INSERT INTO ${table} (${fields.join(', ')}) VALUES (${placeholders})`).bind(...vals));
    }
  }

  // Execute inserts in batches of 50 (D1 batch limit)
  for (let i = 0; i < inserts.length; i += 50) {
    await env.DB.batch(inserts.slice(i, i + 50));
  }

  // Rebuild FTS indexes with full bilingual columns
  await env.DB.batch([
    env.DB.prepare('INSERT INTO articles_fts(rowid, id, title, title_ar, excerpt, excerpt_ar, body, body_ar) SELECT rowid, id, title, title_ar, excerpt, excerpt_ar, body, body_ar FROM articles'),
    env.DB.prepare('INSERT INTO doctors_fts(rowid, id, name, name_ar, specialty, specialty_ar, bio, bio_ar) SELECT rowid, id, name, name_ar, specialty, specialty_ar, bio, bio_ar FROM doctors'),
    env.DB.prepare('INSERT INTO news_fts(rowid, id, title, title_ar, excerpt, excerpt_ar, body, body_ar) SELECT rowid, id, title, title_ar, excerpt, excerpt_ar, body, body_ar FROM news'),
  ]);

  return json({ ok: true, inserted: inserts.length });
}

export async function publishToGit(_req: Request, env: Env): Promise<Response> {
  if (!env.GITHUB_REPO || !env.GITHUB_TOKEN) {
    return json({ error: 'GitHub configuration missing' }, 500);
  }

  const res = await fetch(`https://api.github.com/repos/${env.GITHUB_REPO}/dispatches`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${env.GITHUB_TOKEN}`,
      'Accept': 'application/vnd.github+json',
      'Content-Type': 'application/json',
      'User-Agent': 'hospital-cms-worker',
    },
    body: JSON.stringify({ event_type: 'sync-database' }),
  });

  if (!res.ok) {
    const text = await res.text();
    return json({ error: 'GitHub dispatch failed', details: text }, 502);
  }

  return json({ ok: true });
}
