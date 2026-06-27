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

  let partidosOperacionalesHoy = [];
  try { partidosOperacionalesHoy = getOperationalFixturesForDate_(today); } catch (e_) {}

  const hayPartidosHoy    = partidosHoy.length > 0 || partidosOperacionalesHoy.length > 0;
  const hayPartidosMañana = partidosMañana.length > 0;

  const ctx = { today, tomorrow, hayPartidosHoy, hayPartidosMañana,
    nHoy: Math.max(partidosHoy.length, partidosOperacionalesHoy.length), nMañana: partidosMañana.length };

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
    // NOTA: backfillMissingApiFootballFixtureIdsForDate se movió a cronBackfillFixtureIds (trigger 6:00 AM)
    // para no bloquear este cron con la llamada lenta a API-Football (~3 min en plan gratis).
    try { loadWorldCupDay_(yesterdayChile_()); } catch (e) { console.warn('LoadDay ayer:', e.message); }
    // repairPlayerStatsForDate_ solo corre si hay partidos terminados sin fixture_id_af (ESPN fallback).
    // loadWorldCupDay_ ya cubrió los que tienen ID oficial.
    try {
      const ayer = yesterdayChile_();
      const sinId = readAll_(CONFIG.SHEETS.PARTIDOS)
        .filter(r => normalizeFecha_(r.fecha) === ayer)
        .filter(r => ['FT','AET','PEN'].includes(String(r.status || '').toUpperCase()))
        .some(r => !String(r.fixture_id_af || r.fixture_id_api_football || '').trim());
      if (sinId) repairPlayerStatsForDate_(ayer);
      else Logger.log('repairPlayerStatsForDate_: todos los partidos de ayer tienen fixture_id_af, skip.');
    } catch (e) { console.warn('PlayerStats ayer:', e.message); }

    // 2. Actualizar solo hoy y mañana desde ESPN (rápido — 2 llamadas)
    try { loadEspnMatchesForDays_([yesterdayChile_(), ctx.today, ctx.tomorrow]); } catch (e) { console.warn('ESPN hoy/mañana/ayer:', e.message); }

    // 3. Contexto de partidos de hoy (clima, noticias, H2H, cuotas) — fuentes gratuitas
    if (ctx.hayPartidosHoy) {
      const fixturesHoy = getOperationalFixturesForDate_(ctx.today);
      fixturesHoy.forEach(r => {
        const fakeFixture = buildFixtureFromPartidosRow_(r);
        try { gatherFixtureContext_(fakeFixture); } catch (e_) {}
        Utilities.sleep(500);
      });
    }

    // 4. Análisis IA para partidos de hoy (OpenAI, cachea si ya existe)
    if (ctx.hayPartidosHoy) {
      const fixturesHoy = getOperationalFixturesForDate_(ctx.today);
      fixturesHoy.forEach(r => {
        const fakeFixture = buildFixtureFromPartidosRow_(r);
        try { analyzeAndSaveFixture_(fakeFixture); } catch (e_) { Logger.log('AnalisisIA ERROR ' + r.local + ' vs ' + r.visitante + ': ' + e_.message); }
        Utilities.sleep(1000);
      });
    }

    // 5. Modelo Poisson: movido a cronOddsCalc (trigger separado 7:15 AM) para evitar timeout

    // 6. Recalcular tabla de posiciones antes de simular.
    try { recalcularTablaDesdePartidos(); } catch (e) { console.warn('Tabla:', e.message); }

    // 7. EV y simulación de grupos (Poisson ya disponible → EV usa modelo independiente)
    try { runGroupSimulation(); } catch (e) { console.warn('GroupSim:', e.message); }

    // 8. Refrescar horas de partidos NS desde ESPN (corrige :42 del backfill)
    try { refreshNSMatchTimes(); } catch (e) { console.warn('RefreshNS:', e.message); }

    // 9. Dashboard y reporte matutino
    try { refreshDashboard(); } catch (e) { console.warn('Dashboard:', e.message); }
    if (ctx.hayPartidosHoy) {
      try { broadcastMorningReport_(); } catch (e) { console.warn('MorningReport:', e.message); }
    }
  });
}

