export const onRequestGet = async ({ request, env }: { request: Request; env: Record<string, string> }) => {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");

  if (!code) {
    return new Response("Missing OAuth code.", { status: 400 });
  }

  const clientId = env.GITHUB_CLIENT_ID as string | undefined;
  const clientSecret = env.GITHUB_CLIENT_SECRET as string | undefined;

  if (!clientId || !clientSecret) {
    return new Response("OAuth environment variables are not configured.", { status: 500 });
  }

  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    code,
  });

  const tokenResponse = await fetch("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: {
      Accept: "application/json",
    },
    body,
  });

  if (!tokenResponse.ok) {
    return new Response("OAuth token exchange failed.", { status: 401 });
  }

  const payload = (await tokenResponse.json()) as { access_token?: string; error?: string };

  if (!payload.access_token) {
    return new Response(payload.error ?? "Invalid OAuth response.", { status: 401 });
  }

  const message = {
    token: payload.access_token,
    provider: "github",
  };

  const html = `<!doctype html>
<html>
  <head><meta charset="utf-8" /></head>
  <body>
    <script>
      (function () {
        const data = ${JSON.stringify(message)};
        window.opener.postMessage('authorization:github:' + JSON.stringify(data), '*');
        window.close();
      })();
    </script>
  </body>
</html>`;

  return new Response(html, {
    status: 200,
    headers: { "content-type": "text/html" },
  });
};
