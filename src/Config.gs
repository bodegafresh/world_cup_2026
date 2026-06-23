const CONFIG = {
  SHEETS: {
    README: 'README',
    PARTIDOS: 'Partidos',
    EQUIPOS: 'Equipos',
    JUGADORES: 'Jugadores',
    PLANTELES: 'Planteles',
    PLAYER_MATCH_STATS: 'PlayerMatchStats',

    EVENTOS_LIVE: 'EventosLive',
    RESUMEN_JUGADOR_PARTIDO: 'ResumenJugadorPartido',
    ODDS: 'OddsApuestas',
    ESTADIOS_CLIMA: 'EstadiosClima',
    NOTICIAS: 'Noticias',

    RAW_LOG: 'RawLog',
    AI_ANALYSIS: 'AnalisisIA',
    ALERTAS: 'Alertas',
    MORNING_REPORTS: 'ReportesTelegram',

    SOURCE_FIXTURES: 'SourceFixtures',
    MATCH_MAPPING: 'MatchMapping',
    DATA_QUALITY_LOG: 'DataQualityLog',
    PIPELINE_RUNS: 'PipelineRuns',

    CLASIFICACION: 'Clasificacion',
    HISTORIAL_H2H: 'HistorialH2H',
    SUSCRIPTORES: 'Suscriptores',
    ALINEACIONES: 'Alineaciones',
    ARBITROS: 'Arbitros',

    ELO_RATINGS:      'EloRatings',
    EV_OPPORTUNITIES: 'EvOpportunities',
    BETTING_HISTORY:  'BettingHistory',
    MODEL_CALIBRATION:'ModelCalibration',
    SIM_GRUPOS:       'SimulacionGrupos',
    ESPN_STATS:       'EspnStats',
    FORMA_EQUIPOS:    'FormaEquipos',
    SOFA_STATS:       'SofaStats',
    POISSON_ODDS:     'PoissonOdds',
    BETFAIR_ODDS:     'BetfairOdds',
    GOAL_SCORER_ODDS: 'GoalScorerOdds',
    CORNERS_ODDS:     'CornersOdds',
    CARDS_ODDS:       'CardsOdds',
    EV_HISTORICO:     'EvHistorico',
    NORMALIZATION_AUDIT: 'NormalizationAudit'
  },

  API_FOOTBALL: {
    BASE_URL: 'https://v3.football.api-sports.io',
    WORLD_CUP_LEAGUE_ID: 1,
    SEASON: 2026
  },

  LEAGUES: {
    // Liga activa (se sobreescribe en runtime con setActiveLeague_)
    ACTIVE: 'WC2026',

    // Catálogo de ligas soportadas
    CATALOG: {
      WC2026:       { id: 1,   season: 2026, competition_season_id: 'WC2026',            competition_id: 'FIFA_WORLD_CUP',          name: 'Mundial FIFA 2026',          sport_key: 'soccer_fifa_world_cup',             country: 'World',     region: 'Global',        type: 'cup',    tier: 1, home_adv: 1.0,  target_status: 'BETTABLE',      liquidity_tier: 'MEDIUM' },
      CHAMPIONS:    { id: 2,   season: 2025, competition_season_id: 'UCL_2025',          competition_id: 'UEFA_CHAMPIONS_LEAGUE',   name: 'UEFA Champions League',      sport_key: 'soccer_uefa_champs_league',         country: 'Europe',    region: 'Europe',        type: 'cup',    tier: 1, home_adv: 1.10, target_status: 'PAPER_TRADING', liquidity_tier: 'HIGH' },
      PREMIER:      { id: 39,  season: 2025, competition_season_id: 'EPL_2025',          competition_id: 'PREMIER_LEAGUE',          name: 'Premier League',             sport_key: 'soccer_epl',                        country: 'England',   region: 'Europe',        type: 'league', tier: 1, home_adv: 1.15, target_status: 'PAPER_TRADING', liquidity_tier: 'HIGH' },
      LA_LIGA:      { id: 140, season: 2025, competition_season_id: 'LA_LIGA_2025',      competition_id: 'LA_LIGA',                 name: 'La Liga',                    sport_key: 'soccer_spain_la_liga',              country: 'Spain',     region: 'Europe',        type: 'league', tier: 1, home_adv: 1.20, target_status: 'OBSERVATION',   liquidity_tier: 'HIGH' },
      CHAMPIONS_L:  { id: 3,   season: 2025, competition_season_id: 'UEL_2025',          competition_id: 'UEFA_EUROPA_LEAGUE',      name: 'UEFA Europa League',         sport_key: 'soccer_uefa_europa_league',         country: 'Europe',    region: 'Europe',        type: 'cup',    tier: 2, home_adv: 1.10, target_status: 'OBSERVATION',   liquidity_tier: 'MEDIUM' },
      LIGA_MX:      { id: 262, season: 2025, competition_season_id: 'LIGA_MX_2025',      competition_id: 'LIGA_MX',                 name: 'Liga MX',                    sport_key: 'soccer_mexico_ligamx',              country: 'Mexico',    region: 'North America', type: 'league', tier: 1, home_adv: 1.20, target_status: 'OBSERVATION',   liquidity_tier: 'MEDIUM' },
      MLS:          { id: 253, season: 2025, competition_season_id: 'MLS_2025',          competition_id: 'MLS',                     name: 'MLS',                        sport_key: 'soccer_usa_mls',                    country: 'USA',       region: 'North America', type: 'league', tier: 1, home_adv: 1.15, target_status: 'OBSERVATION',   liquidity_tier: 'MEDIUM' },
      LIBERTADORES: { id: 13,  season: 2025, competition_season_id: 'LIBERTADORES_2025', competition_id: 'COPA_LIBERTADORES',       name: 'Copa Libertadores',          sport_key: 'soccer_conmebol_copa_lib',          country: 'S.America', region: 'South America', type: 'cup',    tier: 1, home_adv: 1.25, target_status: 'OBSERVATION',   liquidity_tier: 'MEDIUM' },
      BRASILEIRAO:  { id: 71,  season: 2025, competition_season_id: 'BRASILEIRAO_2025',  competition_id: 'BRASILEIRAO',             name: 'Brasileirão Série A',        sport_key: 'soccer_brazil_campeonato',          country: 'Brazil',    region: 'South America', type: 'league', tier: 1, home_adv: 1.15, target_status: 'OBSERVATION',   liquidity_tier: 'MEDIUM' },
      ARG_PRIMERA:  { id: 128, season: 2025, competition_season_id: 'ARG_PRIMERA_2025',  competition_id: 'ARGENTINA_PRIMERA',       name: 'Argentina Primera División', sport_key: 'soccer_argentina_primera_division', country: 'Argentina', region: 'South America', type: 'league', tier: 1, home_adv: 1.15, target_status: 'OBSERVATION',   liquidity_tier: 'LOW' },
      CHI_PRIMERA:  { id: 265, season: 2025, competition_season_id: 'CHI_PRIMERA_2025',  competition_id: 'CHILE_PRIMERA',           name: 'Chile Primera División',     sport_key: 'soccer_chile_campeonato',           country: 'Chile',     region: 'South America', type: 'league', tier: 1, home_adv: 1.10, target_status: 'OBSERVATION',   liquidity_tier: 'LOW' }
    }
  },

  FOOTBALL_DATA: {
    BASE_URL: 'https://api.football-data.org/v4',
    WORLD_CUP_CODE: 'WC',
    SEASON: 2026
  },

  THE_ODDS_API: {
    BASE_URL: 'https://api.the-odds-api.com/v4',
    SPORT_KEY: 'soccer_fifa_world_cup',
    REGIONS: 'us,uk,eu',
    MARKETS: 'h2h,totals,btts,spreads',
    ODDS_FORMAT: 'decimal',
    PINNACLE_BOOKMAKER: 'pinnacle'
  },

  BETTING: {
    EV_POSITIVE_THRESHOLD: 0.05,
    EDGE_MIN_THRESHOLD: 0.03,
    KELLY_MAX_FRACTION: 0.025,
    KELLY_DIVISOR: 4,
    EV_SUSPICIOUS_THRESHOLD: 0.25,
    EV_OUTLIER_THRESHOLD: 0.30,
    EV_MAX_CREDIBLE: 0.50,
    PROB_SUM_TOLERANCE: 0.05
  },

  OPENAI: {
    BASE_URL: 'https://api.openai.com/v1/responses',
    MODEL: 'gpt-4.1-mini'
  },

  SUPABASE: {
    REST_PATH: '/rest/v1',
    DEFAULT_BATCH_SIZE: 200,
    MAX_BATCH_SIZE: 500,
    PRIMARY_READ_PROP: 'SUPABASE_PRIMARY_READ',
    PRIMARY_WRITE_PROP: 'SUPABASE_PRIMARY_WRITE',
    DUAL_WRITE_PROP: 'SUPABASE_DUAL_WRITE',
    MIGRATION_BATCH_SIZE_PROP: 'SUPABASE_MIGRATION_BATCH_SIZE',
    SUPPORTED_SHEETS: [
      'Partidos',
      'Equipos',
      'Jugadores',
      'Clasificacion',
      'PlayerMatchStats',
      'ResumenJugadorPartido',
      'OddsApuestas',
      'PoissonOdds',
      'AnalisisIA',
      'EvOpportunities',
      'EvHistorico',
      'BettingHistory',
      'ModelCalibration',
      'SimulacionGrupos',
      'EloRatings',
      'PipelineRuns',
      'DataQualityLog',
      'SourceFixtures',
      'MatchMapping',
      'EstadiosClima',
      'Noticias'
    ]
  },

  TELEGRAM: {
    BASE_URL: 'https://api.telegram.org/bot'
  },

  TIMEZONE: 'America/Santiago'
};

