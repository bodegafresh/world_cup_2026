/**
 * SupabaseClient.gs
 *
 * Cliente REST minimalista para Supabase desde Google Apps Script.
 * No guarda secretos en codigo: requiere Script Properties:
 *   - SUPABASE_URL
 *   - SUPABASE_SERVICE_ROLE_KEY
 *
 * Feature flags:
 *   - SUPABASE_DUAL_WRITE=true     -> espeja escrituras de Sheets a Supabase.
 *   - SUPABASE_PRIMARY_READ=true   -> readAll_ lee desde Supabase para hojas soportadas.
 */

const SUPABASE_SHEET_TABLES = {
  Partidos: {
    table: 'matches',
    conflict: 'match_id',
    key: ['match_id'],
    transform: supabaseMapPartido_,
    reverse: supabaseReversePartido_
  },
  Equipos: {
    table: 'teams',
    conflict: 'team_key',
    key: ['team_key'],
    transform: supabaseMapEquipo_,
    reverse: supabaseReverseEquipo_
  },
  Jugadores: {
    table: 'players',
    conflict: 'player_key',
    key: ['player_key'],
    transform: supabaseMapJugador_,
    reverse: supabaseReverseJugador_
  },
  Clasificacion: {
    table: 'standings',
    conflict: 'competition_id,group_code,team_key',
    key: ['competition_id', 'group_code', 'team_key'],
    transform: supabaseMapClasificacion_,
    reverse: supabaseReverseClasificacion_
  },
  PlayerMatchStats: {
    table: 'player_match_stats',
    conflict: 'match_id,player_key,source',
    key: ['match_id', 'player_key', 'source'],
    transform: supabaseMapPlayerMatchStats_,
    reverse: supabaseReversePlayerMatchStats_
  },
  ResumenJugadorPartido: {
    table: 'player_match_summary',
    conflict: 'match_id,player_key',
    key: ['match_id', 'player_key'],
    transform: supabaseMapPlayerSummary_,
    reverse: supabaseReversePlayerSummary_
  },
  OddsApuestas: {
    table: 'odds_snapshots',
    conflict: 'match_id,bookmaker,market,selection,captured_at',
    key: ['match_id', 'bookmaker', 'market', 'selection', 'captured_at'],
    transform: supabaseMapOdds_,
    reverse: supabaseReverseOdds_
  },
  PoissonOdds: {
    table: 'model_outputs',
    conflict: 'match_id,model_name,market,run_at',
    key: ['match_id', 'model_name', 'market', 'run_at'],
    transform: function(row) { return supabaseMapModelOutput_(row, 'POISSON'); },
    reverse: supabaseReversePoisson_
  },
  AnalisisIA: {
    table: 'model_outputs',
    conflict: 'match_id,model_name,market,run_at',
    key: ['match_id', 'model_name', 'market', 'run_at'],
    transform: function(row) { return supabaseMapModelOutput_(row, 'AI_ANALYSIS'); },
    reverse: supabaseReverseAiAnalysis_
  },
  EvOpportunities: {
    table: 'ev_picks',
    conflict: 'pick_key',
    key: ['pick_key'],
    transform: function(row) { return supabaseMapEvPick_(row, 'PUBLISHED'); },
    reverse: supabaseReverseEvPick_
  },
  EvHistorico: {
    table: 'ev_picks',
    conflict: 'pick_key',
    key: ['pick_key'],
    transform: function(row) { return supabaseMapEvPick_(row, 'HISTORICAL'); },
    reverse: supabaseReverseEvPick_
  },
  BettingHistory: {
    table: 'bets',
    conflict: 'bet_id',
    key: ['bet_id'],
    transform: supabaseMapBet_,
    reverse: supabaseReverseBet_
  },
  ModelCalibration: {
    table: 'model_calibration',
    conflict: 'calibration_key',
    key: ['calibration_key'],
    transform: supabaseMapCalibration_,
    reverse: supabaseReverseCalibration_
  },
  SimulacionGrupos: {
    table: 'group_simulations',
    conflict: 'simulation_key',
    key: ['simulation_key'],
    transform: supabaseMapSimulation_,
    reverse: supabaseReverseSimulation_
  },
  EloRatings: {
    table: 'elo_ratings',
    conflict: 'team_key',
    key: ['team_key'],
    transform: supabaseMapElo_,
    reverse: supabaseReverseElo_
  },
  PipelineRuns: {
    table: 'pipeline_runs',
    conflict: 'run_id',
    key: ['run_id'],
    transform: supabaseMapPipelineRun_,
    reverse: supabaseReversePipelineRun_
  },
  DataQualityLog: {
    table: 'data_quality_log',
    conflict: 'quality_id',
    key: ['quality_id'],
    transform: supabaseMapDataQuality_,
    reverse: supabaseReverseDataQuality_
  },
  SourceFixtures: {
    table: 'source_fixtures',
    conflict: 'source_fixture_key',
    key: ['source_fixture_key'],
    transform: supabaseMapSourceFixture_,
    reverse: supabaseReverseSourceFixture_
  },
  MatchMapping: {
    table: 'match_source_ids',
    conflict: 'source,source_match_id',
    key: ['source', 'source_match_id'],
    transform: supabaseMapMatchMapping_,
    reverse: supabaseReverseMatchMapping_
  },
  EstadiosClima: {
    table: 'weather_snapshots',
    conflict: 'weather_key',
    key: ['weather_key'],
    transform: supabaseMapWeather_,
    reverse: supabaseReverseWeather_
  },
  Noticias: {
    table: 'news_items',
    conflict: 'id_hash',
    key: ['id_hash'],
    transform: supabaseMapNews_,
    reverse: supabaseReverseNews_
  }
};

