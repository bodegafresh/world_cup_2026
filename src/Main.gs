// ═══════════════════════════════════════════════════════════════════════════════
// SISTEMA DE CRONS — 4 triggers, lógica inteligente de ejecución
//
// Triggers a configurar en Apps Script → Activadores:
//   cronDailySetup        → Day timer  → 6:00–7:00 AM
//   cronLiveEventsMonitor → Minute timer → cada 5 min
//   cronPostMatch         → Hour timer  → cada hora
//   cronWeeklyMaintenance → Week timer  → Lunes 3:00–4:00 AM
//
// Eliminar: cronDailyLoadTodayStats, cronTomorrowPreview, cronMatchDayAnalysis,
//           cronTodayPreviewRefresh, cronEvCalculation, cronMorningTelegramReport
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Obtiene el contexto del día (partidos hoy, mañana, status del torneo).
 * Se cachea 1 hora en PropertiesService para no repetir la lógica entre crons.
 */
function getContextoDelDia_() {
  const props = PropertiesService.getScriptProperties();
  const cacheKey = 'ctx_' + todayChile_();
  const cached = props.getProperty(cacheKey);
  if (cached) {
    try { return JSON.parse(cached); } catch (e_) {}
  }

  const today    = todayChile_();
  const tomorrow = tomorrowChile_();

  // Usar ESPN (sin cuota) como fuente del calendario
  let partidosHoy = [], partidosMañana = [];
  try {
    partidosHoy    = fetchEspnEventsByDate_(today);
    partidosMañana = fetchEspnEventsByDate_(tomorrow);
  } catch (e) {
    // Fallback a hoja Partidos
    const all = readAll_(CONFIG.SHEETS.PARTIDOS);
    partidosHoy    = all.filter(r => normalizeFecha_(r.fecha) === today);
    partidosMañana = all.filter(r => normalizeFecha_(r.fecha) === tomorrow);
  }

  const hayPartidosHoy    = partidosHoy.length > 0;
  const hayPartidosMañana = partidosMañana.length > 0;

  const ctx = { today, tomorrow, hayPartidosHoy, hayPartidosMañana,
    nHoy: partidosHoy.length, nMañana: partidosMañana.length };

  props.setProperty(cacheKey, JSON.stringify(ctx));
  return ctx;
}

/**
 * CRON 1 — 6:00 AM Chile (Day timer)
 * Prepara TODO el día en un solo cron:
 *   - Carga calendario hoy y mañana desde ESPN (gratis)
 *   - Clima, noticias y H2H para partidos de HOY (fuentes gratuitas)
 *   - Análisis IA para partidos próximos (OpenAI, solo si no hay análisis)
 *   - EV y simulación de grupos
 *   - Reporte matutino por Telegram
 *   - API-Football: estadísticas del día ANTERIOR (consume cuota)
 * Costo: ~5 req API-Football (ayer) + 0 req ESPN + ~3 req OpenAI
 */
function cronDailySetup() {
  runWithHealthCheck_('cronDailySetup', () => {
    const ctx = getContextoDelDia_();
    Logger.log(`cronDailySetup | hoy: ${ctx.nHoy} partidos | mañana: ${ctx.nMañana}`);

    // 1. Actualizar datos del día anterior con API-Football (estadísticas detalladas)
    try { loadWorldCupDay_(yesterdayChile_()); } catch (e) { console.warn('LoadDay ayer:', e.message); }

    // 2. Precargar calendario ESPN de hoy y mañana en Partidos
    try { loadFullWorldCupCalendarFromEspn(); } catch (e) { console.warn('ESPN calendar:', e.message); }

    // 3. Contexto de partidos de hoy (clima, noticias, H2H, cuotas) — fuentes gratuitas
    if (ctx.hayPartidosHoy) {
      const fixturesHoy = readAll_(CONFIG.SHEETS.PARTIDOS)
        .filter(r => normalizeFecha_(r.fecha) === ctx.today && r.fixture_id_af);
      fixturesHoy.forEach(r => {
        const fakeFixture = { fixture: { id: r.fixture_id_af, date: r.fecha } };
        try { gatherFixtureContext_(fakeFixture); } catch (e_) {}
        Utilities.sleep(500);
      });
    }

    // 4. Análisis IA para partidos de hoy (OpenAI, cachea si ya existe)
    if (ctx.hayPartidosHoy) {
      const fixturesHoy = readAll_(CONFIG.SHEETS.PARTIDOS)
        .filter(r => normalizeFecha_(r.fecha) === ctx.today && r.fixture_id_af);
      fixturesHoy.forEach(r => {
        const fakeFixture = { fixture: { id: r.fixture_id_af, date: r.fecha } };
        try { analyzeAndSaveFixture_(fakeFixture); } catch (e_) {}
        Utilities.sleep(1000);
      });
    }

    // 5. Modelo Poisson: recalibrar con partidos FT y precalcular todos los pendientes
    try { recalcularPoissonOdds(); } catch (e) { console.warn('Poisson:', e.message); }
    try { recalcularCornersOdds(); } catch (e) { console.warn('Corners:', e.message); }
    try { recalcularCardsOdds();   } catch (e) { console.warn('Cards:', e.message); }

    // 6. EV y simulación de grupos (Poisson ya disponible → EV usa modelo independiente)
    try { runGroupSimulation(); } catch (e) { console.warn('GroupSim:', e.message); }

    // 7. Recalcular tabla de posiciones
    try { recalcularTablaDesdePartidos(); } catch (e) { console.warn('Tabla:', e.message); }

    // 8. Dashboard y reporte matutino
    try { refreshDashboard(); } catch (e) { console.warn('Dashboard:', e.message); }
    if (ctx.hayPartidosHoy) {
      try { broadcastMorningReport_(); } catch (e) { console.warn('MorningReport:', e.message); }
    }
  });
}

