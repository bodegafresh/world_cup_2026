const API_FOOTBALL_MAX_RETRIES = 4;
const API_FOOTBALL_RETRY_BASE_MS = 15000;

function apiFootballGet_(path, params) {
  const query = Object.keys(params || {})
    .filter(k => params[k] !== undefined && params[k] !== null && params[k] !== '')
    .map(k => `${encodeURIComponent(k)}=${encodeURIComponent(params[k])}`)
    .join('&');

  const url = `${CONFIG.API_FOOTBALL.BASE_URL}${path}${query ? '?' + query : ''}`;

  for (let attempt = 1; attempt <= API_FOOTBALL_MAX_RETRIES; attempt++) {
    const response = UrlFetchApp.fetch(url, {
      method: 'get',
      headers: { 'x-apisports-key': getApiFootballKey_() },
      muteHttpExceptions: true
    });

    const status = response.getResponseCode();
    const text   = response.getContentText();

    if (status === 200) return JSON.parse(text);

    if (status === 429) {
      const waitMs = API_FOOTBALL_RETRY_BASE_MS * attempt;
      Logger.log(`API-Football 429 rate limit (intento ${attempt}/${API_FOOTBALL_MAX_RETRIES}). Esperando ${waitMs / 1000}s...`);
      Utilities.sleep(waitMs);
      continue;
    }

    throw new Error(`API-Football error ${status}: ${text}`);
  }

  throw new Error(`API-Football: superado el límite de reintentos (${API_FOOTBALL_MAX_RETRIES}) por rate limit 429`);
}

function fetchFixturesByDate_(date) {
  return apiFootballGet_('/fixtures', { date });
}

function fetchWorldCupFixturesByDate_(date) {
  const data = fetchFixturesByDate_(date);

  const filtered = (data.response || []).filter(isWorldCupFixture_);
  data.response = filtered;
  data.results = filtered.length;

  return data;
}

function fetchEventsByFixture_(fixtureId) {
  return apiFootballGet_('/fixtures/events', { fixture: fixtureId });
}

function fetchStatisticsByFixture_(fixtureId) {
  return apiFootballGet_('/fixtures/statistics', { fixture: fixtureId });
}

function fetchLineupsByFixture_(fixtureId) {
  return apiFootballGet_('/fixtures/lineups', { fixture: fixtureId });
}

function isWorldCupFixture_(fixture) {
  return fixture &&
    fixture.league &&
    Number(fixture.league.id) === CONFIG.API_FOOTBALL.WORLD_CUP_LEAGUE_ID &&
    fixture.league.name === 'World Cup' &&
    fixture.league.country === 'World' &&
    Number(fixture.league.season) === CONFIG.API_FOOTBALL.SEASON;
}

function fetchSquadByTeam_(teamId) {
  return apiFootballGet_('/players/squads', {
    team: teamId
  });
}

function fetchPlayerStatsByFixture_(fixtureId) {
  return apiFootballGet_('/fixtures/players', { fixture: fixtureId });
}

function fetchTopScorers_() {
  return apiFootballGet_('/players/topscorers', {
    league: CONFIG.API_FOOTBALL.WORLD_CUP_LEAGUE_ID,
    season: CONFIG.API_FOOTBALL.SEASON
  });
}

/**
 * Trae TODOS los partidos del Mundial 2026 en una sola llamada a la API.
 * Útil para pre-cargar el calendario completo sin iterar por fecha.
 * Consume 1 request de cuota.
 */
function fetchAllWorldCupFixtures_() {
  const data = apiFootballGet_('/fixtures', {
    league: CONFIG.API_FOOTBALL.WORLD_CUP_LEAGUE_ID,
    season: CONFIG.API_FOOTBALL.SEASON
  });
  return data;
}