function isSupabaseConfigured_() {
  const props = PropertiesService.getScriptProperties();
  return Boolean(props.getProperty('SUPABASE_URL') && props.getProperty('SUPABASE_SERVICE_ROLE_KEY'));
}

function isSupabaseDualWriteEnabled_() {
  return isSupabaseConfigured_() &&
    String(PropertiesService.getScriptProperties().getProperty(CONFIG.SUPABASE.DUAL_WRITE_PROP) || '').toLowerCase() === 'true';
}

function isSupabasePrimaryReadEnabled_() {
  return isSupabaseConfigured_() &&
    String(PropertiesService.getScriptProperties().getProperty(CONFIG.SUPABASE.PRIMARY_READ_PROP) || '').toLowerCase() === 'true';
}

function isSupabaseSheetSupported_(sheetName) {
  return Boolean(SUPABASE_SHEET_TABLES[sheetName]);
}

function supabaseSetDualWrite(enabled) {
  PropertiesService.getScriptProperties().setProperty(CONFIG.SUPABASE.DUAL_WRITE_PROP, enabled ? 'true' : 'false');
  Logger.log('SUPABASE_DUAL_WRITE=' + (enabled ? 'true' : 'false'));
}

function supabaseSetPrimaryRead(enabled) {
  PropertiesService.getScriptProperties().setProperty(CONFIG.SUPABASE.PRIMARY_READ_PROP, enabled ? 'true' : 'false');
  Logger.log('SUPABASE_PRIMARY_READ=' + (enabled ? 'true' : 'false'));
}

function supabaseStatus() {
  const status = {
    configured: isSupabaseConfigured_(),
    dual_write: isSupabaseDualWriteEnabled_(),
    primary_read: isSupabasePrimaryReadEnabled_(),
    supported_sheets: Object.keys(SUPABASE_SHEET_TABLES)
  };
  Logger.log(JSON.stringify(status, null, 2));
  return status;
}

function supabaseRequest_(method, tableOrPath, payload, options) {
  options = options || {};
  if (!isSupabaseConfigured_()) throw new Error('Supabase no configurado. Faltan SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY.');

  const base = getSupabaseUrl_() + CONFIG.SUPABASE.REST_PATH;
  const path = String(tableOrPath || '').charAt(0) === '/' ? tableOrPath : '/' + tableOrPath;
  const qs = options.query ? '?' + options.query : '';
  const url = base + path + qs;
  const headers = {
    apikey: getSupabaseServiceRoleKey_(),
    Authorization: 'Bearer ' + getSupabaseServiceRoleKey_(),
    'Content-Type': 'application/json'
  };
  if (options.prefer) headers.Prefer = options.prefer;

  const params = {
    method: method,
    headers: headers,
    muteHttpExceptions: true
  };
  if (payload !== undefined && payload !== null) params.payload = JSON.stringify(payload);

  const response = UrlFetchApp.fetch(url, params);
  const code = response.getResponseCode();
  const text = response.getContentText() || '';
  if (code < 200 || code >= 300) {
    throw new Error('Supabase HTTP ' + code + ' ' + method + ' ' + path + ': ' + text.substring(0, 500));
  }
  if (!text) return null;
  try { return JSON.parse(text); } catch (e_) { return text; }
}

function supabaseSelect_(table, query) {
  return supabaseRequest_('get', table, null, { query: query || 'select=*' }) || [];
}

function supabaseUpsert_(table, rows, conflictColumns) {
  if (!rows || !rows.length) return { count: 0 };
  const query = conflictColumns ? 'on_conflict=' + encodeURIComponent(conflictColumns) : '';
  supabaseRequest_('post', table, rows, {
    query: query,
    prefer: 'resolution=merge-duplicates,return=minimal'
  });
  return { count: rows.length };
}

function supabaseMirrorRows_(sheetName, headers, rows) {
  if (!isSupabaseDualWriteEnabled_() || !rows || !rows.length) return { mirrored: 0 };
  if (!isSupabaseSheetSupported_(sheetName)) return supabaseMirrorRawRows_(sheetName, headers, rows);
  const cfg = SUPABASE_SHEET_TABLES[sheetName];
  const objects = rowsToObjects_(headers, rows);
  const payload = objects.map(cfg.transform).filter(Boolean);
  if (!payload.length) return { mirrored: 0 };
  supabaseUpsert_(cfg.table, payload, cfg.conflict);
  return { mirrored: payload.length, table: cfg.table };
}

function supabaseMirrorRawRows_(sheetName, headers, rows) {
  if (!isSupabaseDualWriteEnabled_() || !rows || !rows.length) return { mirrored: 0 };
  const payload = rowsToObjects_(headers, rows).map(function(row, i) {
    return {
      sheet_name: sheetName,
      row_key: hash_(sheetName + '|' + JSON.stringify(row)),
      source_row_number: null,
      payload: row,
      synced_at: nowIso_()
    };
  });
  supabaseUpsert_('sheet_raw_rows', payload, 'sheet_name,row_key');
  return { mirrored: payload.length, table: 'sheet_raw_rows' };
}