/**
 * CRON 2 — cada 5 minutos (Minute timer) — YA EXISTE, mantener igual
 * Monitorea partidos en vivo con ESPN (sin cuota).
 * Sale rápido si no hay partidos en curso.
 */
// cronLiveEventsMonitor() — definida en LiveEvents.gs, sin cambios

/**
 * CRON 3 — cada hora (Hour timer)
 * Acciones post-partido: enriquecer datos con ESPN cuando termina un partido.
 * Solo actúa si hay partidos que terminaron en la última hora.
 * Costo: 0 req API-Football | gratis ESPN
 */
function cronPostMatch() {
  runWithHealthCheck_('cronPostMatch', () => {
    const now      = new Date();
    const today    = todayChile_();
    const partidos = readAll_(CONFIG.SHEETS.PARTIDOS)
      .filter(r => normalizeFecha_(r.fecha) === today);

    const recienTerminados = partidos.filter(r => {
      if (!['FT','AET','PEN'].includes(String(r.status || '').toUpperCase())) return false;
      // Solo partidos que terminaron hace menos de 90 min
      const hora = normalizeHora_(r.hora_chile || r.hora);
      if (!hora) return false;
      const [hh, mm] = hora.split(':').map(Number);
      const [yy, mo, dd] = today.split('-').map(Number);
      const CHILE_OFFSET = -4 * 60 * 60 * 1000;
      const kickoff = new Date(Date.UTC(yy, mo-1, dd, hh, mm) - CHILE_OFFSET);
      const finEst  = new Date(kickoff.getTime() + 105 * 60 * 1000); // kickoff + 105 min
      const diffMin = (now - finEst) / 60000;
      return diffMin >= 0 && diffMin <= 90;
    });

    if (!recienTerminados.length) return;
    Logger.log(`cronPostMatch: ${recienTerminados.length} partido(s) recién terminados`);

    recienTerminados.forEach(r => {
      // ESPN stats post-partido (goleadores, alineaciones, stats avanzadas)
      const espnId = r.espn_id || r.espn_event_id;
      if (espnId) {
        try {
          const summary = fetchEspnSummary_(espnId);
          // Guardar goleadores en ResumenJugadorPartido si no están
          // Guardar stats en EspnStats
          const fakeFixture = { fixture: { id: r.fixture_id_af || '', date: r.fecha },
            teams: { home: { name: r.local }, away: { name: r.visitante } } };
          try { saveEspnDataForFixture_(fakeFixture, today); } catch (e_) {}
        } catch (e_) { console.warn('PostMatch ESPN:', e_.message); }
      }
      // SofaScore: guardar métricas avanzadas post-partido
      try {
        const fecha = normalizeFecha_(r.fecha);
        saveSofaDataForMatch_(r.local, r.visitante, fecha, r.match_key);
      } catch (e_) { console.warn('PostMatch SofaScore:', e_.message); }

      Utilities.sleep(300);
    });

    // Recalcular tabla después de partidos terminados
    try { recalcularTablaDesdePartidos(); } catch (e) { console.warn('Tabla post:', e.message); }
    try { refreshDashboard(); } catch (e) {}
  });
}

/**
 * CRON 4 — Lunes 3:00 AM (Week timer)
 * Mantenimiento semanal: auditoría de datos, limpieza de duplicados,
 * calibración del modelo, reporte de rendimiento de apuestas.
 * Costo: 0 req API externa
 */
