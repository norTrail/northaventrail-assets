const ALLOWED_ORIGINS = [
  'https://northaventrail.org',
  'https://www.northaventrail.org',
  'https://dorothy-buechel.squarespace.com',
];

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin') || '';

    // CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        headers: corsHeaders(origin),
      });
    }

    if (request.method !== 'POST') {
      return jsonError('Method not allowed', 405, origin);
    }

    // 1. Origin check
    if (!ALLOWED_ORIGINS.includes(origin)) {
      return jsonError('Forbidden', 403, origin);
    }

    let body;
    try {
      body = await request.json();
    } catch {
      return jsonError('Bad request', 400, origin);
    }

    // 2. Honeypot check (field must be empty)
    if (body._hp && body._hp !== '') {
      // Silently accept (don't reveal to bots that they were caught)
      return new Response(JSON.stringify({ result: 'success' }), {
        headers: { 'Content-Type': 'application/json', ...corsHeaders(origin) },
      });
    }

    // 3. Turnstile validation (only for form submissions, not image ops)
    const page = body.page || body.p || '';
    const requiresTurnstile = (page === 'saveData');
    if (requiresTurnstile) {
      const token = body._turnstile;
      if (!token) return jsonError('Missing challenge token', 403, origin);

      const tsResult = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ secret: env.TURNSTILE_SECRET, response: token }),
      });
      const tsData = await tsResult.json();
      if (!tsData.success) return jsonError('Challenge failed', 403, origin);
    }

    // 4. Strip internal fields, inject GAS secret
    const { _turnstile, _hp, ...gasBody } = body;
    gasBody._secret = env.GAS_SECRET;

    // 5. Forward to GAS
    const gasResponse = await fetch(env.GAS_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(gasBody),
      redirect: 'follow',
    });

    const responseText = await gasResponse.text();
    return new Response(responseText, {
      status: 200,
      headers: { 'Content-Type': 'application/json', ...corsHeaders(origin) },
    });
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