/**
 * CRON 1b — Day timer → 7:15 AM (separado de cronDailySetup para no exceder 6 min)
 * Recalcula los 3 modelos de odds (Poisson, Corners, Cards) para los 86 partidos pendientes.
 * Debe correr DESPUÉS de cronDailySetup (que carga datos del día anterior).
 * Agregar trigger manual: Apps Script → Triggers → Day timer → 7:00–8:00 AM → cronOddsCalc
 */
function cronOddsCalc() {
  // Limita el cálculo a los próximos 7 días para no exceder el límite de 6 min de GAS.
  // Para recalcular todos los 86 partidos, ejecutar recalcularOddsCompleto() manualmente.
  const DIAS = 7;
  runWithHealthCheck_('cronOddsCalc', () => {
    try { recalcularPoissonOdds(DIAS); } catch (e) { console.warn('Poisson:', e.message); }
    try { recalcularCornersOdds(DIAS); } catch (e) { console.warn('Corners:', e.message); }
    try { recalcularCardsOdds(DIAS);   } catch (e) { console.warn('Cards:', e.message); }
    try { calcularEV();                } catch (e) { console.warn('EV:', e.message); }
  });
}

/**
 * Recalcula odds para TODOS los partidos pendientes (86).
 * Solo ejecutar manualmente — tarda ~8-10 min, no usar como cron.
 */
