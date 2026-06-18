/**
 * FootballDataOrg.gs
 *
 * Integración con football-data.org v4 (plan TIER_ONE gratuito).
 * Aporta datos únicos: árbitros con nombre + nacionalidad por partido.
 * Endpoint usado: GET /v4/matches?dateFrom=...&dateTo=...
 * Límite plan free: 10 req/min. Sin restricción de temporada para WC.
 */

/**
 * Obtiene partidos del Mundial para un rango de fechas desde football-data.org.
 * @param {string} date - 'yyyy-MM-dd'
 * @returns {Array} array de match objects con referees incluidos
 */
function fetchFDWorldCupMatchesByDate_(date) {
  const dateTo = addDaysToDateString_(date, 1);
  const query  = `dateFrom=${date}&dateTo=${dateTo}`;
  const url    = `${CONFIG.FOOTBALL_DATA.BASE_URL}/matches?${query}`;

  const response = UrlFetchApp.fetch(url, {
    method: 'get',
    headers: { 'X-Auth-Token': getFootballDataKey_() },
    muteHttpExceptions: true
  });

  const status = response.getResponseCode();
  if (status === 429) { Logger.log('football-data.org 429 rate limit'); return []; }
  if (status !== 200) {
    Logger.log(`football-data.org error ${status}: ${response.getContentText().substring(0, 200)}`);
    return [];
  }

  const data = JSON.parse(response.getContentText());
  return (data.matches || []).filter(m =>
    m.competition && m.competition.code === CONFIG.FOOTBALL_DATA.WORLD_CUP_CODE &&
    String(m.utcDate || '').substring(0, 10) === date
  );
}

/**
 * Obtiene todos los partidos del Mundial en un rango de fechas (una sola llamada).
 * Útil para backfill — football-data.org devuelve toda la ventana sin restricción.
 * @param {string} dateFrom - 'yyyy-MM-dd'
 * @param {string} dateTo   - 'yyyy-MM-dd'
 * @returns {Array} array de match objects con referees
 */
function fetchFDWorldCupMatchesByRange_(dateFrom, dateTo) {
  const query = `dateFrom=${dateFrom}&dateTo=${dateTo}`;
  const url   = `${CONFIG.FOOTBALL_DATA.BASE_URL}/matches?${query}`;

  const response = UrlFetchApp.fetch(url, {
    method: 'get',
    headers: { 'X-Auth-Token': getFootballDataKey_() },
    muteHttpExceptions: true
  });

  const status = response.getResponseCode();
  if (status === 429) { Logger.log('football-data.org 429 rate limit'); return []; }
  if (status !== 200) {
    Logger.log(`football-data.org error ${status}: ${response.getContentText().substring(0, 300)}`);
    return [];
  }

  const data = JSON.parse(response.getContentText());
  return (data.matches || []).filter(m =>
    m.competition && m.competition.code === CONFIG.FOOTBALL_DATA.WORLD_CUP_CODE
  );
}

/**
 * Backfill de árbitros para todos los partidos jugados desde el inicio del torneo.
 * Ejecutar una vez manualmente para poblar Arbitros con los árbitros históricos.
 * Una sola llamada a football-data.org cubre toda la ventana.
 */
function backfillRefereesFromFootballData() {
  const today     = todayChile_();
  const dateFrom  = '2026-06-11'; // primer partido del torneo (México vs ?)
  Logger.log(`=== BACKFILL ÁRBITROS FD: ${dateFrom} → ${today} ===`);

  const matches = fetchFDWorldCupMatchesByRange_(dateFrom, today);
  const finished = matches.filter(m => m.status === 'FINISHED');
  Logger.log(`  Partidos FT recibidos: ${finished.length}`);

  // Agrupar por fecha y guardar
  const byDate = {};
  finished.forEach(m => {
    const date = String(m.utcDate || '').substring(0, 10);
    if (!byDate[date]) byDate[date] = [];
    byDate[date].push(m);
  });

  Object.entries(byDate).forEach(([date, dayMatches]) => {
    Logger.log(`  ${date}: ${dayMatches.length} partido(s)`);
    saveRefereesFromFootballData_(dayMatches, date);
  });

  Logger.log('=== FIN BACKFILL ÁRBITROS ===');
}

