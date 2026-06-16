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

/**
 * CRON 07:30 AM — Recolecta datos de los partidos de mañana (clima, noticias,
 * cuotas, H2H). NO llama a OpenAI. Todo queda en caché (sheets).
 */
function cronTomorrowPreview() {
  runWithHealthCheck_('cronTomorrowPreview', () => {
    const date = tomorrowChile_();

    const fixturesData = fetchWorldCupFixturesByDate_(date);
    const fixtures = fixturesData.response || [];

    saveRawJson_(`fixtures/${date}`, `tomorrow-fixtures-${date}.json`, fixturesData);
    saveFixtures_(fixtures, `fixtures/${date}/tomorrow-fixtures-${date}.json`);

    fixtures.forEach(fixture => {
      gatherFixtureContext_(fixture);
      Utilities.sleep(1000);
    });

    try { runSmartAlertsForTomorrow_(); } catch (e) { console.warn('SmartAlerts:', e.message); }
    try { refreshDashboard(); }           catch (e) { console.warn('Dashboard:', e.message); }
  });
}

/**
 * CRON cada 2h durante el día — Llama a OpenAI solo para los partidos
 * próximos (entre 30 min y 4 horas) que aún no tienen análisis guardado.
 */
function cronMatchDayAnalysis() {
  runWithHealthCheck_('cronMatchDayAnalysis', () => {
    const date = todayChile_();
    const fixturesData = fetchWorldCupFixturesByDate_(date);
    const fixtures = fixturesData.response || [];
    const now = new Date();

    fixtures.forEach(fixture => {
      const kickoff = new Date(fixture.fixture.date);
      const minutesUntilKickoff = (kickoff - now) / 60000;

      if (minutesUntilKickoff < 30 || minutesUntilKickoff > 240) return;

      analyzeAndSaveFixture_(fixture);
      Utilities.sleep(2000);
    });
  });
}

/**
 * CRON 09:00 AM — Refresca contexto del día y lanza análisis IA para
 * partidos de hoy. Cada paso usa caché; OpenAI solo se llama si no hay análisis.
 */
function cronTodayPreviewRefresh() {
  runWithHealthCheck_('cronTodayPreviewRefresh', () => {
    const date = todayChile_();
    const fixturesData = fetchWorldCupFixturesByDate_(date);
    const fixtures = fixturesData.response || [];

    fixtures.forEach(fixture => { gatherFixtureContext_(fixture); Utilities.sleep(1000); });
    fixtures.forEach(fixture => { analyzeAndSaveFixture_(fixture); Utilities.sleep(2000); });

    try { refreshDashboard(); } catch (e) { console.warn('Dashboard:', e.message); }
  });
}

/**
 * Recolecta clima, noticias, cuotas e H2H para un fixture.
 * Cada fuente chequea su caché antes de llamar a la API externa.
 */
function gatherFixtureContext_(fixture) {
  const fixtureId = fixture.fixture.id;

  const weather = fetchWeatherForFixture_(fixture);
  if (weather.source !== 'cache') saveWeatherForFixture_(fixture, weather);

  const news = fetchNewsForFixture_(fixture);
  if (news.length && news[0].source !== 'cache') saveNewsForFixture_(fixture, news);

  calculateBasicOddsSignals_(fixture);

  try { loadHeadToHeadForFixture_(fixture); }
  catch (e) { console.warn(`H2H fixture ${fixtureId}: ${e.message}`); }
}

/**
 * Llama a OpenAI y guarda el análisis para un fixture.
 * Si ya hay análisis en AnalisisIA, no llama a OpenAI.
 */
function analyzeAndSaveFixture_(fixture) {
  const fixtureId = fixture.fixture.id;

  if (getAiAnalysisFromCache_(fixtureId)) {
    Logger.log(`fixture ${fixtureId}: análisis ya guardado, skip OpenAI`);
    return;
  }

  const weather  = fetchWeatherForFixture_(fixture);
  const news     = fetchNewsForFixture_(fixture);
  const baseOdds = calculateBasicOddsSignals_(fixture);
  const aiInput  = buildAiPreviewInput_(fixture, weather, news, baseOdds);
  const aiResult = analyzeFixtureWithAi_(aiInput);

  saveAiAnalysis_(fixture, aiResult);
}