function cronDailyLoadTodayStats() {
  runWithHealthCheck_('cronDailyLoadTodayStats', () => {
    const date = todayChile_();
    loadWorldCupDay_(date);
  });
}

function loadWorldCupDay_(date) {
  const fixturesData = fetchWorldCupFixturesByDate_(date);
  const rawUrl = saveRawJson_(`fixtures/${date}`, `worldcup-fixtures-${date}.json`, fixturesData);

  const fixtures = fixturesData.response || [];

  saveFixtures_(fixtures, rawUrl);

  fixtures.forEach(fixture => {
    const fixtureId = fixture.fixture.id;

    const eventsData = fetchEventsByFixture_(fixtureId);
    const eventsRawUrl = saveRawJson_(`events/${date}`, `events-${fixtureId}.json`, eventsData);
    saveEvents_(fixtureId, eventsData.response || [], eventsRawUrl);
    savePlayerSummaryFromEvents_(fixtureId, fixture, eventsData.response || []);

    try {
      const statsData = fetchStatisticsByFixture_(fixtureId);
      saveRawJson_(`statistics/${date}`, `statistics-${fixtureId}.json`, statsData);
    } catch (e) {
      console.warn(`No se pudo cargar statistics fixture ${fixtureId}: ${e.message}`);
    }

    try {
      loadPlayerStatsForFixture_(fixtureId, fixture);
    } catch (e) {
      console.warn(`PlayerMatchStats error fixture ${fixtureId}: ${e.message}`);
    }

    Utilities.sleep(800);
  });

  try {
    loadWorldCupStandings();
  } catch (e) {
    console.warn('No se pudo actualizar standings:', e.message);
  }
}

function cronTomorrowPreview() {
  runWithHealthCheck_('cronTomorrowPreview', () => {
    const date = tomorrowChile_();

    const fixturesData = fetchWorldCupFixturesByDate_(date);
    const fixtures = fixturesData.response || [];

    saveRawJson_(`fixtures/${date}`, `tomorrow-fixtures-${date}.json`, fixturesData);
    saveFixtures_(fixtures, `fixtures/${date}/tomorrow-fixtures-${date}.json`);

    fixtures.forEach(fixture => {
      enrichTomorrowFixture_(fixture);
      Utilities.sleep(1000);
    });

    try {
      runSmartAlertsForTomorrow_();
    } catch (e) {
      console.warn('SmartAlerts error:', e.message);
    }

    try {
      refreshDashboard();
    } catch (e) {
      console.warn('Dashboard refresh error:', e.message);
    }
  });
}

/**
 * Regenera las previas para los partidos de HOY si ya están en Partidos
 * pero el análisis IA no tiene los datos enriquecidos (suspensiones, grupo, etc.).
 * Ejecutar: 09:00 AM Chile los días con partido.
 */
function cronTodayPreviewRefresh() {
  runWithHealthCheck_('cronTodayPreviewRefresh', () => {
    const date = todayChile_();
    const fixturesData = fetchWorldCupFixturesByDate_(date);
    const fixtures = fixturesData.response || [];

    fixtures.forEach(fixture => {
      enrichTomorrowFixture_(fixture);
      Utilities.sleep(1500);
    });

    try { refreshDashboard(); } catch (e) { console.warn('Dashboard:', e.message); }
  });
}

function enrichTomorrowFixture_(fixture) {
  const fixtureId = fixture.fixture.id;

  const weather = fetchWeatherForFixture_(fixture);
  saveWeatherForFixture_(fixture, weather);

  const news = fetchNewsForFixture_(fixture);
  saveNewsForFixture_(fixture, news);

  const baseOdds = calculateBasicOddsSignals_(fixture);
  saveOddsSignals_(fixture, baseOdds);

  try {
    loadHeadToHeadForFixture_(fixture);
  } catch (e) {
    console.warn(`H2H error fixture ${fixtureId}: ${e.message}`);
  }

  const aiInput = buildAiPreviewInput_(fixture, weather, news, baseOdds);
  const aiResult = analyzeFixtureWithAi_(aiInput);

  saveAiAnalysis_(fixture, aiResult);
}