function supabaseReadSheet_(sheetName) {
  if (!isSupabasePrimaryReadEnabled_() || !isSupabaseSheetSupported_(sheetName)) return null;
  const cfg = SUPABASE_SHEET_TABLES[sheetName];
  const rows = supabaseSelect_(cfg.table, 'select=*');
  return rows.map(cfg.reverse || function(r) { return r; }).map(applySheetAliases_);
}

function rowsToObjects_(headers, rows) {
  return (rows || []).map(function(row) {
    if (!Array.isArray(row)) return Object.assign({}, row);
    const obj = {};
    headers.forEach(function(h, i) { obj[h] = row[i]; });
    applySheetAliases_(obj);
    return obj;
  });
}

function getSupabaseBatchSize_() {
  const raw = Number(PropertiesService.getScriptProperties().getProperty(CONFIG.SUPABASE.MIGRATION_BATCH_SIZE_PROP) || CONFIG.SUPABASE.DEFAULT_BATCH_SIZE);
  return Math.max(1, Math.min(CONFIG.SUPABASE.MAX_BATCH_SIZE, raw || CONFIG.SUPABASE.DEFAULT_BATCH_SIZE));
}

function toNumberOrNull_(value) {
  if (value === '' || value === null || value === undefined) return null;
  const n = Number(value);
  return isFinite(n) ? n : null;
}

function toBool_(value) {
  if (value === true || value === false) return value;
  const s = String(value || '').trim().toLowerCase();
  if (['true','si','sí','yes','1'].indexOf(s) !== -1) return true;
  if (['false','no','0'].indexOf(s) !== -1) return false;
  return null;
}

function nowIso_() {
  return new Date().toISOString();
}

function toIsoOrNull_(value) {
  if (!value) return null;
  if (Object.prototype.toString.call(value) === '[object Date]' && !isNaN(value.getTime())) return value.toISOString();
  const s = String(value).trim();
  if (!s) return null;
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d.toISOString();
}

function canonicalTeamKey_(name) {
  return normalizeTeamNameStrong_(teamNameToSpanish_(name || ''));
}

function canonicalPlayerKey_(name, teamName, sourceId) {
  const id = String(sourceId || '').trim();
  if (id) return 'player_' + id;
  return hash_([normalizeTeamNameStrong_(teamName || ''), normalizeTeamNameStrong_(name || '')].join('|'));
}

function ensureMatchIdFromRow_(row) {
  return String(row.match_id || row.fixture_id || row.fixture_id_api_football || row.fixture_id_af || '').trim() ||
    buildCanonicalMatchId_(row.fecha || row.date || row.fecha_chile, row.local || row.equipo_local || row.home_team, row.visitante || row.equipo_visitante || row.away_team);
}

function supabaseMapPartido_(r) {
  const matchId = ensureMatchIdFromRow_(r);
  if (!matchId) return null;
  return {
    match_id: matchId,
    competition_id: 'WC2026',
    season: 2026,
    match_key: String(r.match_key || matchId),
    date: normalizeFecha_(r.fecha || r.fecha_chile || ''),
    kickoff_chile: safeHoraChile_(r.hora_chile || r.hora || ''),
    stage: safe_(r.fase || r.ronda || ''),
    group_code: safe_(r.grupo || r.group || ''),
    home_team_key: canonicalTeamKey_(r.local),
    home_team_name: teamNameToSpanish_(r.local || ''),
    away_team_key: canonicalTeamKey_(r.visitante),
    away_team_name: teamNameToSpanish_(r.visitante || ''),
    venue_name: safe_(r.estadio),
    venue_city: safe_(r.ciudad),
    venue_country: safe_(r.pais_estadio || r.pais || r.pais_torneo),
    venue_id: safe_(r.venue_id),
    lat: toNumberOrNull_(r.lat),
    lon: toNumberOrNull_(r.lon),
    home_score: toNumberOrNull_(r.goles_local),
    away_score: toNumberOrNull_(r.goles_visitante),
    status: safe_(r.status || r.estado || 'NS'),
    winner: safe_(r.winner),
    source: safe_(r.fuente),
    api_football_fixture_id: safe_(r.fixture_id_api_football || r.fixture_id_af),
    football_data_match_id: safe_(r.match_id_football_data || r.fixture_id_fd),
    espn_event_id: safe_(r.espn_event_id || r.espn_id),
    sources_used: safe_(r.sources_used),
    confidence_score: toNumberOrNull_(r.confidence_score),
    has_conflict: toBool_(r.has_conflict),
    conflict_detail: safe_(r.conflict_detail),
    data_quality_notes: safe_(r.data_quality_notes),
    payload: r,
    updated_at: nowIso_()
  };
}