function recalcularOddsCompleto() {
  recalcularPoissonOdds();
  recalcularCornersOdds();
  recalcularCardsOdds();
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
    const partidos = getOperationalFixturesForDate_(today);

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

    // Refrescar noticias para partidos de hoy que aún no empezaron (independiente de si hay FT)
    try {
      const proximos = partidos.filter(r => String(r.status || '').toUpperCase() === 'NS');
      proximos.slice(0, 3).forEach(r => {
        const fakeFixture = buildFixtureFromPartidosRow_(r);
        const news = fetchNewsForFixture_(fakeFixture);
        if (news.length && news[0].source !== 'cache') saveNewsForFixture_(fakeFixture, news);
        Utilities.sleep(500);
      });
    } catch (e) { console.warn('NewsRefresh:', e.message); }

    if (!recienTerminados.length) return;
    Logger.log(`cronPostMatch: ${recienTerminados.length} partido(s) recién terminados`);

    recienTerminados.forEach(r => {
      // ESPN stats + árbitro post-partido (usa findEspnEventId_ internamente)
      const fakeFixture = buildFixtureFromPartidosRow_(r);
      try { saveEspnDataForFixture_(fakeFixture, today); } catch (e_) { console.warn('PostMatch ESPN:', e_.message); }

      // SofaScore deshabilitado (HTTP 403 desde GAS)
      try {
        const fecha = normalizeFecha_(r.fecha);
        saveSofaDataForMatch_(r.local, r.visitante, fecha, r.match_key);
      } catch (e_) { console.warn('PostMatch SofaScore:', e_.message); }

      Utilities.sleep(300);
    });

    // Recalcular tabla después de partidos terminados
    try { recalcularTablaDesdePartidos(); } catch (e) { console.warn('Tabla post:', e.message); }
    // Resolver histórico EV y retirar oportunidades ya cerradas de la vista activa.
    try { resolvePendingEvHistoricoFromPartidos(); } catch (e) { console.warn('EvHistResolve post:', e.message); }
    try { cleanupClosedEvOpportunities(); } catch (e) { console.warn('EvCleanup post:', e.message); }
    try { calculateModelCalibration_(); } catch (e) { console.warn('Calib post:', e.message); }
    // Actualizar % clasificación Monte Carlo con standings frescos
    try { runGroupSimulation(); } catch (e) { console.warn('GroupSim post:', e.message); }
    // Refrescar horas de partidos NS desde ESPN (corrige valores :42 del backfill)
    try { refreshNSMatchTimes(); } catch (e) { console.warn('RefreshNS:', e.message); }
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
    try { limpiarDuplicadosPartidos(); }   catch (e) { console.warn('LimpDup:', e.message); }
    try { limpiarDuplicadosResumen(); }    catch (e) { console.warn('LimpResumen:', e.message); }
    try { initializeEloRatings(); }         catch (e) { console.warn('EloInit:', e.message); }
    try { repairRecentOfficialPlayerStats_(7, 8); } catch (e) { console.warn('PlayerStatsRepair:', e.message); }
    try { recalcularTablaDesdePartidos(); } catch (e) { console.warn('Tabla:', e.message); }
    try { runGroupSimulation(); }           catch (e) { console.warn('GroupSim:', e.message); }
    try { resolvePendingEvHistoricoFromPartidos(); } catch (e) { console.warn('EvHistResolve:', e.message); }
    try { cleanupClosedEvOpportunities(); } catch (e) { console.warn('EvCleanup:', e.message); }
    // Cargar/actualizar planteles desde ESPN (fotos incluidas, sin cuota API-Football)
    try { cargarPlantelesDesdeEspn(); } catch (e) { console.warn('PlantelesEspn:', e.message); }
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

/**
 * Construye objetos fixture sintéticos desde la hoja Partidos cuando
 * el endpoint de API-Football por fecha retorna vacío (caso WC2026 plan free).
 * Requiere que fixture_id_af esté poblado (por loadFullWorldCupCalendar).
 */
function _buildFakeFixturesFromPartidos_(date) {
  const rows = readAll_(CONFIG.SHEETS.PARTIDOS).filter(r =>
    String(r.fecha || '').substring(0, 10) === date &&
    String(r.fixture_id_af || r.fixture_id_api_football || '').trim() !== '' &&
    ['FT','AET','PEN'].includes(String(r.status || '').toUpperCase())
  );
  if (!rows.length) return [];

  const equipos = readAll_(CONFIG.SHEETS.EQUIPOS);
  const teamIdMap = {};
  equipos.forEach(e => {
    if (e.team_id_api_football) {
      const k = String(e.nombre || '').toLowerCase().trim();
      teamIdMap[k] = String(e.team_id_api_football);
    }
  });

  return rows.map(r => ({
    fixture: {
      id: Number(r.fixture_id_af || r.fixture_id_api_football),
      date: date,
      referee: null,
      status: { short: String(r.status || 'FT') }
    },
    league: { round: String(r.ronda || '') },
    teams: {
      home: { id: teamIdMap[String(r.local || '').toLowerCase().trim()] || '', name: r.local || '' },
      away: { id: teamIdMap[String(r.visitante || '').toLowerCase().trim()] || '', name: r.visitante || '' }
    },
    goals: {
      home: r.goles_local !== '' && r.goles_local != null ? Number(r.goles_local) : null,
      away: r.goles_visitante !== '' && r.goles_visitante != null ? Number(r.goles_visitante) : null
    }
  }));
}

/**
 * Carga datos del día usando ESPN como fuente principal.
 * Se invoca cuando API-Football no tiene acceso a WC2026 (plan free).
 * Equivalente a backfillEspnHistorical pero para un solo día,
 * más ELO update y auto-settlement de apuestas.
 */
function _loadWorldCupDayFromEspn_(date) {
  let events;
  try { events = fetchEspnEventsByDate_(date); } catch(e) {
    Logger.log(`_loadWorldCupDayFromEspn_ ${date}: error ESPN → ${e.message}`); return;
  }

  const FT_STATUSES = ['STATUS_FULL_TIME','STATUS_FINAL','final','full time','final/aet','final/pen'];
  const STATUS_MAP  = {'STATUS_FULL_TIME':'FT','STATUS_FINAL':'FT','final':'FT',
                       'full time':'FT','final/aet':'AET','final/pen':'PEN'};
  const normN = n => String(n||'').toLowerCase().normalize('NFD')
    .replace(/[̀-ͯ]/g,'').replace(/[^a-z0-9]/g,'');

  const ftEvents = (events||[]).filter(ev => {
    const s = String(ev.espn_status || ev.status || '').toLowerCase();
    return FT_STATUSES.some(fs => s.includes(fs.toLowerCase()) || s === fs.toLowerCase());
  });

  if (!ftEvents.length) { Logger.log(`_loadWorldCupDayFromEspn_ ${date}: sin partidos FT`); return; }
  Logger.log(`_loadWorldCupDayFromEspn_ ${date}: ${ftEvents.length} partido(s) FT`);

  // Leer Partidos para localizar filas y obtener ronda
  const partidos = readAll_(CONFIG.SHEETS.PARTIDOS);

  ftEvents.forEach(ev => {
    const espnId = String(ev.espn_id || '');
    if (!espnId) return;
    const fakeId = `espn_${espnId}`;

    const homeEs = teamNameToSpanish_(ev.home_team || '');
    const awayEs = teamNameToSpanish_(ev.away_team || '');
    const sheetRow = partidos.find(r => {
      const k1 = normN(teamNameToSpanish_(r.local||'')) + '_' + normN(teamNameToSpanish_(r.visitante||''));
      const k2 = normN(homeEs) + '_' + normN(awayEs);
      return k1 === k2;
    });
    const ronda = (sheetRow && sheetRow.ronda) || '';

    try {
      const summary = fetchEspnSummary_(espnId);

      // Stats, alineaciones, forma, árbitro
      _saveEspnStats_(fakeId, espnId, date, homeEs, awayEs, summary);
      _saveEspnLineupsToSheet_(fakeId, espnId, ev.home_team, ev.away_team, summary);
      _saveEspnForma_(summary);
      try { saveRefereeFromEspnSummary_(fakeId, date, homeEs, awayEs, ronda, summary); } catch(er_) {}

      // Guardar jugadores en hoja Jugadores (foto incluida) si el equipo aún no tiene plantel
      try { _saveEspnRostersAsPlayers_(summary, ev.home_team, ev.away_team); } catch(ep_) {}

      // Stats individuales temporales (goles, tarjetas) hasta que llegue fixture_id_af real
      try { saveEspnPlayerEventsToResumen_(fakeId, summary); } catch(ep_) { Logger.log('ESPN ResumenJugador: ' + ep_.message); }

      // ELO update
      const statusFinal = STATUS_MAP[ev.espn_status] || 'FT';
      const fakeFixture = {
        fixture: { status: { short: statusFinal } },
        teams:   { home: { name: homeEs }, away: { name: awayEs } },
        goals:   { home: Number(ev.home_score||0), away: Number(ev.away_score||0) },
        league:  { round: ronda }
      };
      try { updateEloAfterMatch_(fakeFixture); } catch(e_) {}
      try { autoSettleBetsForFixture_(fakeFixture); } catch(e_) {}

      // Actualizar fila Partidos con resultado real (status + goles)
      // Sin esto, el partido queda NS y todo el pipeline downstream queda bloqueado.
      if (sheetRow && sheetRow.match_key) {
        try {
          updatePartidosEnrichment_(sheetRow.match_key, {
            status:          statusFinal,
            goles_local:     Number(ev.home_score || 0),
            goles_visitante: Number(ev.away_score || 0),
            fuente:          'ESPN',
            last_updated:    nowChile_()
          });
        } catch(eu_) { console.warn(`updatePartidos ${homeEs}:`, eu_.message); }
      }

      Logger.log(`  ✅ ${homeEs} vs ${awayEs}`);
    } catch(es_) {
      Logger.log(`  ❌ ${espnId}: ${es_.message}`);
    }
    Utilities.sleep(500);
  });
}


function loadWorldCupDay_(date) {
  const fixturesData = fetchWorldCupFixturesByDate_(date);
  const rawUrl = saveRawJson_(`fixtures/${date}`, `worldcup-fixtures-${date}.json`, fixturesData);

  let fixtures = fixturesData.response || [];

  // API-Football /fixtures?date= no retorna datos para WC2026 en plan free.
  // Fallback: usar fixture IDs guardados en Partidos (pobladlos por loadFullWorldCupCalendar).
  if (!fixtures.length) {
    fixtures = _buildFakeFixturesFromPartidos_(date);
    if (fixtures.length) {
      Logger.log(`loadWorldCupDay_ ${date}: fallback Partidos → ${fixtures.length} fixture(s)`);
    } else {
      // Fallback final: API-Football no disponible para WC2026 en plan free.
      // Usar ESPN como fuente principal de datos del día anterior.
      Logger.log(`loadWorldCupDay_ ${date}: API-Football sin acceso WC2026 → usando ESPN`);
      _loadWorldCupDayFromEspn_(date);
      return;
    }
  }

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

    // Resolver EV histórico para este fixture
    try {
      const hEs = teamNameToSpanish_(fixture.teams.home.name);
      const aEs = teamNameToSpanish_(fixture.teams.away.name);
      const gH  = fixture.goals ? Number(fixture.goals.home ?? -1) : -1;
      const gA  = fixture.goals ? Number(fixture.goals.away ?? -1) : -1;
      resolveEvHistorico_(hEs, aEs, gH, gA);
    } catch(re_) {}

    // ESPN: stats avanzadas post-partido (pases, tackles, despejes, asistencia)
    try { saveEspnDataForFixture_(fixture, date); } catch (e) { console.warn(`ESPN fixture ${fixtureId}:`, e.message); }

    Utilities.sleep(800);
  });

  // football-data.org: árbitros con nacionalidad oficial (sin costo extra — viene en el listado)
  try {
    const fdMatches = fetchFDWorldCupMatchesByDate_(date);
    if (fdMatches.length) {
      saveRefereesFromFootballData_(fdMatches, date);
      Logger.log(`loadWorldCupDay_ ${date}: árbitros FD guardados (${fdMatches.length} partidos)`);
    }
  } catch (e) {
    console.warn('football-data.org árbitros:', e.message);
  }

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