/**
 * Cambia la liga activa y persiste en Script Properties.
 * @param {string} leagueKey — clave del catálogo, ej. 'PREMIER', 'LA_LIGA', 'WC2026'
 */
function setActiveLeague_(leagueKey) {
  if (!CONFIG.LEAGUES.CATALOG[leagueKey]) throw new Error('Liga no encontrada: ' + leagueKey);
  PropertiesService.getScriptProperties().setProperty('ACTIVE_LEAGUE', leagueKey);
  CONFIG.LEAGUES.ACTIVE = leagueKey;
  Logger.log('Liga activa cambiada a: ' + leagueKey);
}

/**
 * Retorna el objeto de la liga activa desde el catálogo.
 * Fallback a WC2026 si no hay ninguna configurada.
 * @returns {{ id, season, name, sport_key, country, type, home_adv }}
 */
function getActiveLeague_() {
  const key = PropertiesService.getScriptProperties().getProperty('ACTIVE_LEAGUE') || 'WC2026';
  return CONFIG.LEAGUES.CATALOG[key] || CONFIG.LEAGUES.CATALOG.WC2026;
}

function getProp_(key) {
  const value = PropertiesService.getScriptProperties().getProperty(key);
  if (!value) throw new Error(`Falta Script Property: ${key}`);
  return value;
}

