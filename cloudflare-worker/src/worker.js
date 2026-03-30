const ALLOWED_ORIGINS = [
  'https://northaventrail.org',
  'https://www.northaventrail.org',
  'https://dorothy-buechel.squarespace.com',
];

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin') || '';

    // 1. CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        headers: corsHeaders(origin),
      });
    }

    try {
      const { pathname } = new URL(request.url);
      let targetUrl;

      if (pathname === '/submit') {
        targetUrl = env.GAS_ISSUE_URL;
      } else if (pathname === '/log') {
        targetUrl = env.GAS_LOG_URL;
      } else {
        return jsonError('Not Found', 404, origin);
      }

      if (request.method !== 'POST') {
        return jsonError('Method not allowed', 405, origin);
      }

      // 2. Origin check
      if (!ALLOWED_ORIGINS.includes(origin)) {
        return jsonError('Forbidden', 403, origin);
      }

      let body;
      try {
        body = await request.json();
      } catch (err) {
        return jsonError('Bad request - invalid JSON', 400, origin);
      }

      // 3. Honeypot check (field must be empty)
      if (body._hp && body._hp !== '') {
        // Silently accept (don't reveal to bots that they were caught)
        return new Response(JSON.stringify({ result: 'success' }), {
          headers: { 'Content-Type': 'application/json', ...corsHeaders(origin) },
        });
      }

      // 4. Turnstile validation (only for /submit form submissions, not image ops)
      //    Optional: validates token if present; allows through if widget failed to render (e.g. ad blockers)
      if (pathname === '/submit') {
        const page = body.page || body.p || '';
        const requiresTurnstile = (page === 'saveData');
        if (requiresTurnstile) {
          const token = body._turnstile;
          if (token) {
            const tsResult = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ secret: env.TURNSTILE_SECRET, response: token }),
            });
            const tsData = await tsResult.json();
            if (!tsData.success) return jsonError('Challenge failed', 403, origin);
          }
          // No token: allow through (widget may have failed to load)
        }
      }

      // 5. Strip internal fields, inject GAS secret
      const { _turnstile, _hp, ...gasBody } = body;
      gasBody._secret = env.GAS_SECRET;

      // 6. Forward to GAS
      const gasResponse = await fetch(targetUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(gasBody),
        redirect: 'follow',
      });

      if (!gasResponse.ok) {
        const errorText = await gasResponse.text();
        console.error(`GAS Error (${gasResponse.status}): ${errorText}`);
        return jsonError(`Backend Error (${gasResponse.status}): ${errorText}`, gasResponse.status, origin);
      }

      const responseText = await gasResponse.text();

      // GAS sometimes returns an empty body on success (after redirect)
      if (!responseText || !responseText.trim()) {
        return new Response(JSON.stringify({ result: 'success' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json', ...corsHeaders(origin) },
        });
      }

      // Guard: ensure GAS returned valid JSON (it sometimes returns HTML on error)
      try {
        JSON.parse(responseText);
      } catch (_) {
        const preview = responseText.slice(0, 200);
        console.error(`GAS non-JSON response: ${preview}`);
        return jsonError(`Backend returned unexpected content: ${preview}`, 502, origin);
      }

      return new Response(responseText, {
        status: 200,
        headers: { 'Content-Type': 'application/json', ...corsHeaders(origin) },
      });
    } catch (err) {
      console.error(`Worker Exception: ${err.message}`);
      return jsonError(`Worker Exception: ${err.message}`, 500, origin);
    }
  },
};

function jsonError(message, status, origin) {
  return new Response(JSON.stringify({ error: message, status: status }), {
    status: status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders(origin) },
  });
}

function corsHeaders(origin) {
  return {
    'Access-Control-Allow-Origin': ALLOWED_ORIGINS.includes(origin) ? origin : '',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
}