function supabaseReversePartido_(r) {
  return {
    match_id: r.match_id,
    fecha: r.date,
    fecha_chile: r.date,
    hora_chile: r.kickoff_chile,
    fase: r.stage,
    grupo: r.group_code,
    local: r.home_team_name,
    visitante: r.away_team_name,
    estadio: r.venue_name,
    ciudad: r.venue_city,
    pais_estadio: r.venue_country,
    venue_id: r.venue_id,
    lat: r.lat,
    lon: r.lon,
    goles_local: r.home_score,
    goles_visitante: r.away_score,
    fuente: r.source,
    match_key: r.match_key,
    fixture_id_api_football: r.api_football_fixture_id,
    match_id_football_data: r.football_data_match_id,
    espn_event_id: r.espn_event_id,
    sources_used: r.sources_used,
    confidence_score: r.confidence_score,
    has_conflict: r.has_conflict,
    conflict_detail: r.conflict_detail,
    status: r.status,
    winner: r.winner,
    data_quality_notes: r.data_quality_notes
  };
}

function supabaseMapEquipo_(r) {
  const name = r.nombre || r.equipo || r.team || r.display_name || '';
  const key = String(r.team_key || '').trim() || canonicalTeamKey_(name);
  if (!key) return null;
  return {
    team_key: key,
    display_name: teamNameToSpanish_(name),
    normalized_name: normalizeTeamNameStrong_(name),
    group_code: safe_(r.grupo || r.group_code),
    api_football_team_id: safe_(r.team_id_api_football || r.equipo_id || r.team_id),
    football_data_team_id: safe_(r.team_id_football_data),
    country_code: safe_(r.country_code || r.codigo_pais),
    payload: r,
    updated_at: nowIso_()
  };
}

function supabaseReverseEquipo_(r) {
  return {
    team_key: r.team_key,
    nombre: r.display_name,
    nombre_normalizado: r.normalized_name,
    grupo: r.group_code,
    team_id_api_football: r.api_football_team_id,
    team_id_football_data: r.football_data_team_id,
    country_code: r.country_code
  };
}

function supabaseMapJugador_(r) {
  const name = r.jugador || r.nombre || r.player_name || '';
  const teamName = r.equipo || r.team_name || '';
  const key = String(r.player_key || '').trim() || canonicalPlayerKey_(name, teamName, r.player_id || r.jugador_id);
  if (!key) return null;
  return {
    player_key: key,
    display_name: safe_(name),
    normalized_name: normalizeTeamNameStrong_(name),
    team_key: canonicalTeamKey_(teamName),
    team_name: teamName ? teamNameToSpanish_(teamName) : '',
    position: safe_(r.posicion || r.position),
    api_football_player_id: safe_(r.player_id_api_football || r.player_id || r.jugador_id),
    football_data_player_id: safe_(r.player_id_football_data),
    photo_url: safe_(r.foto || r.photo || r.photo_url),
    payload: r,
    updated_at: nowIso_()
  };
}

function supabaseReverseJugador_(r) {
  return {
    player_key: r.player_key,
    jugador: r.display_name,
    nombre: r.display_name,
    equipo: r.team_name,
    posicion: r.position,
    player_id: r.api_football_player_id,
    foto: r.photo_url
  };
}

function supabaseMapClasificacion_(r) {
  const team = r.equipo || r.team || '';
  const groupCode = safe_(r.grupo || r.group || '');
  const teamKey = canonicalTeamKey_(team);
  if (!groupCode || !teamKey) return null;
  return {
    competition_id: 'WC2026',
    group_code: groupCode,
    team_key: teamKey,
    team_name: teamNameToSpanish_(team),
    position: toNumberOrNull_(r.posicion || r.pos),
    played: toNumberOrNull_(r.pj),
    won: toNumberOrNull_(r.pg),
    drawn: toNumberOrNull_(r.pe),
    lost: toNumberOrNull_(r.pp),
    goals_for: toNumberOrNull_(r.gf),
    goals_against: toNumberOrNull_(r.gc),
    goal_diff: toNumberOrNull_(r.gd),
    points: toNumberOrNull_(r.puntos || r.pts),
    form: safe_(r.forma),
    description: safe_(r.descripcion),
    updated_at: toIsoOrNull_(r.updated_at) || nowIso_()
  };
}

function supabaseReverseClasificacion_(r) {
  return {
    grupo: r.group_code,
    posicion: r.position,
    equipo: r.team_name,
    pj: r.played,
    pg: r.won,
    pe: r.drawn,
    pp: r.lost,
    gf: r.goals_for,
    gc: r.goals_against,
    gd: r.goal_diff,
    puntos: r.points,
    forma: r.form,
    descripcion: r.description,
    updated_at: r.updated_at
  };
}

function supabaseMapPlayerMatchStats_(r) {
  const matchId = ensureMatchIdFromRow_(r);
  const playerName = r.player_name || r.jugador || '';
  const teamName = r.team_name || r.equipo || '';
  const playerKey = canonicalPlayerKey_(playerName, teamName, r.player_id || r.jugador_id);
  if (!matchId || !playerKey) return null;
  return {
    match_id: matchId,
    player_key: playerKey,
    player_name: safe_(playerName),
    team_key: canonicalTeamKey_(teamName),
    team_name: teamNameToSpanish_(teamName),
    source: safe_(r.source || r.fuente || 'api_football'),
    position: safe_(r.position || r.posicion),
    minutes_played: toNumberOrNull_(r.minutes_played || r.minutos),
    rating: toNumberOrNull_(r.rating || r.nota),
    goals_scored: toNumberOrNull_(r.goals_scored || r.goles),
    assists: toNumberOrNull_(r.assists || r.asistencias),
    yellow_cards: toNumberOrNull_(r.yellow_cards || r.amarillas),
    red_cards: toNumberOrNull_(r.red_cards || r.rojas),
    payload: r,
    loaded_at: toIsoOrNull_(r.loaded_at || r.updated_at) || nowIso_()
  };
}