function cronWeeklyMaintenance() {
  runWithHealthCheck_('cronWeeklyMaintenance', () => {
    Logger.log('cronWeeklyMaintenance: inicio');
    try { limpiarDuplicadosPartidos(); }  catch (e) { console.warn('LimpDup:', e.message); }
    try { recalcularTablaDesdePartidos(); } catch (e) { console.warn('Tabla:', e.message); }
    try { calculateModelCalibration_(); }   catch (e) { console.warn('Calib:', e.message); }
    try { cronWeeklyPerformanceReport(); }  catch (e) { console.warn('WeekRep:', e.message); }
    try { refreshDashboard(); }             catch (e) {}
    Logger.log('cronWeeklyMaintenance: fin');
  });
}

// ── Funciones legacy (mantenidas para compatibilidad manual) ──────────────────
function cronDailyLoadTodayStats() {
  throw new Error('DEPRECATED: esta función fue consolidada en cronDailySetup(). Elimina el trigger si existe.');
}

function loadWorldCupDay_(date) {
  const fixturesData = fetchWorldCupFixturesByDate_(date);
  const rawUrl = saveRawJson_(`fixtures/${date}`, `worldcup-fixtures-${date}.json`, fixturesData);

  const fixtures = fixturesData.response || [];

  upsertGoldenMatchesFromFixtures_(fixtures, date, createQuotaTracker_());

  fixtures.forEach(fixture => {
    const fixtureId = fixture.fixture.id;

    const eventsData = fetchEventsByFixture_(fixtureId);
    const eventsRawUrl = saveRawJson_(`events/${date}`, `events-${fixtureId}.json`, eventsData);
    const eventsArr = eventsData.response || [];
    saveEvents_(fixtureId, eventsArr, eventsRawUrl);
    savePlayerSummaryFromEvents_(fixtureId, fixture, eventsArr);
    try { saveRefereeForFixture_(fixture, eventsArr); } catch (e) { console.warn('Referee:', e.message); }

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

    try {
      loadLineupsForFixture_(fixture);
    } catch (e) {
      console.warn(`Lineups error fixture ${fixtureId}: ${e.message}`);
    }

    // Actualizar ELO solo si el partido ya terminó (FT/AET/PEN)
    try { updateEloAfterMatch_(fixture); } catch (e) { console.warn(`ELO fixture ${fixtureId}:`, e.message); }

    // Auto-liquidar apuestas pendientes de este fixture
    try { autoSettleBetsForFixture_(fixture); } catch (e) { console.warn(`AutoSettle fixture ${fixtureId}:`, e.message); }

    // ESPN: stats avanzadas post-partido (pases, tackles, despejes, asistencia)
    try { saveEspnDataForFixture_(fixture, date); } catch (e) { console.warn(`ESPN fixture ${fixtureId}:`, e.message); }

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
  throw new Error('DEPRECATED: esta función fue consolidada en cronDailySetup(). Elimina el trigger si existe.');
}

/**
 * CRON cada 2h durante el día — Llama a OpenAI solo para los partidos
 * próximos (entre 30 min y 4 horas) que aún no tienen análisis guardado.
 */
function cronMatchDayAnalysis() {
  throw new Error('DEPRECATED: esta función fue consolidada en cronDailySetup(). Elimina el trigger si existe.');
}

/**
 * CRON 08:00 AM — Calcula Expected Value para los partidos de mañana.
 * Requiere que cronTomorrowPreview ya haya corrido (cuotas cargadas).
 * Guarda en EvOpportunities y envía alerta Telegram si hay EV+.
 */
function cronEvCalculation() {
  throw new Error('DEPRECATED: esta función fue consolidada en cronDailySetup(). Elimina el trigger si existe.');
}

/**
 * CRON 09:00 AM — Refresca contexto del día y lanza análisis IA para
 * partidos de hoy. Cada paso usa caché; OpenAI solo se llama si no hay análisis.
 */
function cronTodayPreviewRefresh() {
  throw new Error('DEPRECATED: esta función fue consolidada en cronDailySetup(). Elimina el trigger si existe.');
}

/**
 * Recolecta clima, noticias, cuotas e H2H para un fixture.
 * Cada fuente chequea su caché antes de llamar a la API externa.
 */
function gatherFixtureContext_(fixture) {
  const fixtureId = fixture.fixture.id;
  const date      = String(fixture.fixture.date || '').substring(0, 10);

  const weather = fetchWeatherForFixture_(fixture);
  if (weather.source !== 'cache') saveWeatherForFixture_(fixture, weather);

  const news = fetchNewsForFixture_(fixture);
  if (news.length && news[0].source !== 'cache') saveNewsForFixture_(fixture, news);

  calculateBasicOddsSignals_(fixture);

  try { loadHeadToHeadForFixture_(fixture); }
  catch (e) { console.warn(`H2H fixture ${fixtureId}: ${e.message}`); }

  // ESPN: stats avanzadas + forma (no bloquea el pipeline si falla)
  try { saveEspnDataForFixture_(fixture, date); }
  catch (e) { console.warn(`ESPN fixture ${fixtureId}: ${e.message}`); }
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