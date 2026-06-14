const CONFIG = {
  SHEETS: {
    PARTIDOS: 'Partidos',
    EVENTOS_LIVE: 'EventosLive',
    RESUMEN_JUGADOR_PARTIDO: 'ResumenJugadorPartido',
    ESTADIOS_CLIMA: 'EstadiosClima',
    NOTICIAS: 'Noticias',
    ODDS: 'OddsApuestas',
    ALERTAS: 'Alertas',
    RAW_LOG: 'RawLog',
    AI_ANALYSIS: 'AnalisisIA',
    MORNING_REPORTS: 'ReportesTelegram'
  },

  API_FOOTBALL: {
    BASE_URL: 'https://v3.football.api-sports.io',
    WORLD_CUP_LEAGUE_ID: 1,
    SEASON: 2026
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

function getWeatherApiKey_() {
  return getOptionalProp_('WEATHER_API_KEY', '');
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