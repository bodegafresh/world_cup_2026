/**
 * WebApp.gs
 *
 * Entrypoint HTTP del Web App de Apps Script para el proyecto limpio.
 * El navegador nunca deberia llamar GAS directo: Cloudflare Worker resuelve CORS,
 * valida WEB_KEY y reenvia aqui con api=v1.
 */

function doGet(e) {
  e = e || { parameter: {} };
  const params = e.parameter || {};
  if (String(params.api || '').toLowerCase() === 'v1') {
    return routeApiV1Get_(e);
  }
  return webAppJson_({
    ok: true,
    service: 'match_alpha_gas',
    message: 'Use Cloudflare Worker /api/v1/* for public API access.'
  });
}

function doPost(e) {
  e = e || { parameter: {}, postData: null };
  const params = e.parameter || {};
  const envelope = webAppParseJson_(e.postData && e.postData.contents);
  if (String(params.api || envelope.api || '').toLowerCase() === 'v1') {
    return routeApiV1Post_(e, envelope);
  }
  return webAppJson_({
    ok: false,
    error: 'Unsupported POST route. Use api=v1 via Cloudflare Worker.'
  });
}

function webAppParseJson_(text) {
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch (e) {
    return { raw: text };
  }
}

function webAppJson_(payload) {
  return ContentService
    .createTextOutput(JSON.stringify(payload || {}))
    .setMimeType(ContentService.MimeType.JSON);
}
