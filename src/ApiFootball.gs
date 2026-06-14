function apiFootballGet_(path, params) {
  const query = Object.keys(params || {})
    .map(k => `${encodeURIComponent(k)}=${encodeURIComponent(params[k])}`)
    .join('&');

  const url = `${CONFIG.API_FOOTBALL.BASE_URL}${path}${query ? '?' + query : ''}`;

  const response = UrlFetchApp.fetch(url, {
    method: 'get',
    headers: {
      'x-apisports-key': getApiFootballKey_()
    },
    muteHttpExceptions: true
  });

  const status = response.getResponseCode();
  const text = response.getContentText();

  if (status < 200 || status >= 300) {
    throw new Error(`API-Football error ${status}: ${text}`);
  }

  return JSON.parse(text);
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