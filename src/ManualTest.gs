function manualLoadGoldenMatches_2026_06_12() {
  const result = loadGoldenMatchesByDate_('2026-06-12');
  Logger.log(JSON.stringify(result, null, 2));
}

function manualLoadGoldenMatchesToday() {
  const result = loadGoldenMatchesByDate_(todayChile_());
  Logger.log(JSON.stringify(result, null, 2));
}

function manualLoadGoldenMatchesYesterday() {
  const result = loadGoldenMatchesByDate_(yesterdayChile_());
  Logger.log(JSON.stringify(result, null, 2));
}

function manualLoadGoldenMatchesTomorrow() {
  const result = loadGoldenMatchesByDate_(tomorrowChile_());
  Logger.log(JSON.stringify(result, null, 2));
}

function manualTestApiFootballFixtureEvents() {
  const fixtureId = 1538999;
  const homeTeamId = 17;
  const awayTeamId = 770;

  const eventsData = fetchEventsByFixture_(fixtureId);

  const rawUrl = saveRawJson_(
    'manual/events',
    `api-football-events-${fixtureId}.json`,
    eventsData
  );

  saveEvents_(fixtureId, eventsData.response || [], rawUrl, homeTeamId, awayTeamId);

  Logger.log(`Eventos guardados fixture ${fixtureId}: ${eventsData.results}`);
  Logger.log(`Raw URL: ${rawUrl}`);
}

function manualTestFootballDataMatch() {
  const matchId = 537328;

  const matchData = fetchFootballDataMatch_(matchId);

  const rawUrl = saveRawJson_(
    'manual/football-data',
    `football-data-match-${matchId}.json`,
    matchData
  );

  Logger.log(JSON.stringify(matchData, null, 2));
  Logger.log(`Raw URL: ${rawUrl}`);
}

function manualDebugProperties() {
  Logger.log('SPREADSHEET_ID: ' + getSpreadsheetId_());
  Logger.log('RAW_FOLDER_ID: ' + getRawFolderId_());
  Logger.log('API_FOOTBALL_KEY exists: ' + Boolean(getApiFootballKey_()));
  Logger.log('FOOTBALL_DATA_KEY exists: ' + Boolean(getFootballDataKey_()));
}

function manualLoadGoldenMatches_2026_06_13() {
  const result = loadGoldenMatchesByDate_('2026-06-13');
  Logger.log(JSON.stringify(result, null, 2));
}

function manualLoadGoldenMatches_2026_06_14() {
  const result = loadGoldenMatchesByDate_('2026-06-14');
  Logger.log(JSON.stringify(result, null, 2));
}

function manualTestFootballDataRange_2026_06_13_14() {
  const data = fetchFootballDataMatchesByDate_('2026-06-13', '2026-06-14');

  Logger.log('football-data matches WC: ' + ((data.matches || []).length));
  Logger.log(JSON.stringify(data, null, 2));
}

function manualClearPipelineTables() {
  clearDataKeepHeader_(CONFIG.SHEETS.SOURCE_FIXTURES);
  clearDataKeepHeader_(CONFIG.SHEETS.MATCH_MAPPING);
  clearDataKeepHeader_(CONFIG.SHEETS.DATA_QUALITY_LOG);

  Logger.log('Tablas pipeline limpiadas: SourceFixtures, MatchMapping, DataQualityLog');
}