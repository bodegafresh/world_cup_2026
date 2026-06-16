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