function supabaseReversePlayerMatchStats_(r) {
  const payload = r.payload || {};
  payload.fixture_id = r.match_id;
  payload.player_id = payload.player_id || r.player_key;
  payload.player_name = r.player_name;
  payload.team_name = r.team_name;
  payload.minutes_played = r.minutes_played;
  payload.rating = r.rating;
  payload.position = r.position;
  payload.goals_scored = r.goals_scored;
  payload.assists = r.assists;
  payload.yellow_cards = r.yellow_cards;
  payload.red_cards = r.red_cards;
  payload.loaded_at = r.loaded_at;
  return payload;
}

function supabaseMapPlayerSummary_(r) {
  const matchId = ensureMatchIdFromRow_(r);
  const playerName = r.jugador || r.player_name || '';
  const teamName = r.equipo || r.team_name || '';
  const playerKey = canonicalPlayerKey_(playerName, teamName, r.jugador_id || r.player_id);
  if (!matchId || !playerKey) return null;
  return {
    match_id: matchId,
    player_key: playerKey,
    player_name: playerName,
    team_key: canonicalTeamKey_(teamName),
    team_name: teamNameToSpanish_(teamName),
    goals: toNumberOrNull_(r.goles),
    assists: toNumberOrNull_(r.asistencias),
    yellow_cards: toNumberOrNull_(r.amarillas),
    red_cards: toNumberOrNull_(r.rojas),
    minutes: toNumberOrNull_(r.minutos),
    updated_at: toIsoOrNull_(r.updated_at) || nowIso_()
  };
}

function supabaseReversePlayerSummary_(r) {
  return {
    fixture_id: r.match_id,
    jugador_id: r.player_key,
    jugador: r.player_name,
    equipo: r.team_name,
    goles: r.goals,
    asistencias: r.assists,
    amarillas: r.yellow_cards,
    rojas: r.red_cards,
    minutos: r.minutes,
    updated_at: r.updated_at
  };
}

function supabaseMapOdds_(r) {
  const matchId = ensureMatchIdFromRow_(r);
  const market = safe_(r.mercado || r.market);
  const selection = safe_(r.seleccion || r.selection);
  const capturedAt = toIsoOrNull_(r.timestamp || r.captured_at) || nowIso_();
  if (!matchId || !market || !selection) return null;
  return {
    match_id: matchId,
    bookmaker: safe_(r.fuente || r.bookmaker || 'unknown'),
    market: market,
    selection: selection,
    decimal_odds: toNumberOrNull_(r.cuota || r.odds),
    implied_probability: toNumberOrNull_(r.probabilidad_implicita || r.implied_probability),
    model_probability: toNumberOrNull_(r.probabilidad_modelo || r.prob_modelo),
    captured_at: capturedAt,
    payload: r
  };
}

function supabaseReverseOdds_(r) {
  return {
    fixture_id: r.match_id,
    fuente: r.bookmaker,
    mercado: r.market,
    seleccion: r.selection,
    cuota: r.decimal_odds,
    probabilidad_modelo: r.model_probability,
    timestamp: r.captured_at
  };
}

function supabaseMapModelOutput_(r, modelName) {
  const matchId = ensureMatchIdFromRow_(r);
  if (!matchId) return null;
  const runAt = toIsoOrNull_(r.updated_at || r.timestamp || r.run_at) || nowIso_();
  return {
    match_id: matchId,
    model_name: modelName,
    model_version: safe_(r.model_version || r.fuente_modelo || 'v1'),
    market: safe_(r.mercado || '1X2'),
    run_at: runAt,
    home_team_name: teamNameToSpanish_(r.equipo_local || r.local || ''),
    away_team_name: teamNameToSpanish_(r.equipo_visitante || r.visitante || ''),
    prob_home: toNumberOrNull_(r.prob_local || r.prob_home || r.home_prob),
    prob_draw: toNumberOrNull_(r.prob_empate || r.prob_draw || r.draw_prob),
    prob_away: toNumberOrNull_(r.prob_visitante || r.prob_away || r.away_prob),
    prob_over25: toNumberOrNull_(r.over_2_5 || r.prob_over25),
    prob_btts: toNumberOrNull_(r.btts || r.prob_btts),
    lambda_home: toNumberOrNull_(r.lambda_local || r.lambda_home),
    lambda_away: toNumberOrNull_(r.lambda_visitante || r.lambda_away),
    confidence: safe_(r.confianza || r.confidence),
    reliability: toNumberOrNull_(r.model_reliability || r.reliability),
    flags: splitFlags_(r.invalid_reasons || r.flags || r.alertas),
    is_valid: toBool_(r.is_valid_model) !== false,
    summary: safe_(r.resumen_previa || r.summary),
    payload: r
  };
}

function supabaseReversePoisson_(r) {
  return {
    fixture_id: r.match_id,
    equipo_local: r.home_team_name,
    equipo_visitante: r.away_team_name,
    prob_local: r.prob_home,
    prob_empate: r.prob_draw,
    prob_visitante: r.prob_away,
    lambda_local: r.lambda_home,
    lambda_visitante: r.lambda_away,
    confianza: r.confidence,
    updated_at: r.run_at,
    fuente: r.model_name
  };
}