/**
 * DIAGNÓSTICO: Corre el análisis IA para el primer partido de hoy y muestra el resultado/error.
 * Ejecutar manualmente desde el editor de Apps Script para depurar.
 */
function diagnosticarAnalisisIA() {
  const today = Utilities.formatDate(new Date(), CONFIG.TIMEZONE, 'yyyy-MM-dd');
  const partidos = readAll_(CONFIG.SHEETS.PARTIDOS)
    .filter(r => normalizeFecha_(r.fecha) === today);

  if (!partidos.length) {
    Logger.log('DIAGNOSTICO: No hay partidos hoy (' + today + ')');
    return;
  }

  const r = partidos[0];
  Logger.log('DIAGNOSTICO: Analizando ' + r.local + ' vs ' + r.visitante + ' fixture_id_af=' + r.fixture_id_af);

  const fakeFixture = {
    fixture: { id: r.fixture_id_af || 'TEST_' + r.local, date: r.fecha },
    teams:   { home: { name: r.local || '' }, away: { name: r.visitante || '' } },
    league:  { round: r.ronda || '' }
  };

  try {
    const weather  = fetchWeatherForFixture_(fakeFixture);
    Logger.log('DIAGNOSTICO: weather OK');
    const news     = fetchNewsForFixture_(fakeFixture);
    Logger.log('DIAGNOSTICO: news OK, items=' + (news || []).length);
    const baseOdds = calculateBasicOddsSignals_(fakeFixture);
    Logger.log('DIAGNOSTICO: baseOdds OK');
    const aiInput  = buildAiPreviewInput_(fakeFixture, weather, news, baseOdds);
    Logger.log('DIAGNOSTICO: aiInput built, keys=' + Object.keys(aiInput).join(','));

    const prompt = buildFixturePreviewPrompt_(aiInput);
    Logger.log('DIAGNOSTICO: prompt length=' + prompt.length);

    // Llamar directamente a OpenAI con logging
    const payload = {
      model: CONFIG.OPENAI.MODEL,
      input: prompt,
      temperature: 0.2,
      text: { format: { type: 'json_object' } }
    };
    const response = UrlFetchApp.fetch(CONFIG.OPENAI.BASE_URL, {
      method: 'post',
      contentType: 'application/json',
      headers: { Authorization: 'Bearer ' + getOpenAiKey_() },
      payload: JSON.stringify(payload),
      muteHttpExceptions: true
    });
    const status = response.getResponseCode();
    const text   = response.getContentText();
    Logger.log('DIAGNOSTICO: OpenAI status=' + status);
    Logger.log('DIAGNOSTICO: OpenAI response (primeros 500): ' + text.substring(0, 500));

    if (status >= 200 && status < 300) {
      const data = JSON.parse(text);
      const outputText = extractOpenAiText_(data);
      Logger.log('DIAGNOSTICO: outputText (primeros 300): ' + outputText.substring(0, 300));
      Logger.log('DIAGNOSTICO: SUCCESS — análisis generado correctamente');
    } else {
      Logger.log('DIAGNOSTICO: ERROR HTTP ' + status + ': ' + text);
    }
  } catch (e) {
    Logger.log('DIAGNOSTICO: EXCEPCION: ' + e.message + '\n' + e.stack);
  }
}

