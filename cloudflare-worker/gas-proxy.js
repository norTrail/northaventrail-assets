/**
 * Cloudflare Worker: GAS Proxy
 * Sits between the northaventrail.org issue-tracker form and Google Apps Script.
 *
 * Checks:
 *   1. Origin header must be northaventrail.org
 *   2. Honeypot field (_hp) must be empty
 *   3. Turnstile token (_turnstile) must be valid — required for saveData submissions
 *   4. Injects GAS_SECRET into the forwarded request body
 *
 * Environment variables (set via wrangler secret / Cloudflare dashboard):
 *   GAS_URL          — full Google Apps Script deployment URL (plain text var)
 *   GAS_SECRET       — shared secret validated by GAS doPost()
 *   TURNSTILE_SECRET — Cloudflare Turnstile secret key
 */

const ALLOWED_ORIGINS = ['https://northaventrail.org', 'https://www.northaventrail.org'];

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin') || '';

    // CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders(origin) });
    }

    if (request.method !== 'POST') {
      return new Response('Method not allowed', { status: 405 });
    }

    // 1. Origin check
    if (!ALLOWED_ORIGINS.includes(origin)) {
      return new Response('Forbidden', { status: 403 });
    }

    let body;
    try {
      body = await request.json();
    } catch {
      return new Response('Bad request', { status: 400 });
    }

    // 2. Honeypot check — bots fill hidden fields, humans don't
    if (body._hp && body._hp !== '') {
      // Silently succeed so bots don't know they were caught
      return new Response(JSON.stringify({ result: 'success' }), {
        headers: { 'Content-Type': 'application/json', ...corsHeaders(origin) },
      });
    }

    // 3. Turnstile validation — required for form submissions (saveData)
    const page = body.page || body.p || '';
    if (page === 'saveData') {
      const token = body._turnstile;
      if (!token) {
        return new Response('Missing challenge token', { status: 403 });
      }
      const tsResult = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ secret: env.TURNSTILE_SECRET, response: token }),
      });
      const tsData = await tsResult.json();
      if (!tsData.success) {
        return new Response('Challenge failed', { status: 403 });
      }
    }

    // 4. Strip internal fields, inject GAS shared secret
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
