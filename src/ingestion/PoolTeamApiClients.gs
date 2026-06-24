/**
 * PoolTeamApiClients.gs
 *
 * Clientes de APIs externas. Guardan llamadas RAW via servicios superiores.
 */

function espnFetchWorldCupScoreboard_(date) {
  const ymd = String(date || ptTodayUtcDate_()).substring(0, 10);
  const espnDate = ptYmdToEspnDate_(ymd);
  const url = 'https://site.api.espn.com/apis/site/v2/sports/soccer/' + PT_WC2026.espnLeaguePath + '/scoreboard?dates=' + espnDate;
  return ptHttpGetJson_(url, {}, { retries: 2 });
}

function espnFetchWorldCupEvent_(eventId) {
  const url = 'https://site.api.espn.com/apis/site/v2/sports/soccer/' + PT_WC2026.espnLeaguePath + '/summary?event=' + encodeURIComponent(String(eventId));
  return ptHttpGetJson_(url, {}, { retries: 2 });
}

function espnFetchWorldCupSchedule_(dateFrom, dateTo) {
  const dates = ptDateRange_(dateFrom, dateTo);
  const events = [];
  const calls = [];
  dates.forEach(function(date) {
    const response = espnFetchWorldCupScoreboard_(date);
    calls.push({ date: date, response: response });
    if (response.ok && response.json && response.json.events) {
      response.json.events.forEach(function(event) { events.push(event); });
    }
  });
  return { events: events, calls: calls };
}

function footballDataFetchCompetitionMatches_(competitionCode, season) {
  if (!ptFootballDataEnabled_()) return { ok: false, skipped: true, reason: 'FOOTBALL_DATA_KEY not configured', matches: [] };
  const range = ptWorldCupDateRange_();
  const url = CONFIG.FOOTBALL_DATA.BASE_URL + '/competitions/' + encodeURIComponent(competitionCode || PT_WC2026.footballDataCode) +
    '/matches?season=' + encodeURIComponent(String(season || PT_WC2026.footballDataSeason));
  const response = ptHttpGetJson_(url, { 'X-Auth-Token': ptEnv_('FOOTBALL_DATA_KEY', '') }, { retries: 1 });
  const matches = response.ok && response.json ? (response.json.matches || []) : [];
  return Object.assign({}, response, { matches: matches, date_from: range.from, date_to: range.to });
}

function footballDataFetchStandings_(competitionCode, season) {
  if (!ptFootballDataEnabled_()) return { ok: false, skipped: true, reason: 'FOOTBALL_DATA_KEY not configured', standings: [] };
  const url = CONFIG.FOOTBALL_DATA.BASE_URL + '/competitions/' + encodeURIComponent(competitionCode || PT_WC2026.footballDataCode) +
    '/standings?season=' + encodeURIComponent(String(season || PT_WC2026.footballDataSeason));
  const response = ptHttpGetJson_(url, { 'X-Auth-Token': ptEnv_('FOOTBALL_DATA_KEY', '') }, { retries: 1 });
  return Object.assign({}, response, { standings: response.ok && response.json ? (response.json.standings || []) : [] });
}

function footballDataFetchTeams_(competitionCode, season) {
  if (!ptFootballDataEnabled_()) return { ok: false, skipped: true, reason: 'FOOTBALL_DATA_KEY not configured', teams: [] };
  const url = CONFIG.FOOTBALL_DATA.BASE_URL + '/competitions/' + encodeURIComponent(competitionCode || PT_WC2026.footballDataCode) +
    '/teams?season=' + encodeURIComponent(String(season || PT_WC2026.footballDataSeason));
  const response = ptHttpGetJson_(url, { 'X-Auth-Token': ptEnv_('FOOTBALL_DATA_KEY', '') }, { retries: 1 });
  return Object.assign({}, response, { teams: response.ok && response.json ? (response.json.teams || []) : [] });
}

function oddsApiFetchMatchOdds_(match) {
  return {
    ok: false,
    skipped: true,
    reason: 'Odds API adapter prepared; full odds ingestion is out of scope for this phase.',
    match_id: match && match.match_id
  };
}