function getOptionalProp_(key, defaultValue) {
  return PropertiesService.getScriptProperties().getProperty(key) || defaultValue;
}

function getSpreadsheetId_() {
  return getProp_('SPREADSHEET_ID');
}

function getRawFolderId_() {
  return getProp_('RAW_FOLDER_ID');
}

function getApiFootballKey_() {
  return getProp_('API_FOOTBALL_KEY');
}

function getFootballDataKey_() {
  return getProp_('FOOTBALL_DATA_KEY');
}

function getTheOddsApiKey_() {
  return getProp_('THE_ODDS_API_KEY');
}

function getWeatherApiKey_() {
  return getOptionalProp_('WEATHER_API_KEY', '');
}

function getWeatherApiKey2_() {
  return getOptionalProp_('WEATHER_API_KEY_2', '');
}

function getOpenAiKey_() {
  return getProp_('OPENAI_API_KEY');
}

function getTelegramBotToken_() {
  return getProp_('TELEGRAM_BOT_TOKEN');
}

function getTelegramChatId_() {
  return getProp_('TELEGRAM_CHAT_ID');
}

function getWebAppUrl_() {
  return getProp_('URL_WEB_APP');
}

function getSupabaseUrl_() {
  return getProp_('SUPABASE_URL').replace(/\/+$/, '');
}

function getSupabaseServiceRoleKey_() {
  return getProp_('SUPABASE_SERVICE_ROLE_KEY');
}

function getSupabaseAnonKey_() {
  return getOptionalProp_('SUPABASE_ANON_KEY', '');
}

