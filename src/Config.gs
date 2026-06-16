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
    SUSCRIPTORES: 'Suscriptores'
  },

  API_FOOTBALL: {
    BASE_URL: 'https://v3.football.api-sports.io',
    WORLD_CUP_LEAGUE_ID: 1,
    SEASON: 2026
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
    MARKETS: 'h2h,totals,btts',
    ODDS_FORMAT: 'decimal'
  },

  OPENAI: {
    BASE_URL: 'https://api.openai.com/v1/responses',
    MODEL: 'gpt-4.1-mini'
  },

  TELEGRAM: {
    BASE_URL: 'https://api.telegram.org/bot'
  },

  TIMEZONE: 'America/Santiago'
};

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
 * Registra el webhook de Telegram apuntando a este Web App.
 * Ejecutar UNA VEZ después de cada nueva implementación.
 * drop_pending_updates: true limpia mensajes acumulados mientras el webhook no estaba activo.
 */
function setupTelegramWebhook() {
  const token  = getTelegramBotToken_();
  const webUrl = normalizeWebAppUrl_(getWebAppUrl_());

  Logger.log(`Registrando webhook en: ${webUrl}`);

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