/**
 * PoolTeamCore.gs
 *
 * Helpers puros para fechas UTC, hashing, slugs, HTTP y logging.
 */

function ptNowIso_() {
  return new Date().toISOString();
}

function ptToUtcIso_(value) {
  if (value === null || value === undefined || value === '') return null;
  if (value instanceof Date && !isNaN(value.getTime())) return value.toISOString();
  const d = new Date(value);
  return isNaN(d.getTime()) ? null : d.toISOString();
}

function ptDateToYmd_(value) {
  const iso = ptToUtcIso_(value);
  if (!iso) return '';
  return iso.substring(0, 10);
}

function ptYmdToEspnDate_(ymd) {
  return String(ymd || '').substring(0, 10).replace(/-/g, '');
}

function ptAddDays_(ymd, days) {
  const d = new Date(String(ymd || '').substring(0, 10) + 'T00:00:00.000Z');
  d.setUTCDate(d.getUTCDate() + Number(days || 0));
  return Utilities.formatDate(d, 'UTC', 'yyyy-MM-dd');
}

function ptDateRange_(fromYmd, toYmd) {
  const out = [];
  let cursor = String(fromYmd || '').substring(0, 10);
  const end = String(toYmd || '').substring(0, 10);
  while (cursor && cursor <= end) {
    out.push(cursor);
    cursor = ptAddDays_(cursor, 1);
  }
  return out;
}

function ptNormalizeName_(value) {
  return String(value || '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/&/g, ' and ')
    .replace(/[^a-zA-Z0-9]+/g, ' ')
    .trim().toLowerCase().replace(/\s+/g, ' ');
}

function ptSlug_(value) {
  return ptNormalizeName_(value).replace(/\s+/g, '-');
}

function ptHash_(value) {
  const text = typeof value === 'string' ? value : JSON.stringify(value || {}, Object.keys(value || {}).sort());
  const bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, text, Utilities.Charset.UTF_8);
  return bytes.map(function(b) {
    const v = (b < 0 ? b + 256 : b).toString(16);
    return v.length === 1 ? '0' + v : v;
  }).join('');
}

function ptJson_(value) {
  return JSON.stringify(value === undefined ? null : value);
}

function ptLog_(message, payload) {
  const line = payload === undefined ? String(message) : String(message) + ' ' + ptJson_(payload);
  Logger.log(line);
}

function ptHttpGetJson_(url, headers, options) {
  options = options || {};
  const started = new Date().getTime();
  const retries = Number(options.retries === undefined ? 2 : options.retries);
  let last = null;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const response = UrlFetchApp.fetch(url, {
        method: 'get',
        headers: Object.assign({ 'User-Agent': 'PoolTeam2026/1.0 GoogleAppsScript' }, headers || {}),
        muteHttpExceptions: true
      });
      const code = response.getResponseCode();
      const text = response.getContentText() || '';
      last = {
        ok: code >= 200 && code < 300,
        status: code,
        url: url,
        latency_ms: new Date().getTime() - started,
        text: text,
        json: text ? JSON.parse(text) : null
      };
      if (last.ok) return last;
      if ([429, 500, 502, 503, 504].indexOf(code) === -1 || attempt === retries) return last;
    } catch (e) {
      last = { ok: false, status: 0, url: url, latency_ms: new Date().getTime() - started, error: e.message, text: '' };
      if (attempt === retries) return last;
    }
    Utilities.sleep(Math.min(5000, 500 * Math.pow(2, attempt)));
  }
  return last;
}

