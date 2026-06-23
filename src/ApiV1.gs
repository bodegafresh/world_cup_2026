/**
 * ApiV1.gs
 *
 * API estable del proyecto para operar via Cloudflare Worker:
 *   /api/v1/*
 *
 * Worker autentica con WEB_KEY y reenvia a GAS con api=v1.
 */

function routeApiV1Get_(e) {
  return apiV1Respond_(function() {
    const path = apiV1NormalizePath_(e.parameter && e.parameter.api_path);
    const params = (e && e.parameter) || {};
    return apiV1Handle_('GET', path, params, {});
  });
}

function routeApiV1Post_(e, envelope) {
  return apiV1Respond_(function() {
    const method = String((envelope && envelope.api_method) || (e.parameter && e.parameter.api_method) || 'POST').toUpperCase();
    const path = apiV1NormalizePath_((envelope && envelope.api_path) || (e.parameter && e.parameter.api_path));
    return apiV1Handle_(method, path, (envelope && envelope.query) || {}, (envelope && envelope.body) || {});
  });
}

function apiV1Respond_(fn) {
  try {
    const result = fn();
    const status = result && result.status_code ? result.status_code : 200;
    const body = Object.assign({ ok: status >= 200 && status < 300 }, result || {});
    delete body.status_code;
    return ContentService
      .createTextOutput(JSON.stringify(body))
      .setMimeType(ContentService.MimeType.JSON);
  } catch (err) {
    return ContentService
      .createTextOutput(JSON.stringify({ ok: false, error: err.message }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

function apiV1NormalizePath_(path) {
  return String(path || 'health').replace(/^\/+|\/+$/g, '');
}

function apiV1Handle_(method, path, query, body) {
  const parts = path ? path.split('/').filter(Boolean) : ['health'];

  if (method === 'GET' && path === 'health') return apiV1Health_();

  if (method === 'POST' && path === 'admin/supabase/bootstrap-mvp30') {
    return { data: supabaseMigrateMvp30Apply() };
  }
  if (method === 'POST' && path === 'admin/supabase/bootstrap-mvp30-fast') {
    return { data: supabaseBootstrapMvp30FastApply() };
  }
  if (method === 'POST' && path === 'admin/supabase/migrate-core') {
    return { data: supabaseMigrateCoreApply() };
  }
  if (method === 'POST' && path === 'admin/supabase/migrate-sheet') {
    return { data: supabaseMigrateSheetChunkApply(body.sheet || query.sheet, body.start || query.start || 0, body.limit || query.limit || 100) };
  }
  if (method === 'POST' && path === 'admin/supabase/import-sheet-raw') {
    return { data: supabaseImportSheetRawChunkApply(body.sheet || query.sheet, body.start || query.start || 0, body.limit || query.limit || 100) };
  }
  if (method === 'GET' && path === 'admin/supabase/validate') {
    return { data: supabaseValidateAgainstSheets() };
  }
  if (method === 'POST' && path === 'admin/supabase/cutover-primary') {
    return { data: supabaseCutoverToPrimaryApply() };
  }
  if (method === 'POST' && path === 'admin/supabase/rollback-sheets') {
    return { data: supabaseRollbackToSheetsApply() };
  }
  if (method === 'POST' && path === 'admin/supabase/prepare-expansion60') {
    return { data: supabasePrepareExpansion60Apply() };
  }
  if (method === 'POST' && path === 'admin/supabase/prepare-platform90') {
    return { data: supabasePreparePlatform90Apply() };
  }

  if (method === 'POST' && path === 'admin/final/bootstrap') {
    return { data: finalCanonicalBootstrapApply() };
  }
  if (method === 'POST' && path === 'admin/final/load-all-mvp') {
    return { data: finalCanonicalLoadAllMvpApply() };
  }
  if (method === 'POST' && path === 'admin/final/load-teams') {
    return { data: finalCanonicalLoadTeamsApply() };
  }
  if (method === 'POST' && path === 'admin/final/load-players') {
    return { data: finalCanonicalLoadPlayersApply() };
  }
  if (method === 'POST' && path === 'admin/final/load-matches') {
    return { data: finalCanonicalLoadMatchesApply() };
  }
  if (method === 'POST' && path === 'admin/final/load-odds') {
    return { data: finalCanonicalLoadOddsApply() };
  }
  if (method === 'POST' && path === 'admin/final/load-predictions') {
    return { data: finalCanonicalLoadPoissonPredictionsApply() };
  }
  if (method === 'POST' && path === 'admin/final/load-bets') {
    return { data: finalCanonicalLoadBettingHistoryApply() };
  }

  if (method === 'GET' && path === 'competitions/status') {
    return { data: apiV1CompetitionStatuses_() };
  }

  if (method === 'GET' && parts.length === 3 && parts[0] === 'competitions' && parts[2] === 'readiness') {
    return { data: evaluateCompetitionReadiness_(parts[1]) };
  }

  if (method === 'GET' && parts.length === 3 && parts[0] === 'competitions' && parts[2] === 'health') {
    return { data: apiV1CompetitionHealth_(parts[1]) };
  }

  if ((method === 'PATCH' || method === 'POST') && parts.length === 4 && parts[0] === 'competitions' && parts[2] === 'readiness') {
    return { data: setCompetitionReadinessCheck(parts[1], parts[3], body.status, body.score, body.details || {}) };
  }

  if ((method === 'PATCH' || method === 'POST') && parts.length === 3 && parts[0] === 'competitions' && parts[2] === 'status') {
    return { data: apiV1SetCompetitionStatus_(parts[1], body) };
  }

  if (method === 'POST' && path === 'matches') return { data: apiV1Upsert_('matches', body, 'match_id') };
  if (method === 'POST' && path === 'odds/snapshots') return { data: apiV1Upsert_('odds_snapshots', body, 'match_id,bookmaker,market,selection,captured_at') };
  if (method === 'POST' && path === 'model-runs') return { data: apiV1Insert_('model_runs', body) };
  if (method === 'POST' && path === 'predictions') return { data: apiV1Insert_('model_predictions', body) };
  if (method === 'POST' && path === 'features/snapshots') return { data: apiV1CreateFeatureSnapshot_(body) };
  if (method === 'POST' && path === 'betting-decisions/evaluate') return { data: apiV1EvaluateBettingDecision_(body) };

  if (method === 'GET' && path === 'betting-decisions') {
    const limit = Math.max(1, Math.min(100, Number(query.limit || 20)));
    return { data: supabaseSelect_('betting_decisions', 'select=*&order=decided_at.desc&limit=' + limit) };
  }

  if (method === 'GET' && parts.length === 3 && parts[0] === 'matches' && parts[2] === 'predictions') {
    return { data: supabaseSelect_('model_predictions', 'select=*&match_id=eq.' + encodeURIComponent(parts[1]) + '&order=as_of.desc') };
  }

  if (method === 'GET' && parts.length === 3 && parts[0] === 'matches' && parts[2] === 'odds') {
    return { data: supabaseSelect_('odds_snapshots', 'select=*&match_id=eq.' + encodeURIComponent(parts[1]) + '&order=captured_at.desc') };
  }

  return { status_code: 404, error: 'Unknown API route: ' + method + ' /api/v1/' + path };
}

function apiV1Health_() {
  return {
    service: 'pool-team-2026',
    supabase: isSupabaseConfigured_() ? 'configured' : 'not_configured',
    dual_write: isSupabaseDualWriteEnabled_(),
    primary_read: isSupabasePrimaryReadEnabled_(),
    active_competition_season_id: getActiveCompetitionSeasonId_(),
    ts: nowIso_()
  };
}

function apiV1CompetitionStatuses_() {
  if (isSupabaseConfigured_()) {
    try {
      return supabaseSelect_('competition_status', 'select=*&order=competition_season_id.asc');
    } catch (e_) {}
  }
  return getCompetitionCatalogRows_().map(function(r) {
    return getCompetitionStatus_(r.competition_season_id);
  });
}

function apiV1SetCompetitionStatus_(competitionSeasonId, body) {
  const status = String(body.status || '').toUpperCase();
  const reason = body.reason || body.status_reason || '';
  if (status === COMPETITION_STATUSES.OBSERVATION) return setCompetitionObservation(competitionSeasonId, reason);
  if (status === COMPETITION_STATUSES.PAPER_TRADING) return setCompetitionPaperTrading(competitionSeasonId, reason);
  if (status === COMPETITION_STATUSES.BETTABLE) return setCompetitionBettable(competitionSeasonId, reason, body.approved_by || 'api');
  if (status === COMPETITION_STATUSES.DISABLED) return disableCompetition(competitionSeasonId, reason);
  throw new Error('Estado de competencia inválido: ' + body.status);
}

function apiV1CompetitionHealth_(competitionSeasonId) {
  const readiness = evaluateCompetitionReadiness_(competitionSeasonId);
  const status = getCompetitionStatus_(competitionSeasonId);
  let market = [];
  let metrics = [];
  if (isSupabaseConfigured_()) {
    try { market = supabaseSelect_('competition_market_profiles', 'select=*&competition_season_id=eq.' + encodeURIComponent(competitionSeasonId)); } catch (e_) {}
    try { metrics = supabaseSelect_('model_metrics', 'select=*&competition_season_id=eq.' + encodeURIComponent(competitionSeasonId) + '&order=calculated_at.desc&limit=10'); } catch (e_) {}
  }
  return {
    competition_season_id: competitionSeasonId,
    status: status,
    readiness: readiness,
    market_profiles: market,
    recent_model_metrics: metrics
  };
}

function apiV1Rows_(body) {
  if (Array.isArray(body)) return body;
  return [body || {}];
}

function apiV1Insert_(table, body) {
  const rows = apiV1Rows_(body);
  supabaseRequest_('post', table, rows, { prefer: 'return=representation' });
  return { table: table, rows: rows.length };
}

function apiV1Upsert_(table, body, conflictColumns) {
  const rows = apiV1Rows_(body).map(function(row) {
    const copy = Object.assign({}, row);
    if (table === 'odds_snapshots' && !copy.captured_at) copy.captured_at = nowIso_();
    return copy;
  });
  supabaseRequest_('post', table, rows, {
    query: 'on_conflict=' + encodeURIComponent(conflictColumns),
    prefer: 'resolution=merge-duplicates,return=representation'
  });
  return { table: table, rows: rows.length };
}

function apiV1CreateFeatureSnapshot_(body) {
  if (body.features) {
    return featureSnapshotSave_({
      competition_season_id: body.competition_season_id || getActiveCompetitionSeasonId_(),
      match_id: body.match_id,
      feature_set_version: body.feature_set_version || FEATURE_SET_VERSION_DEFAULT,
      as_of: body.as_of || nowIso_(),
      features: body.features || {}
    });
  }
  if (body.match_id || body.match_key || body.fixture_id) {
    return featureSnapshotCreateForMatch_(body.match_id || body.match_key || body.fixture_id, body.options || body);
  }
  throw new Error('features/snapshots requiere match_id/match_key/fixture_id o features explicitas.');
}

function apiV1EvaluateBettingDecision_(body) {
  const competitionSeasonId = body.competition_season_id || getActiveCompetitionSeasonId_();
  const risk = riskEvaluateOpportunity_(body, {
    match_id: body.match_id,
    competition_season_id: competitionSeasonId
  }, { competition_season_id: competitionSeasonId });
  const payload = {
    competition_season_id: competitionSeasonId,
    prediction_id: body.prediction_id || null,
    odds_snapshot_key: body.odds_snapshot_key || '',
    match_id: body.match_id,
    market: body.market,
    selection: body.selection,
    model_probability: Number(body.model_probability || body.calibrated_probability || 0),
    decimal_odds: Number(body.decimal_odds || body.odds || 0),
    edge: risk.metrics.edge_pp,
    ev: risk.metrics.ev_pct,
    kelly_fraction: risk.kelly_fraction,
    decision: risk.allowed ? 'BETTABLE' : risk.decision,
    block_reason: risk.block_reason,
    risk_engine_version: risk.risk_engine_version,
    payload: {
      request: body,
      risk: risk
    }
  };
  supabaseRequest_('post', 'betting_decisions', [payload], { prefer: 'return=representation' });
  return payload;
}
