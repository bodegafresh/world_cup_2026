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

function manualEnrichGoldenMatches_2026_06_13() {
  const result = enrichGoldenMatchesByDate_('2026-06-13');
  Logger.log(JSON.stringify(result, null, 2));
}

function manualEnrichGoldenMatches_2026_06_12() {
  const result = enrichGoldenMatchesByDate_('2026-06-12');
  Logger.log(JSON.stringify(result, null, 2));
}

function manualDebugPartidosDates() {
  const rows = readAll_(CONFIG.SHEETS.PARTIDOS);

  rows.forEach(row => {
    Logger.log(JSON.stringify({
      match_key: row.match_key,
      local: row.local,
      visitante: row.visitante,
      fecha: row.fecha,
      fecha_chile: row.fecha_chile,
      fecha_chile_type: Object.prototype.toString.call(row.fecha_chile),
      fecha_chile_norm: normalizeSheetDateToYyyyMmDd_(row.fecha_chile),
      fixture_id_api_football: row.fixture_id_api_football
    }, null, 2));
  });
}

function manualRefreshGoldenMatches_2026_06_13() {
  const result = loadGoldenMatchesByDate_('2026-06-13');
  Logger.log(JSON.stringify(result, null, 2));
}

function manualRefreshGoldenMatches_2026_06_12() {
  const result = loadGoldenMatchesByDate_('2026-06-12');
  Logger.log(JSON.stringify(result, null, 2));
}

function manualRefreshAndEnrich_2026_06_13() {
  const goldenResult = loadGoldenMatchesByDate_('2026-06-13');
  Logger.log('Golden result: ' + JSON.stringify(goldenResult, null, 2));

  const enrich12 = enrichGoldenMatchesByDate_('2026-06-12');
  Logger.log('Enrich 2026-06-12: ' + JSON.stringify(enrich12, null, 2));

  const enrich13 = enrichGoldenMatchesByDate_('2026-06-13');
  Logger.log('Enrich 2026-06-13: ' + JSON.stringify(enrich13, null, 2));
}

function manualLoadTeamsFromCurrentData() {
  const result = loadTeamsFromCurrentData_();
  Logger.log(JSON.stringify(result, null, 2));
}

function manualLoadSquadsForCurrentTeams() {
  const result = loadSquadsForKnownTeams_();
  Logger.log(JSON.stringify(result, null, 2));
}

function manualLoadTeamAndSquadsFromCurrentData() {
  const teamsResult = loadTeamsFromCurrentData_();
  Logger.log('Teams: ' + JSON.stringify(teamsResult, null, 2));

  const squadsResult = loadSquadsForKnownTeams_();
  Logger.log('Squads: ' + JSON.stringify(squadsResult, null, 2));
}

function manualBackfillWorldCup_2026_06_11_to_2026_06_14() {
  const result = backfillWorldCupRange_('2026-06-11', '2026-06-14', {
    enrichMatches: true,
    loadTeams: true,
    loadSquads: false,
    sleepMs: 1200
  });

  Logger.log(JSON.stringify(result, null, 2));
}

function manualBackfillWorldCup_2026_06_13_to_2026_06_14() {
  const result = backfillWorldCupRange_('2026-06-13', '2026-06-14', {
    enrichMatches: true,
    loadTeams: true,
    loadSquads: false,
    sleepMs: 1200
  });

  Logger.log(JSON.stringify(result, null, 2));
}

function manualBackfillTodayOnly() {
  const today = todayChile_();

  const result = backfillWorldCupRange_(today, today, {
    enrichMatches: true,
    loadTeams: true,
    loadSquads: false,
    sleepMs: 1200
  });

  Logger.log(JSON.stringify(result, null, 2));
}

function manualBackfillWorldCup_2026_06_11_to_2026_06_14() {
  const result = backfillWorldCupRange_('2026-06-11', '2026-06-14', {
    enrichMatches: true,
    loadTeams: true,
    loadSquads: false,
    sleepMs: 1200
  });

  Logger.log(JSON.stringify(result, null, 2));
}

function manualBackfillWorldCup_2026_06_13_to_2026_06_14() {
  const result = backfillWorldCupRange_('2026-06-13', '2026-06-14', {
    enrichMatches: true,
    loadTeams: true,
    loadSquads: false,
    sleepMs: 1200
  });

  Logger.log(JSON.stringify(result, null, 2));
}

function manualBackfillTodayOnly() {
  const today = todayChile_();

  const result = backfillWorldCupRange_(today, today, {
    enrichMatches: true,
    loadTeams: true,
    loadSquads: false,
    sleepMs: 1200
  });

  Logger.log(JSON.stringify(result, null, 2));
}

function manualValidateGoldenDatasetTest() {
  const result = validateGoldenDataset_();
  Logger.log(JSON.stringify(result, null, 2));
}

function manualBackfillYesterdayTodayTomorrow() {
  const yesterday = yesterdayChile_();
  const today = todayChile_();
  const tomorrow = tomorrowChile_();

  const result = backfillWorldCupRange_(yesterday, tomorrow, {
    enrichMatches: true,
    loadTeams: true,
    loadSquads: false,
    sleepMs: 1200
  });

  Logger.log(JSON.stringify(result, null, 2));
}