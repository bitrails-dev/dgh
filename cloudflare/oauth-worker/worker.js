/**
 * Decap CMS — GitHub OAuth proxy
 *
 * Deploy to Cloudflare Workers, then set two secrets via wrangler:
 *   wrangler secret put GITHUB_CLIENT_ID
 *   wrangler secret put GITHUB_CLIENT_SECRET
 *
 * Update public/admin/config.yml:
 *   backend:
 *     name: github
 *     repo: motifyee/dumyat-public-hospital
 *     branch: main
 *     base_url: https://decap-oauth.YOUR_SUBDOMAIN.workers.dev
 *     auth_endpoint: /auth
 */

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // CORS pre-flight
    if (request.method === 'OPTIONS') {
      return corsResponse('', 204);
    }

    if (url.pathname === '/auth') {
      return handleAuth(url, env);
    }

    if (url.pathname === '/callback') {
      return handleCallback(url, env);
    }

    return new Response('Not found', { status: 404 });
  },
};

// ─── Step 1: redirect to GitHub ──────────────────────────────────────────────

function handleAuth(url, env) {
  const state = crypto.randomUUID();
  const params = new URLSearchParams({
    client_id: env.GITHUB_CLIENT_ID,
    scope: 'repo,user',
    redirect_uri: `${url.origin}/callback`,
    state,
  });
  return Response.redirect(
    `https://github.com/login/oauth/authorize?${params}`,
    302,
  );
}

// ─── Step 2: exchange code, return token to Decap via postMessage ─────────────

async function handleCallback(url, env) {
  const code  = url.searchParams.get('code');
  const error = url.searchParams.get('error');

  if (error || !code) {
    return postMessagePage('error', { message: error ?? 'Missing code' });
  }

  const tokenRes = await fetch('https://github.com/login/oauth/access_token', {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id:     env.GITHUB_CLIENT_ID,
      client_secret: env.GITHUB_CLIENT_SECRET,
      code,
    }),
  });

  const data = await tokenRes.json();

  if (data.error || !data.access_token) {
    return postMessagePage('error', { message: data.error_description ?? data.error ?? 'Token exchange failed' });
  }

  return postMessagePage('success', { token: data.access_token, provider: 'github' });
}

// ─── Helper: emit an HTML page that sends a postMessage to the Decap opener ──

function postMessagePage(status, payload) {
  // Decap CMS listens for this exact message format.
  const message = `authorization:github:${status}:${JSON.stringify(payload)}`;

  const html = `<!DOCTYPE html><html><body><script>
    (function () {
      function send(e) {
        window.opener.postMessage(${JSON.stringify(message)}, e.origin);
      }
      window.addEventListener('message', send, false);
      window.opener.postMessage('authorizing:github', '*');
    })();
  </script></body></html>`;

  return new Response(html, {
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  });
}

function corsResponse(body, status = 200) {
  return new Response(body, {
    status,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
    },
  });
}
