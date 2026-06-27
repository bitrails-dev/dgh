export interface Env {
  DB: D1Database;
  ADMIN_TOKEN: string;
  GITHUB_REPO: string;
  GITHUB_TOKEN: string;
}

export function authenticate(request: Request, env: Env): Response | null {
  const authHeader = request.headers.get('Authorization');
  if (!authHeader || authHeader !== `Bearer ${env.ADMIN_TOKEN}`) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  return null;
}
