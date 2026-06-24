/**
 * SupabaseClient.gs
 *
 * Cliente REST minimalista para Supabase desde Apps Script.
 * Cliente dedicado al proyecto Supabase-first.
 *
 * Script Properties requeridas:
 *   - SUPABASE_URL
 *   - SUPABASE_SERVICE_ROLE_KEY
 */

function isSupabaseConfigured_() {
  const props = PropertiesService.getScriptProperties();
  return Boolean(props.getProperty('SUPABASE_URL') && props.getProperty('SUPABASE_SERVICE_ROLE_KEY'));
}

function getSupabaseUrl_() {
  return ptRequiredEnv_('SUPABASE_URL').replace(/\/+$/, '');
}

function getSupabaseServiceRoleKey_() {
  return ptRequiredEnv_('SUPABASE_SERVICE_ROLE_KEY');
}

function supabaseRestPath_() {
  return '/rest/v1';
}

function supabaseRequest_(method, tableOrPath, payload, options) {
  options = options || {};
  if (!isSupabaseConfigured_()) {
    throw new Error('Supabase no configurado. Faltan SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY.');
  }

  const path = String(tableOrPath || '').charAt(0) === '/' ? tableOrPath : '/' + tableOrPath;
  const qs = options.query ? '?' + options.query : '';
  const url = getSupabaseUrl_() + supabaseRestPath_() + path + qs;
  const key = getSupabaseServiceRoleKey_();
  const headers = {
    apikey: key,
    Authorization: 'Bearer ' + key,
    'Content-Type': 'application/json'
  };
  if (options.prefer) headers.Prefer = options.prefer;

  const params = {
    method: method,
    headers: headers,
    muteHttpExceptions: true
  };
  if (payload !== undefined && payload !== null) params.payload = JSON.stringify(payload);

  const retry = supabaseRetryOptions_(options);
  let lastText = '';
  let lastCode = 0;
  for (let attempt = 0; attempt <= retry.retries; attempt++) {
    try {
      const response = UrlFetchApp.fetch(url, params);
      lastCode = response.getResponseCode();
      lastText = response.getContentText() || '';
      if (lastCode >= 200 && lastCode < 300) {
        if (!lastText) return null;
        try { return JSON.parse(lastText); } catch (e_) { return lastText; }
      }
      if (!supabaseIsRetryableStatus_(lastCode) || attempt === retry.retries) {
        throw new Error('Supabase HTTP ' + lastCode + ' ' + method + ' ' + path + ': ' + lastText.substring(0, 500));
      }
    } catch (e) {
      if (attempt === retry.retries || !supabaseIsRetryableError_(e)) throw e;
    }
    Utilities.sleep(supabaseBackoffMs_(attempt, retry));
  }
  return null;
}

function supabaseRetryOptions_(options) {
  return {
    retries: Math.max(0, Math.min(5, Number(options.retries === undefined ? 2 : options.retries))),
    base_ms: Math.max(100, Math.min(5000, Number(options.base_ms || 400))),
    max_ms: Math.max(250, Math.min(15000, Number(options.max_ms || 5000)))
  };
}

function supabaseBackoffMs_(attempt, retry) {
  const jitter = Math.floor(Math.random() * 150);
  return Math.min(retry.max_ms, retry.base_ms * Math.pow(2, attempt)) + jitter;
}

function supabaseIsRetryableStatus_(code) {
  return [408, 425, 429, 500, 502, 503, 504].indexOf(Number(code)) !== -1;
}

function supabaseIsRetryableError_(err) {
  const msg = String(err && err.message || err || '').toLowerCase();
  return msg.indexOf('timed out') !== -1 ||
    msg.indexOf('timeout') !== -1 ||
    msg.indexOf('socket') !== -1 ||
    msg.indexOf('dns') !== -1 ||
    msg.indexOf('address unavailable') !== -1 ||
    msg.indexOf('service invoked too many') !== -1 ||
    msg.indexOf('response code: 429') !== -1 ||
    msg.indexOf('response code: 500') !== -1 ||
    msg.indexOf('response code: 502') !== -1 ||
    msg.indexOf('response code: 503') !== -1 ||
    msg.indexOf('response code: 504') !== -1;
}

function supabaseSelect_(table, query) {
  return supabaseRequest_('get', table, null, { query: query || 'select=*' }) || [];
}

