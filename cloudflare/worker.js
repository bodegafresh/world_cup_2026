/**
 * Cloudflare Worker — Mundial2026 Bot
 *
 * Rutas:
 *   POST /          → proxy para Telegram webhook → GAS doPost
 *   GET  /api?tab=X → proxy para dashboard web   → GAS doGet (resuelve CORS)
 *   GET  /*         → 204 No Content
 *
 * Variables de entorno (Cloudflare Dashboard → Settings → Variables):
 *   GAS_URL      — URL del Web App de Apps Script (.../exec)
 *   WEB_KEY      — Clave secreta para el dashboard web (misma que en Script Properties)
 */

export default {
  async fetch(request, env) {
    const url    = new URL(request.url);
    const method = request.method.toUpperCase();

    // ── CORS preflight ───────────────────────────────────────────────────────
    if (method === 'OPTIONS') {
      return corsResponse('', 204);
    }

    // ── GET /api  →  proxy dashboard al Web App de GAS ──────────────────────
    if (method === 'GET' && url.pathname === '/api') {
      return handleApi(request, url, env);
    }

    // ── POST /  →  proxy Telegram webhook al Web App de GAS ─────────────────
    if (method === 'POST') {
      return handleTelegram(request, env);
    }

    return corsResponse('ok', 200);
  }
};

// ─── Dashboard API ────────────────────────────────────────────────────────────

async function handleApi(request, url, env) {
  const gasUrl = env.GAS_URL;
  if (!gasUrl) return corsResponse(JSON.stringify({ ok: false, error: 'GAS_URL no configurado' }), 500);

  // Verificar clave del dashboard
  const key = url.searchParams.get('key') || '';
  if (env.WEB_KEY && key !== env.WEB_KEY) {
    return corsResponse(JSON.stringify({ ok: false, error: 'Unauthorized' }), 401);
  }

  // Reenviar al GAS Web App con todos los parámetros
  const tab      = url.searchParams.get('tab') || 'dashboard';
  const targetUrl = `${gasUrl}?tab=${encodeURIComponent(tab)}`;

  try {
    // fetch con redirect:follow resuelve el 302 de GAS server-side (sin CORS)
    const resp = await fetch(targetUrl, { redirect: 'follow' });
    const text = await resp.text();
    return corsResponse(text, resp.status, 'application/json');
  } catch (err) {
    return corsResponse(JSON.stringify({ ok: false, error: err.message }), 502);
  }
}

// ─── Telegram webhook proxy ───────────────────────────────────────────────────

async function handleTelegram(request, env) {
  const gasUrl = env.GAS_URL;
  if (!gasUrl) return new Response('GAS_URL no configurado', { status: 500 });

  try {
    const body = await request.text();
    await fetch(gasUrl, {
      method:   'POST',
      headers:  { 'Content-Type': 'application/json' },
      body,
      redirect: 'follow'
    });
    // Telegram necesita 200 rápido
    return new Response('ok', { status: 200 });
  } catch (err) {
    console.error('Telegram proxy error:', err.message);
    return new Response('ok', { status: 200 }); // Siempre 200 a Telegram
  }
}

// ─── Helper CORS ──────────────────────────────────────────────────────────────

function corsResponse(body, status = 200, contentType = 'application/json') {
  return new Response(body, {
    status,
    headers: {
      'Content-Type':                contentType,
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods':'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers':'Content-Type, Authorization',
    }
  });
}
