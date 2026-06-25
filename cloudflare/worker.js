/**
 * Cloudflare Worker — Mundial2026 Bot
 *
 * Rutas:
 *   POST /          → proxy para Telegram webhook → GAS doPost
 *   GET  /api?tab=X → proxy para dashboard web   → GAS doGet (resuelve CORS)
 *   ANY  /api/v1/*  → proxy para API estable del proyecto → GAS + Supabase
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
      return corsResponse(request, '', 204);
    }

    // ── /api/v1/*  →  API estable del proyecto ─────────────────────────────
    if (url.pathname === '/api/v1' || url.pathname.startsWith('/api/v1/')) {
      return handleProjectApi(request, url, env);
    }

    // ── GET /api  →  proxy dashboard al Web App de GAS ──────────────────────
    if (method === 'GET' && url.pathname === '/api') {
      return handleApi(request, url, env);
    }

    // ── POST /  →  proxy Telegram webhook al Web App de GAS ─────────────────
    if (method === 'POST') {
      return handleTelegram(request, env);
    }

    return corsResponse(request, 'ok', 200);
  }
};

// ─── Project API v1 ──────────────────────────────────────────────────────────

async function handleProjectApi(request, url, env) {
  const gasUrl = env.GAS_WEBAPP_URL || env.GAS_URL;
  if (!gasUrl) return corsResponse(request, JSON.stringify({ ok: false, error: 'GAS_WEBAPP_URL no configurado' }), 500);

  const auth = request.headers.get('Authorization') || '';
  const bearer = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  const key = url.searchParams.get('key') || bearer;
  if (env.WEB_KEY && key !== env.WEB_KEY) {
    return corsResponse(request, JSON.stringify({ ok: false, error: 'Unauthorized' }), 401);
  }

  const apiPath = url.pathname.replace(/^\/api\/v1\/?/, '') || 'health';
  const method = request.method.toUpperCase();
  const forwardParams = new URLSearchParams();
  forwardParams.set('api', 'v1');
  forwardParams.set('api_path', apiPath);
  forwardParams.set('api_method', method);
  forwardParams.set('key', key);
  for (const [k, v] of url.searchParams.entries()) {
    if (k !== 'key') forwardParams.set(k, v);
  }

  try {
    if (method === 'GET') {
      const resp = await fetch(`${gasUrl}?${forwardParams.toString()}`, { redirect: 'follow' });
      const text = await resp.text();
      return corsResponse(request, text, resp.status, responseContentType(resp));
    }

    const bodyText = await request.text();
    const envelope = {
      api: 'v1',
      api_path: apiPath,
      api_method: method,
      query: Object.fromEntries(url.searchParams.entries()),
      body: bodyText ? safeJsonParse(bodyText) : {}
    };
    const resp = await fetch(`${gasUrl}?${forwardParams.toString()}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(envelope),
      redirect: 'follow'
    });
    const text = await resp.text();
    return corsResponse(request, text, resp.status, responseContentType(resp));
  } catch (err) {
    return corsResponse(request, JSON.stringify({ ok: false, error: err.message }), 502);
  }
}

function safeJsonParse(text) {
  try { return JSON.parse(text); } catch (_) { return { raw: text }; }
}

// ─── Dashboard API ────────────────────────────────────────────────────────────

async function handleApi(request, url, env) {
  const gasUrl = env.GAS_WEBAPP_URL || env.GAS_URL;
  if (!gasUrl) return corsResponse(request, JSON.stringify({ ok: false, error: 'GAS_WEBAPP_URL no configurado' }), 500);

  // Verificar clave del dashboard
  const key = url.searchParams.get('key') || '';
  if (env.WEB_KEY && key !== env.WEB_KEY) {
    return corsResponse(request, JSON.stringify({ ok: false, error: 'Unauthorized' }), 401);
  }

  // Reenviar al GAS Web App con TODOS los parámetros (tab, key, equipo, match_key, etc.)
  const forwardParams = new URLSearchParams();
  for (const [k, v] of url.searchParams.entries()) {
    if (k !== 'key') forwardParams.set(k, v); // key ya fue validada, la reenviamos igual para GAS
  }
  forwardParams.set('key', key);
  const tab      = url.searchParams.get('tab') || 'dashboard';
  const targetUrl = `${gasUrl}?${forwardParams.toString()}`;

  try {
    // fetch con redirect:follow resuelve el 302 de GAS server-side (sin CORS)
    const resp = await fetch(targetUrl, { redirect: 'follow' });
    const text = await resp.text();
    return corsResponse(request, text, resp.status, responseContentType(resp));
  } catch (err) {
    return corsResponse(request, JSON.stringify({ ok: false, error: err.message }), 502);
  }
}

// ─── Telegram webhook proxy ───────────────────────────────────────────────────

async function handleTelegram(request, env) {
  const gasUrl = env.GAS_URL;
  if (!gasUrl) return corsResponse(request, 'GAS_URL no configurado', 500, 'text/plain; charset=utf-8');

  try {
    const body = await request.text();
    await fetch(gasUrl, {
      method:   'POST',
      headers:  { 'Content-Type': 'application/json' },
      body,
      redirect: 'follow'
    });
    // Telegram necesita 200 rápido
    return corsResponse(request, 'ok', 200, 'text/plain; charset=utf-8');
  } catch (err) {
    console.error('Telegram proxy error:', err.message);
    return corsResponse(request, 'ok', 200, 'text/plain; charset=utf-8'); // Siempre 200 a Telegram
  }
}

// ─── Helper CORS ──────────────────────────────────────────────────────────────

function corsResponse(request, body, status = 200, contentType = 'application/json; charset=utf-8') {
  const origin = request.headers.get('Origin') || '*';
  const requestedHeaders = request.headers.get('Access-Control-Request-Headers');
  return new Response(body, {
    status,
    headers: {
      'Content-Type': contentType || 'application/json; charset=utf-8',
      'Access-Control-Allow-Origin': origin,
      'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': requestedHeaders || 'Authorization, Content-Type, X-Requested-With',
      'Access-Control-Max-Age': '86400',
      'Vary': 'Origin, Access-Control-Request-Method, Access-Control-Request-Headers',
    }
  });
}

function responseContentType(resp) {
  const type = resp.headers.get('Content-Type') || '';
  if (type) return type;
  return 'application/json; charset=utf-8';
}