/**
 * Backfill único: carga ResumenJugadorPartido desde ESPN para partidos FT sin fixture_id_af.
 * Ejecutar manualmente una vez para completar datos históricos de partidos ESPN.
 * Cuando llegue fixture_id_af real, loadWorldCupDay_ carga datos API-Football que complementan.
 */
function backfillEspnPlayerStats() {
  const partidos = readAll_(CONFIG.SHEETS.PARTIDOS).filter(r => {
    const s = String(r.status || '').toUpperCase();
    return ['FT','AET','PEN'].includes(s) && !r.fixture_id_af;
  });

  const resumen = readAll_(CONFIG.SHEETS.RESUMEN_JUGADOR_PARTIDO);
  const fixturesConDatos = new Set(resumen.map(r => String(r.fixture_id || '')));

  Logger.log('backfillEspnPlayerStats: ' + partidos.length + ' partidos sin fixture_id_af');

  partidos.forEach(r => {
    const matchId = String(r.match_id || r.espn_id || '');
    const espnId  = matchId.replace(/^espn_/, '');
    if (!espnId || isNaN(Number(espnId))) { Logger.log('  skip ' + r.local + ' — sin espn_id'); return; }
    const fakeId = 'espn_' + espnId;
    if (fixturesConDatos.has(fakeId)) { Logger.log('  skip ' + r.local + ' — ya tiene datos'); return; }
    try {
      Logger.log('  Cargando ' + r.local + ' vs ' + r.visitante + ' (espnId=' + espnId + ')');
      const summary = fetchEspnSummary_(espnId);
      saveEspnPlayerEventsToResumen_(fakeId, summary);
      Utilities.sleep(500);
    } catch(e_) {
      Logger.log('  ERROR ' + r.local + ': ' + e_.message);
    }
  });
  Logger.log('backfillEspnPlayerStats: completo');
}