function supabaseReverseAiAnalysis_(r) {
  return {
    fixture_id: r.match_id,
    equipo_local: r.home_team_name,
    equipo_visitante: r.away_team_name,
    prob_local: r.prob_home,
    prob_empate: r.prob_draw,
    prob_visitante: r.prob_away,
    over_2_5: r.prob_over25,
    btts: r.prob_btts,
    confianza: r.confidence,
    resumen_previa: r.summary,
    updated_at: r.run_at,
    fuente: r.model_name
  };
}

function supabaseMapEvPick_(r, defaultStatus) {
  const matchId = ensureMatchIdFromRow_(r);
  const market = safe_(r.mercado || r.market);
  const selection = safe_(r.seleccion || r.selection);
  const publishedAt = toIsoOrNull_(r.timestamp || r.published_at || r.fecha) || nowIso_();
  const pickKey = safe_(r.pick_key) || hash_([matchId, market, selection, r.cuota, publishedAt].join('|'));
  if (!matchId || !market || !selection) return null;
  const ev = toNumberOrNull_(r.ev || r.expected_value) || 0;
  return {
    pick_key: pickKey,
    match_id: matchId,
    match_date: normalizeFecha_(r.fecha || r.date || ''),
    home_team_name: teamNameToSpanish_(r.local || r.home_team || ''),
    away_team_name: teamNameToSpanish_(r.visitante || r.away_team || ''),
    market: market,
    selection: selection,
    decimal_odds: toNumberOrNull_(r.cuota || r.odds),
    fair_odds: toNumberOrNull_(r.cuota_justa || r.fair_odds),
    model_probability: toNumberOrNull_(r.prob_modelo || r.model_prob),
    edge: toNumberOrNull_(r.edge),
    ev: ev,
    kelly_fraction: toNumberOrNull_(r.kelly),
    category: ev > 0 ? 'EV_PLUS' : 'MARKET_OVERPRICED',
    status: safe_(r.status || defaultStatus || 'PUBLISHED'),
    confidence: safe_(r.confianza || r.confidence),
    model_source: safe_(r.fuente_modelo || r.source),
    is_suspicious: toBool_(r.sospechoso),
    is_outlier: toBool_(r.outlier),
    result: safe_(r.resultado || r.result),
    profit_units: toNumberOrNull_(r.profit_loss || r.profit_units),
    published_at: publishedAt,
    resolved_at: toIsoOrNull_(r.resolved_at),
    payload: r
  };
}

function supabaseReverseEvPick_(r) {
  return {
    pick_key: r.pick_key,
    fixture_id: r.match_id,
    timestamp: r.published_at,
    fecha: r.match_date,
    local: r.home_team_name,
    visitante: r.away_team_name,
    mercado: r.market,
    seleccion: r.selection,
    cuota: r.decimal_odds,
    cuota_justa: r.fair_odds,
    prob_modelo: r.model_probability,
    ev: r.ev,
    edge: r.edge,
    kelly: r.kelly_fraction,
    ev_positivo: r.category === 'EV_PLUS' ? 'SI' : 'NO',
    confianza: r.confidence,
    fuente_modelo: r.model_source,
    sospechoso: r.is_suspicious,
    outlier: r.is_outlier,
    resultado: r.result,
    profit_loss: r.profit_units,
    status: r.status
  };
}

function supabaseMapBet_(r) {
  const betId = safe_(r.bet_id) || hash_(JSON.stringify(r));
  return {
    bet_id: betId,
    pick_key: safe_(r.pick_key || r.fixture_id),
    match_id: ensureMatchIdFromRow_(r),
    market: safe_(r.mercado),
    selection: safe_(r.seleccion),
    decimal_odds: toNumberOrNull_(r.cuota),
    model_probability: toNumberOrNull_(r.prob_modelo),
    ev: toNumberOrNull_(r.ev),
    kelly_fraction: toNumberOrNull_(r.kelly_fraction),
    stake: toNumberOrNull_(r.stake),
    result: safe_(r.resultado),
    profit_loss: toNumberOrNull_(r.profit_loss),
    roi_accumulated: toNumberOrNull_(r.roi_acum),
    notes: safe_(r.notas),
    taken_at: toIsoOrNull_(r.fecha) || nowIso_(),
    payload: r
  };
}

function supabaseReverseBet_(r) {
  return {
    bet_id: r.bet_id,
    fixture_id: r.match_id,
    fecha: r.taken_at,
    mercado: r.market,
    seleccion: r.selection,
    cuota: r.decimal_odds,
    prob_modelo: r.model_probability,
    ev: r.ev,
    kelly_fraction: r.kelly_fraction,
    stake: r.stake,
    resultado: r.result,
    profit_loss: r.profit_loss,
    roi_acum: r.roi_accumulated,
    notas: r.notes
  };
}

function supabaseMapCalibration_(r) {
  const date = normalizeFecha_(r.fecha || r.date || nowChile_());
  return {
    calibration_key: safe_(r.calibration_key) || hash_([date, r.interpretacion || '', r.updated_at || ''].join('|')),
    date: date,
    evaluated_matches: toNumberOrNull_(r.partidos_evaluados),
    accuracy: toNumberOrNull_(r.accuracy),
    brier_score: toNumberOrNull_(r.brier_score),
    interpretation: safe_(r.interpretacion),
    updated_at: toIsoOrNull_(r.updated_at) || nowIso_(),
    payload: r
  };
}

