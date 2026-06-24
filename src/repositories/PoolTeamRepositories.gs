/**
 * PoolTeamRepositories.gs
 *
 * Repositorios finos sobre Supabase. Toda escritura del flujo nuevo pasa
 * por helpers idempotentes.
 */

function ptSelect_(table, query) {
  return supabaseSelect_(table, query || 'select=*') || [];
}

function ptSelectOne_(table, query) {
  const rows = ptSelect_(table, query + (query.indexOf('limit=') === -1 ? '&limit=1' : ''));
  return rows.length ? rows[0] : null;
}

function ptUpsert_(table, rows, conflictColumns) {
  if (!rows || !rows.length) return { count: 0 };
  if (ptDryRun_()) return { count: rows.length, dryRun: true };
  const conflictList = String(conflictColumns || '').split(',').map(function(c) { return c.trim(); }).filter(Boolean);
  if (typeof supabaseTransactionalUpsert_ === 'function' && conflictList.length) {
    return supabaseTransactionalUpsert_(table, rows, conflictList);
  }
  return supabaseUpsert_(table, rows, conflictColumns);
}

function ptInsert_(table, rows) {
  if (!rows || !rows.length) return { count: 0 };
  if (ptDryRun_()) return { count: rows.length, dryRun: true };
  if (typeof supabaseTransaction_ === 'function') {
    return supabaseTransaction_([{ action: 'insert', table: table, rows: rows }]);
  }
  return supabaseRequest_('post', table, rows, { prefer: 'return=minimal' });
}

function ptUpsertOneReturn_(table, row, conflictColumns) {
  if (ptDryRun_()) return ptDryRunRow_(table, row);
  ptUpsert_(table, [row], conflictColumns);
  return ptSelectOneByConflict_(table, row, conflictColumns);
}

function ptDryRunRow_(table, row) {
  const copy = Object.assign({}, row || {});
  const idColumns = {
    competitions: 'competition_id',
    competition_seasons: 'competition_season_id',
    competition_stages: 'stage_id',
    competition_groups: 'group_id',
    teams: 'team_id',
    venues: 'venue_id',
    matches: 'match_id',
    markets: 'market_id',
    market_selections: 'selection_id',
    bookmaker_profiles: 'bookmaker_id',
    model_registry: 'model_id',
    competition_team_entries: 'competition_team_entry_id'
  };
  const idCol = idColumns[table];
  if (idCol && !copy[idCol]) {
    copy[idCol] = '00000000-0000-4000-8000-' + ptHash_([table, ptJson_(row)].join(':')).substring(0, 12);
  }
  return copy;
}

function ptSelectOneByConflict_(table, row, conflictColumns) {
  const filters = String(conflictColumns || '').split(',').map(function(c) {
    c = c.trim();
    return c + '=eq.' + encodeURIComponent(row[c]);
  }).join('&');
  return ptSelectOne_(table, 'select=*&' + filters);
}

function ptLogPipelineStart_(jobName, payload) {
  const row = {
    job_name: jobName,
    status: 'STARTED',
    started_at: ptNowIso_(),
    records_processed: 0,
    payload: payload || {}
  };
  ptInsert_('pipeline_runs', [row]);
  return row;
}

function ptLogPipelineFinish_(jobName, status, startedAt, recordsProcessed, payload, errorMessage) {
  return ptInsert_('pipeline_runs', [{
    job_name: jobName,
    status: status,
    started_at: startedAt || ptNowIso_(),
    finished_at: ptNowIso_(),
    records_processed: recordsProcessed || 0,
    error_message: errorMessage || null,
    payload: payload || {}
  }]);
}

function ptLogQuality_(layer, severity, checkType, message, payload, entityType, entityId) {
  return ptInsert_('data_quality_events', [{
    layer: layer || 'STAGING',
    entity_type: entityType || null,
    entity_id: entityId || null,
    severity: severity || 'WARN',
    check_type: checkType || 'QUALITY_EVENT',
    message: message || 'Data quality event',
    payload: payload || {}
  }]);
}

function ptSaveRawPayload_(source, entityType, sourceEntityId, payload, rawApiCallId) {
  const hash = ptHash_(payload);
  const row = {
    source: String(source || 'UNKNOWN').toUpperCase(),
    source_entity_type: String(entityType || 'UNKNOWN'),
    source_entity_id: sourceEntityId ? String(sourceEntityId) : null,
    raw_api_call_id: rawApiCallId || null,
    payload_hash: hash,
    payload: payload,
    status: 'RECEIVED',
    received_at: ptNowIso_()
  };
  ptUpsert_('raw_source_payloads', [row], 'source,source_entity_type,payload_hash');
  return ptSelectOneByConflict_('raw_source_payloads', row, 'source,source_entity_type,payload_hash');
}

function ptSaveRawApiCall_(source, endpoint, requestPayload, response) {
  const row = {
    source: String(source || 'UNKNOWN').toUpperCase(),
    endpoint: endpoint,
    request_hash: ptHash_(requestPayload || {}),
    request_payload: requestPayload || {},
    response_status: response && response.status,
    response_hash: response && response.text ? ptHash_(response.text) : null,
    called_at: ptNowIso_(),
    latency_ms: response && response.latency_ms,
    payload: {
      ok: Boolean(response && response.ok),
      url: response && response.url,
      response: response && response.json ? response.json : null,
      error: response && response.error
    }
  };
  ptInsert_('raw_api_calls', [row]);
  return row;
}

function ptUpsertExternalRef_(entityType, entityId, source, sourceEntityType, sourceEntityId, sourceEntityName, sourceUrl, payload, isPrimary) {
  if (!entityId || !sourceEntityId) return null;
  return ptUpsert_('entity_external_refs', [{
    entity_type: entityType,
    entity_id: entityId,
    source: String(source || 'UNKNOWN').toUpperCase(),
    source_entity_type: sourceEntityType || null,
    source_entity_id: String(sourceEntityId),
    source_entity_name: sourceEntityName || null,
    source_url: sourceUrl || null,
    confidence: 1,
    is_primary: Boolean(isPrimary),
    payload: payload || {}
  }], 'entity_type,source,source_entity_id');
}

function ptFindExternalRef_(entityType, source, sourceEntityId) {
  if (!sourceEntityId) return null;
  return ptSelectOne_('entity_external_refs',
    'select=*&entity_type=eq.' + encodeURIComponent(entityType) +
    '&source=eq.' + encodeURIComponent(String(source || '').toUpperCase()) +
    '&source_entity_id=eq.' + encodeURIComponent(String(sourceEntityId)));
}

function ptEnqueueResolution_(entityType, source, sourceEntityId, sourceEntityName, normalizedName, payload) {
  return ptUpsert_('entity_resolution_queue', [{
    entity_type: entityType || 'OTHER',
    source: String(source || 'UNKNOWN').toUpperCase(),
    source_entity_type: null,
    source_entity_id: String(sourceEntityId || ptHash_(payload || {})),
    source_entity_name: sourceEntityName || 'unknown',
    normalized_name: normalizedName || ptNormalizeName_(sourceEntityName),
    resolution_status: 'OPEN',
    candidate_entities: [],
    payload: payload || {}
  }], 'entity_type,source,source_entity_id,normalized_name');
}