// ── Legado (mantenido por compatibilidad con GoldenDataset.gs) ─────────────

function footballDataGet_(path, params) {
  const query = Object.keys(params || {})
    .filter(k => params[k] !== undefined && params[k] !== null && params[k] !== '')
    .map(k => `${encodeURIComponent(k)}=${encodeURIComponent(params[k])}`)
    .join('&');

  const url = `${CONFIG.FOOTBALL_DATA.BASE_URL}${path}${query ? '?' + query : ''}`;

  const response = UrlFetchApp.fetch(url, {
    method: 'get',
    headers: {
      'X-Auth-Token': getFootballDataKey_()
    },
    muteHttpExceptions: true
  });

  const status = response.getResponseCode();
  const text = response.getContentText();

  if (status < 200 || status >= 300) {
    throw new Error(`football-data.org error ${status}: ${text}`);
  }

  return JSON.parse(text);
}

function fetchFootballDataMatch_(matchId) {
  console.warn('FootballDataOrg DEPRECATED:', 'fetchFootballDataMatch_');
  return footballDataGet_(`/matches/${matchId}`, {});
}

function fetchFootballDataWorldCupMatches_() {
  console.warn('FootballDataOrg DEPRECATED:', 'fetchFootballDataWorldCupMatches_');
  return footballDataGet_(`/competitions/${CONFIG.FOOTBALL_DATA.WORLD_CUP_CODE}/matches`, {
    season: CONFIG.FOOTBALL_DATA.SEASON
  });
}

function fetchFootballDataMatchesByDate_(dateFrom, dateTo) {
  console.warn('FootballDataOrg DEPRECATED:', 'fetchFootballDataMatchesByDate_');
  const data = footballDataGet_('/matches', {
    dateFrom: dateFrom,
    dateTo: dateTo
  });

  const matches = (data.matches || []).filter(match => {
    return match.competition &&
      match.competition.code === CONFIG.FOOTBALL_DATA.WORLD_CUP_CODE;
  });

  data.matches = matches;

  if (data.resultSet) {
    data.resultSet.count = matches.length;
    data.resultSet.competitions = CONFIG.FOOTBALL_DATA.WORLD_CUP_CODE;
  }

  return data;
}

/**
 * Intenta obtener partidos por ventana de fecha. Si no hay resultados
 * (plan gratuito de football-data.org tiene límite de ventana ±10 días),
 * cae a IDs manuales de fallback si están definidos para esa fecha.
 */
function fetchFootballDataMatchesByDateWithFallback_(date) {
  console.warn('FootballDataOrg DEPRECATED:', 'fetchFootballDataMatchesByDateWithFallback_');
  const dateTo = addDaysToDateString_(date, 1);

  const data = fetchFootballDataMatchesByDate_(date, dateTo);

  const matchesForDate = (data.matches || []).filter(match => {
    return String(match.utcDate || '').substring(0, 10) === date;
  });

  data.matches = matchesForDate;

  if (data.resultSet) {
    data.resultSet.count = matchesForDate.length;
  }

  if (data.matches.length > 0) {
    data.source_status = 'OK_BY_DATE_WINDOW';
    return data;
  }

  const fallbackIds = getFootballDataFallbackMatchIdsByDate_(date);

  if (!fallbackIds.length) {
    data.source_status = 'EMPTY_BY_DATE_OR_FREE_PLAN_WINDOW';
    return data;
  }

  const matches = fallbackIds.map(id => fetchFootballDataMatch_(id));

  return {
    filters: {
      dateFrom: date,
      dateTo: dateTo,
      competitions: CONFIG.FOOTBALL_DATA.WORLD_CUP_CODE,
      fallback: true
    },
    resultSet: { count: matches.length },
    matches: matches,
    source_status: 'OK_BY_MANUAL_FALLBACK_IDS'
  };
}

/**
 * IDs manuales de football-data.org para fechas donde la API no devuelve
 * resultados por limitaciones del plan gratuito.
 */
function getFootballDataFallbackMatchIdsByDate_(date) {
  console.warn('FootballDataOrg DEPRECATED:', 'getFootballDataFallbackMatchIdsByDate_');
  const fallback = {
    '2026-06-12': [537328]
  };

  return fallback[date] || [];
}