/**
 * Valida y normaliza la URL del Web App:
 * - Fuerza que termine en /exec
 * - Detecta URLs de librería o /dev que causan el error 302
 */
function normalizeWebAppUrl_(url) {
  url = String(url || '').trim();
  if (!url) throw new Error('URL_WEB_APP está vacía en Script Properties');

  if (url.includes('/macros/library/')) {
    throw new Error('URL_WEB_APP apunta a /macros/library/ — debe ser /macros/s/.../exec');
  }
  if (url.includes('/dev')) {
    throw new Error('URL_WEB_APP apunta a /dev — usa la URL /exec de la implementación publicada');
  }

  // Agrega /exec si falta
  if (!/\/exec(\?.*)?$/.test(url)) {
    url = url.replace(/\/$/, '') + '/exec';
  }

  return url;
}

/**
 * Registra el webhook apuntando al Cloudflare Worker (recomendado).
 * El Worker hace redirect:follow hacia GAS y siempre responde 200 a Telegram,
 * evitando el error "302 Moved Temporarily" de Apps Script web apps.
 *
 * Requisito: Script Property 'WORKER_URL' con la URL del Worker de Cloudflare.
 * Ejecutar UNA VEZ después de cada nueva implementación.
 */
function setupWebhookToWorker() {
  const token     = getTelegramBotToken_();
  const workerUrl = PropertiesService.getScriptProperties().getProperty('WORKER_URL');

  if (!workerUrl) {
    Logger.log('❌ Falta Script Property WORKER_URL. Agrégala con la URL del Cloudflare Worker.');
    return;
  }

  Logger.log(`Registrando webhook al Worker: ${workerUrl}`);

  const response = UrlFetchApp.fetch(
    `https://api.telegram.org/bot${token}/setWebhook`,
    {
      method: 'post',
      contentType: 'application/json',
      payload: JSON.stringify({ url: workerUrl, drop_pending_updates: true }),
      muteHttpExceptions: true
    }
  );

  const result = JSON.parse(response.getContentText());
  if (result.ok) {
    Logger.log(`✅ Webhook → Worker: ${workerUrl}`);
    Logger.log('   El Worker hace forward a GAS con redirect:follow.');
  } else {
    Logger.log(`❌ Error: ${result.description}`);
  }
  return result;
}

/**
 * Registra el webhook de Telegram apuntando directamente a este Web App.
 * ADVERTENCIA: puede recibir 302 si Apps Script redirige entre dominios.
 * Usar setupWebhookToWorker() como alternativa estable.
 */
function setupTelegramWebhook() {
  const token  = getTelegramBotToken_();
  const webUrl = normalizeWebAppUrl_(getWebAppUrl_());

  Logger.log(`Registrando webhook directo en: ${webUrl}`);

  const response = UrlFetchApp.fetch(
    `https://api.telegram.org/bot${token}/setWebhook`,
    {
      method: 'post',
      contentType: 'application/json',
      payload: JSON.stringify({ url: webUrl, drop_pending_updates: true }),
      muteHttpExceptions: true
    }
  );

  const result = JSON.parse(response.getContentText());
  if (result.ok) {
    Logger.log(`✅ Webhook registrado: ${webUrl}`);
  } else {
    Logger.log(`❌ Error: ${result.description}`);
  }
  return result;
}

/**
 * Consulta el webhook actualmente registrado en Telegram.
 */
function getTelegramWebhookInfo() {
  const token = getTelegramBotToken_();
  const response = UrlFetchApp.fetch(
    `https://api.telegram.org/bot${token}/getWebhookInfo`,
    { muteHttpExceptions: true }
  );
  const result = JSON.parse(response.getContentText());
  Logger.log(JSON.stringify(result.result, null, 2));
  return result.result;
}

/**
 * Elimina el webhook y limpia la cola de updates pendientes.
 */
function deleteTelegramWebhook() {
  const token = getTelegramBotToken_();
  const response = UrlFetchApp.fetch(
    `https://api.telegram.org/bot${token}/deleteWebhook?drop_pending_updates=true`,
    { method: 'post', muteHttpExceptions: true }
  );
  const result = JSON.parse(response.getContentText());
  Logger.log(result.ok ? '✅ Webhook eliminado' : `❌ Error: ${result.description}`);
  return result;
}