function supabaseReverseCalibration_(r) {
  return {
    fecha: r.date,
    partidos_evaluados: r.evaluated_matches,
    accuracy: r.accuracy,
    brier_score: r.brier_score,
    interpretacion: r.interpretation,
    updated_at: r.updated_at
  };
}

function supabaseMapSimulation_(r) {
  const groupCode = safe_(r.grupo);
  const teamName = r.equipo || '';
  return {
    simulation_key: hash_([groupCode, canonicalTeamKey_(teamName)].join('|')),
    group_code: groupCode,
    team_key: canonicalTeamKey_(teamName),
    team_name: teamNameToSpanish_(teamName),
    qualify_probability: toNumberOrNull_(r.prob_clasificar),
    remaining_matches: toNumberOrNull_(r.partidos_restantes),
    updated_at: toIsoOrNull_(r.updated_at) || nowIso_()
  };
}

function supabaseReverseSimulation_(r) {
  return {
    grupo: r.group_code,
    equipo: r.team_name,
    prob_clasificar: r.qualify_probability,
    partidos_restantes: r.remaining_matches,
    updated_at: r.updated_at
  };
}

function supabaseMapElo_(r) {
  const teamName = r.equipo || r.team || '';
  const key = canonicalTeamKey_(teamName);
  if (!key) return null;
  return {
    team_key: key,
    team_name: teamNameToSpanish_(teamName),
    elo_current: toNumberOrNull_(r.elo_actual || r.elo),
    elo_previous: toNumberOrNull_(r.elo_anterior),
    matches: toNumberOrNull_(r.partidos),
    wins: toNumberOrNull_(r.victorias),
    draws: toNumberOrNull_(r.empates),
    losses: toNumberOrNull_(r.derrotas),
    updated_at: toIsoOrNull_(r.updated_at) || nowIso_()
  };
}

function supabaseReverseElo_(r) {
  return {
    equipo: r.team_name,
    elo_actual: r.elo_current,
    elo_anterior: r.elo_previous,
    partidos: r.matches,
    victorias: r.wins,
    empates: r.draws,
    derrotas: r.losses,
    updated_at: r.updated_at
  };
}

function supabaseMapPipelineRun_(r) {
  return {
    run_id: safe_(r.run_id) || hash_(JSON.stringify(r)),
    started_at: toIsoOrNull_(r.started_at) || nowIso_(),
    finished_at: toIsoOrNull_(r.finished_at),
    mode: safe_(r.mode),
    date_from: normalizeFecha_(r.date_from || ''),
    date_to: normalizeFecha_(r.date_to || ''),
    step: safe_(r.step),
    status: safe_(r.status),
    api_football_count: toNumberOrNull_(r.api_football_count),
    football_data_count: toNumberOrNull_(r.football_data_count),
    golden_count: toNumberOrNull_(r.golden_count),
    enriched_count: toNumberOrNull_(r.enriched_count),
    teams_count: toNumberOrNull_(r.teams_count),
    players_count: toNumberOrNull_(r.players_count),
    errors: safe_(r.errors),
    notes: safe_(r.notes),
    payload: r
  };
}

function supabaseReversePipelineRun_(r) {
  return {
    run_id: r.run_id,
    started_at: r.started_at,
    finished_at: r.finished_at,
    mode: r.mode,
    date_from: r.date_from,
    date_to: r.date_to,
    step: r.step,
    status: r.status,
    api_football_count: r.api_football_count,
    football_data_count: r.football_data_count,
    golden_count: r.golden_count,
    enriched_count: r.enriched_count,
    teams_count: r.teams_count,
    players_count: r.players_count,
    errors: r.errors,
    notes: r.notes
  };
}

function supabaseMapDataQuality_(r) {
  return {
    quality_id: safe_(r.quality_id) || hash_(JSON.stringify(r)),
    match_key: safe_(r.match_key),
    check_type: safe_(r.check_type),
    field_name: safe_(r.field_name),
    api_football_value: safe_(r.api_football_value),
    football_data_value: safe_(r.football_data_value),
    selected_value: safe_(r.selected_value),
    severity: safe_(r.severity),
    confidence: toNumberOrNull_(r.confidence),
    resolution: safe_(r.resolution),
    created_at: toIsoOrNull_(r.created_at) || nowIso_(),
    payload: r
  };
}

function supabaseReverseDataQuality_(r) {
  return {
    quality_id: r.quality_id,
    match_key: r.match_key,
    check_type: r.check_type,
    field_name: r.field_name,
    api_football_value: r.api_football_value,
    football_data_value: r.football_data_value,
    selected_value: r.selected_value,
    severity: r.severity,
    confidence: r.confidence,
    resolution: r.resolution,
    created_at: r.created_at
  };
}