/**
 * DIAGNÓSTICO: Verifica el estado del pipeline de stats de jugadores.
 * Muestra qué partidos terminados tienen/no tienen fixture_id_af y ResumenJugadorPartido.
 * Ejecutar manualmente para entender por qué faltan stats de jugadores.
 */
function diagnosticarPlayerStats() {
  const partidos = readAll_(CONFIG.SHEETS.PARTIDOS).filter(r => {
    const s = String(r.status || '').toUpperCase();
    return ['FT','AET','PEN'].includes(s);
  });
  const resumen = readAll_(CONFIG.SHEETS.RESUMEN_JUGADOR_PARTIDO);
  const fixturesConDatos = new Set(resumen.map(r => String(r.fixture_id || '')));

  Logger.log('=== DIAGNÓSTICO PLAYER STATS ===');
  Logger.log('Partidos terminados: ' + partidos.length);
  Logger.log('Fixtures con datos en ResumenJugadorPartido: ' + fixturesConDatos.size);
  Logger.log('');

  partidos.forEach(r => {
    const fid  = String(r.fixture_id_af || '');
    const tiene = fid && fixturesConDatos.has(fid);
    const status = tiene ? '✅' : (fid ? '❌ SIN DATOS API' : '⚠️ SIN fixture_id_af');
    Logger.log(status + ' ' + r.local + ' vs ' + r.visitante + ' (fecha=' + r.fecha + ', fixture_id_af=' + (fid||'NULL') + ')');
  });

  Logger.log('');
  Logger.log('CONCLUSIÓN:');
  const sinId  = partidos.filter(r => !r.fixture_id_af).length;
  const conId  = partidos.filter(r =>  r.fixture_id_af).length;
  const conDatos = partidos.filter(r => r.fixture_id_af && fixturesConDatos.has(String(r.fixture_id_af))).length;
  Logger.log('  Sin fixture_id_af: ' + sinId + ' → necesitan loadFullWorldCupCalendar()');
  Logger.log('  Con fixture_id_af: ' + conId + ', de esos con stats: ' + conDatos);
  if (conId > conDatos) {
    Logger.log('  → ' + (conId - conDatos) + ' partido(s) tienen fixture_id_af pero sin stats. Ejecutar loadWorldCupDay_("YYYY-MM-DD")');
  }
}


/**
 * CRON separado — Day timer → 6:00 AM (antes de cronDailySetup)
 * Resuelve fixture_id_api_football para los partidos de ayer vía API-Football.
 * Separado de cronDailySetup porque la llamada al plan gratis tarda ~3 min.
 * Trigger: Apps Script → Triggers → Day timer → 6:00–7:00 AM → cronBackfillFixtureIds
 */
function cronBackfillFixtureIds() {
  runWithHealthCheck_('cronBackfillFixtureIds', () => {
    try { backfillMissingApiFootballFixtureIdsForDate(yesterdayChile_()); }
    catch (e) { console.warn('cronBackfillFixtureIds:', e.message); }
  });
}
