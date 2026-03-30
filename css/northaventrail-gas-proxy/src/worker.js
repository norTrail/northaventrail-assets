const ALLOWED_ORIGINS = ['https://northaventrail.org', 'https://www.northaventrail.org'];

export default {
  async fetch(request, env) {
    // CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        headers: corsHeaders(request.headers.get('Origin')),
      });
    }

    if (request.method !== 'POST') {
      return new Response('Method not allowed', { status: 405 });
    }

    // 1. Origin check
    const origin = request.headers.get('Origin') || '';
    if (!ALLOWED_ORIGINS.includes(origin)) {
      return new Response('Forbidden', { status: 403 });
    }

    let body;
    try {
      body = await request.json();
    } catch {
      return new Response('Bad request', { status: 400 });
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
      if (!token) return new Response('Missing challenge token', { status: 403 });

      const tsResult = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ secret: env.TURNSTILE_SECRET, response: token }),
      });
      const tsData = await tsResult.json();
      if (!tsData.success) return new Response('Challenge failed', { status: 403 });
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

function corsHeaders(origin) {
  return {
    'Access-Control-Allow-Origin': ALLOWED_ORIGINS.includes(origin) ? origin : '',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
}