function supabaseMapSourceFixture_(r) {
  return {
    source_fixture_key: safe_(r.source_fixture_key) || hash_(JSON.stringify(r)),
    source: safe_(r.source),
    source_match_id: safe_(r.source_match_id),
    competition_id: safe_(r.competition_id),
    competition_name: safe_(r.competition_name),
    season: toNumberOrNull_(r.season),
    stage: safe_(r.stage),
    group_name: safe_(r.group_name),
    matchday: safe_(r.matchday),
    date_utc: toIsoOrNull_(r.date_utc),
    date_chile: safe_(r.date_chile),
    status: safe_(r.status),
    home_team_id: safe_(r.home_team_id),
    home_team_name: safe_(r.home_team_name),
    away_team_id: safe_(r.away_team_id),
    away_team_name: safe_(r.away_team_name),
    home_score: toNumberOrNull_(r.home_score),
    away_score: toNumberOrNull_(r.away_score),
    winner: safe_(r.winner),
    venue_name: safe_(r.venue_name),
    venue_city: safe_(r.venue_city),
    raw_file_url: safe_(r.raw_file_url),
    loaded_at: toIsoOrNull_(r.loaded_at) || nowIso_(),
    payload: r
  };
}

function supabaseReverseSourceFixture_(r) {
  return Object.assign({}, r.payload || {}, {
    source_fixture_key: r.source_fixture_key,
    source: r.source,
    source_match_id: r.source_match_id,
    loaded_at: r.loaded_at
  });
}

function supabaseMapMatchMapping_(r) {
  const af = safe_(r.fixture_id_api_football || r.fixture_id_af);
  const fd = safe_(r.match_id_football_data || r.fixture_id_fd);
  if (af) {
    return {
      match_id: safe_(r.match_key) || buildCanonicalMatchId_(r.date_utc, r.home_normalized, r.away_normalized),
      source: 'api_football',
      source_match_id: af,
      confidence: toNumberOrNull_(r.confidence),
      mapping_method: safe_(r.mapping_method),
      payload: r,
      updated_at: toIsoOrNull_(r.updated_at) || nowIso_()
    };
  }
  if (fd) {
    return {
      match_id: safe_(r.match_key) || buildCanonicalMatchId_(r.date_utc, r.home_normalized, r.away_normalized),
      source: 'football_data',
      source_match_id: fd,
      confidence: toNumberOrNull_(r.confidence),
      mapping_method: safe_(r.mapping_method),
      payload: r,
      updated_at: toIsoOrNull_(r.updated_at) || nowIso_()
    };
  }
  return null;
}

function supabaseReverseMatchMapping_(r) {
  return Object.assign({}, r.payload || {}, {
    match_key: r.match_id,
    source: r.source,
    source_match_id: r.source_match_id,
    confidence: r.confidence,
    mapping_method: r.mapping_method,
    updated_at: r.updated_at
  });
}

function supabaseMapWeather_(r) {
  const key = safe_(r.weather_key) || hash_([r.fixture_id, r.venue_id, r.estadio, r.updated_at].join('|'));
  return {
    weather_key: key,
    match_id: safe_(r.fixture_id),
    venue_id: safe_(r.venue_id),
    venue_name: safe_(r.estadio),
    city: safe_(r.ciudad),
    country: safe_(r.pais),
    lat_lon: safe_(r.latitud_longitud),
    temperature_c: toNumberOrNull_(r.temperatura_c),
    humidity: toNumberOrNull_(r.humedad),
    wind_kmh: toNumberOrNull_(r.viento_kmh),
    rain_probability: toNumberOrNull_(r.prob_lluvia),
    condition: safe_(r.condicion),
    source: safe_(r.fuente),
    updated_at: toIsoOrNull_(r.updated_at) || nowIso_(),
    payload: r
  };
}

function supabaseReverseWeather_(r) {
  return {
    venue_id: r.venue_id,
    estadio: r.venue_name,
    ciudad: r.city,
    pais: r.country,
    latitud_longitud: r.lat_lon,
    temperatura_c: r.temperature_c,
    humedad: r.humidity,
    viento_kmh: r.wind_kmh,
    prob_lluvia: r.rain_probability,
    condicion: r.condition,
    updated_at: r.updated_at,
    fuente: r.source,
    fixture_id: r.match_id
  };
}

function supabaseMapNews_(r) {
  return {
    id_hash: safe_(r.id_hash) || hash_(JSON.stringify(r)),
    published_at: toIsoOrNull_(r.pubDate),
    updated_at: toIsoOrNull_(r.updated_at) || nowIso_(),
    source_match_id: safe_(r.source_match_id),
    query: safe_(r.query),
    title: safe_(r.titulo),
    type: safe_(r.tipo),
    status: safe_(r.status),
    url: safe_(r.url),
    source: safe_(r.fuente),
    match_id: safe_(r.fixture_id),
    home_team_name: safe_(r.equipo_local),
    away_team_name: safe_(r.equipo_visitante),
    payload: r
  };
}

function supabaseReverseNews_(r) {
  return {
    id_hash: r.id_hash,
    pubDate: r.published_at,
    updated_at: r.updated_at,
    source_match_id: r.source_match_id,
    query: r.query,
    titulo: r.title,
    tipo: r.type,
    status: r.status,
    url: r.url,
    fuente: r.source,
    fixture_id: r.match_id,
    equipo_local: r.home_team_name,
    equipo_visitante: r.away_team_name
  };
}

function splitFlags_(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value.map(String).filter(Boolean);
  return String(value).split(/[|,;·]/).map(function(s) { return s.trim(); }).filter(Boolean);
}