function supabaseCount_(table, filterQuery) {
  if (!isSupabaseConfigured_()) {
    throw new Error('Supabase no configurado. Faltan SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY.');
  }
  const qs = filterQuery ? filterQuery + '&select=*' : 'select=*';
  const url = getSupabaseUrl_() + supabaseRestPath_() + '/' + table + '?' + qs;
  const key = getSupabaseServiceRoleKey_();
  const response = UrlFetchApp.fetch(url, {
    method: 'get',
    headers: {
      apikey: key,
      Authorization: 'Bearer ' + key,
      Prefer: 'count=exact',
      Range: '0-0'
    },
    muteHttpExceptions: true
  });
  const code = response.getResponseCode();
  const text = response.getContentText() || '';
  if (code < 200 || code >= 300) {
    throw new Error('Supabase HTTP ' + code + ' count /' + table + ': ' + text.substring(0, 500));
  }
  const responseHeaders = response.getAllHeaders ? response.getAllHeaders() : response.getHeaders();
  const contentRange = responseHeaders['Content-Range'] || responseHeaders['content-range'] || '';
  const match = String(contentRange).match(/\/(\d+)$/);
  if (match) return Number(match[1]);
  const rows = text ? JSON.parse(text) : [];
  return Array.isArray(rows) ? rows.length : 0;
}

function supabaseUpsert_(table, rows, conflictColumns) {
  if (!rows || !rows.length) return { count: 0 };
  const payload = supabaseDedupeRowsByConflict_(rows, conflictColumns);
  if (!payload.length) return { count: 0 };
  const query = conflictColumns ? 'on_conflict=' + encodeURIComponent(conflictColumns) : '';
  supabaseRequest_('post', table, payload, {
    query: query,
    prefer: 'resolution=merge-duplicates,return=minimal'
  });
  return { count: payload.length, source_count: rows.length, duplicates_removed: rows.length - payload.length };
}

function supabaseDedupeRowsByConflict_(rows, conflictColumns) {
  if (!rows || !rows.length || !conflictColumns) return rows || [];
  const keyColumns = String(conflictColumns || '').split(',').map(function(c) { return c.trim(); }).filter(Boolean);
  if (!keyColumns.length) return rows;
  const byKey = {};
  const orderedKeys = [];
  rows.forEach(function(row) {
    const key = keyColumns.map(function(col) {
      return row[col] === null || row[col] === undefined ? '' : String(row[col]);
    }).join('|');
    if (!key || key.replace(/\|/g, '') === '') return;
    if (!byKey[key]) orderedKeys.push(key);
    byKey[key] = row;
  });
  return orderedKeys.map(function(key) { return byKey[key]; });
}

function supabaseRpc_(functionName, payload, options) {
  return supabaseRequest_('post', '/rpc/' + functionName, payload || {}, options || {});
}

function supabaseTransaction_(operations, options) {
  if (!operations || !operations.length) return { ok: true, operations: 0, results: [] };
  return supabaseRpc_('app_transaction_batch', {
    p_operations: operations
  }, Object.assign({ retries: 0 }, options || {}));
}

function supabaseTransactionalUpsert_(table, rows, conflictColumns) {
  if (!rows || !rows.length) return { ok: true, operations: 0 };
  const columns = Array.isArray(conflictColumns)
    ? conflictColumns
    : String(conflictColumns || '').split(',').map(function(c) { return c.trim(); }).filter(Boolean);
  return supabaseTransaction_([{
    action: 'upsert',
    table: table,
    rows: supabaseDedupeRowsByConflict_(rows, columns.join(',')),
    conflict_columns: columns
  }]);
}

function supabaseHealthcheck_(details) {
  const started = new Date().getTime();
  const result = supabaseRpc_('app_supabase_healthcheck', {
    p_service_name: 'pool-team-2026',
    p_details: details || {}
  }, { retries: 3, base_ms: 500, max_ms: 6000 });
  return Object.assign({
    client_latency_ms: new Date().getTime() - started
  }, result || {});
}

function cronSupabaseHealthcheck() {
  return supabaseHealthcheck_({
    source: 'gas_cron',
    active_competition_season_id: getActiveCompetitionSeasonId_(),
    ts: nowIso_()
  });
}

function nowIso_() {
  return new Date().toISOString();
}

function toIsoOrNull_(value) {
  if (value === null || value === undefined || value === '') return null;
  if (value instanceof Date && !isNaN(value.getTime())) return value.toISOString();
  const date = new Date(value);
  return isNaN(date.getTime()) ? null : date.toISOString();
}
