/**
 * BackfillRunner.gs
 *
 * Carga masiva de datos históricos del Mundial 2026.
 *
 * CÓMO USAR:
 *   En Apps Script → Editor → ejecutar la función:
 *   - backfillWorldCupOpeningWeek()  → carga del 11 al 16 de junio (ajusta si amplías el rango)
 *   - backfillByDateRange('2026-06-11', '2026-06-16')  → cualquier rango personalizado
 *   - backfillResume()  → retoma desde el último día con error o incompleto
 *
 * RESTRICCIONES DE API (free tier):
 *   - API-Football:  100 req/día  → el backfill tiene un presupuesto configurable
 *   - football-data: 10 req/min   → se respeta con sleeps
 *   - Open-Meteo:    ilimitado    → sin restricciones
 *   - The Odds API:  500 req/mes  → se usa cache de 6h, solo 1 req/ejecución
 *
 * LÓGICA IDEMPOTENTE:
 *   Antes de cada llamada a la API verifica si el raw JSON ya existe en Drive.
 *   Si existe → reutiliza los datos guardados en lugar de gastar una request.
 *   Si la hoja Partidos ya tiene el partido → solo actualiza campos vacíos.
 *
 * ORDEN DE CARGA POR DÍA:
 *   1. Fixtures (1 req por día)
 *   2. Golden dataset (merge dual-source)
 *   3. Eventos por fixture (1 req × N partidos)
 *   4. Statistics por fixture (1 req × N partidos)
 *   5. Player stats por fixture — /fixtures/players (1 req × N partidos)
 *   6. Equipos y jugadores (solo si hay equipos nuevos)
 *   7. Standings (1 req total al final)
 *   8. Dashboard refresh
 */

// ─── Configuración del backfill ────────────────────────────────────────────────

const BACKFILL_CONFIG = {
  SLEEP_BETWEEN_FIXTURES_MS: 4000,
  SLEEP_BETWEEN_DATES_MS:    3000,
  SLEEP_BETWEEN_CALLS_MS:    2500,
  API_FOOTBALL_DAILY_BUDGET: 85,
  ENABLE_PLAYER_STATS:       true,
  ENABLE_STANDINGS:          true,
  ENABLE_TEAMS_SQUADS:       false,
  ENABLE_DASHBOARD:          true
};

// ─── Puntos de entrada ─────────────────────────────────────────────────────────

/**
 * EJECUTAR ESTE PARA CARGAR DEL 11 AL DÍA DE HOY.
 * No requiere parámetros. Ajustar desde/hasta si el torneo avanzó más.
 */
function backfillWorldCupOpeningWeek() {
  const dateFrom = '2026-06-11';
  const dateTo   = todayChile_();
  return backfillByDateRange(dateFrom, dateTo);
}

/**
 * Carga el calendario completo del Mundial 2026 desde ESPN.
 * ESPN es gratuito, sin cuota y tiene todos los ~104 partidos.
 * Itera desde el 11 de junio hasta el 19 de julio (~39 llamadas).
 *
 * Genera match_key compatible con el pipeline API-Football para que
 * el backfill posterior enriquezca las mismas filas (no duplica).
 *
 * Ejecutar cuando API-Football no tenga créditos o para pre-cargar
 * el calendario sin gastar cuota.
 */
function loadFullWorldCupCalendarFromEspn() {
  Logger.log('=== CARGANDO CALENDARIO COMPLETO DESDE ESPN (sin cuota) ===');

  const sheet   = getOrCreateSheet_(CONFIG.SHEETS.PARTIDOS, null);
  const headers = getHeaders_(CONFIG.SHEETS.PARTIDOS);
  const mkIdx   = headers.indexOf('match_key');
  if (mkIdx === -1) {
    Logger.log('❌ La hoja Partidos no tiene columna match_key. Ejecuta sheetEnsureAllWithHeaders() primero.');
    return;
  }

  // Leer filas existentes para upsert
  const existingValues = sheet.getDataRange().getValues();
  const existingByKey  = {};
  existingValues.slice(1).forEach((row, i) => {
    const key = String(row[mkIdx] || '');
    if (key) existingByKey[key] = i + 2; // fila 1-indexed
  });

  // Rango de fechas del Mundial 2026: 11-Jun → 19-Jul
  const dates = [];
  const start = new Date('2026-06-11');
  const end   = new Date('2026-07-19');
  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    dates.push(Utilities.formatDate(new Date(d), 'UTC', 'yyyy-MM-dd'));
  }

  let total = 0;
  let nuevos = 0;
  let actualizados = 0;

  dates.forEach(date => {
    let events;
    try {
      events = fetchEspnEventsByDate_(date);
    } catch (e) {
      Logger.log(`  ⚠️ ESPN ${date}: ${e.message}`);
      return;
    }

    if (!events.length) return;
    Logger.log(`  ${date}: ${events.length} partido(s)`);

    events.forEach(ev => {
      // Generar match_key compatible con buildMatchKey_() de SourceMatcher.gs
      // Formato: yyyy-MM-dd_home_away (normalizado sin acentos, solo a-z0-9)
      const normName = n => String(n || '')
        .toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
        .replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim()
        .replace(/ /g, '');

      const homeNorm = normName(ev.home_team);
      const awayNorm = normName(ev.away_team);
      const matchKey = `${date}_${homeNorm}_${awayNorm}`;

      // Convertir hora UTC a Chile
      const horaChile = ev.hora_utc
        ? Utilities.formatDate(new Date(ev.hora_utc), CONFIG.TIMEZONE, 'HH:mm')
        : '';

      // Mapear status ESPN → nuestro formato
      const statusMap = {
        'STATUS_SCHEDULED':    'NS',
        'STATUS_FIRST_HALF':   '1H',
        'STATUS_HALFTIME':     'HT',
        'STATUS_SECOND_HALF':  '2H',
        'STATUS_EXTRA_TIME':   'ET',
        'STATUS_BREAK_TIME':   'BT',
        'STATUS_PENALTY':      'P',
        'STATUS_FULL_TIME':    'FT',
        'STATUS_FINAL':        'FT',
        'STATUS_POSTPONED':    'PST',
        'STATUS_CANCELED':     'CANC',
        'STATUS_IN_PROGRESS':  'LIVE'
      };
      const espnStatus = ev.espn_status || 'STATUS_SCHEDULED';
      const status     = statusMap[espnStatus] || 'NS';

      // Construir fila con las columnas de Partidos (orden del header)
      const rowData = {};
      rowData['match_key']       = matchKey;
      rowData['local']           = ev.home_team;
      rowData['visitante']       = ev.away_team;
      rowData['fecha']           = date;
      rowData['hora_chile']      = horaChile;
      rowData['estadio']         = ev.estadio || '';
      rowData['ciudad']          = ev.ciudad  || '';
      rowData['status']          = status;
      rowData['goles_local']     = (status === 'FT' || status === 'AET' || status === 'PEN')
        ? ev.home_score : '';
      rowData['goles_visitante'] = (status === 'FT' || status === 'AET' || status === 'PEN')
        ? ev.away_score : '';
      rowData['sources_count']   = '1';
      rowData['conflict_detail'] = '';
      rowData['updated_at']      = nowChile_();

      const row = headers.map(h => rowData[h] !== undefined ? rowData[h] : '');

      if (existingByKey[matchKey]) {
        // Solo actualizar status, goles y hora si ya existe
        sheet.getRange(existingByKey[matchKey], 1, 1, row.length).setValues([row]);
        actualizados++;
      } else {
        appendRows_(CONFIG.SHEETS.PARTIDOS, [row]);
        existingByKey[matchKey] = -1; // marcar para evitar duplicados en la misma ejecución
        nuevos++;
      }
      total++;
    });

    Utilities.sleep(200); // respetar rate gentil con ESPN
  });

  Logger.log(`\n✅ Calendario cargado: ${total} partidos (${nuevos} nuevos, ${actualizados} actualizados)`);
  Logger.log('Nota: stats y árbitros se cargan con backfillWorldCupOpeningWeek() para partidos ya jugados.');
  Logger.log('=== FIN ESPN CALENDAR ===');
}

/**
 * Carga el calendario completo del Mundial 2026 en Partidos.
 * Usa una sola llamada a la API (league + season) en vez de iterar por fecha.
 * Solo guarda fixture_id, equipos, fecha, hora, estadio, ronda y grupo.
 * NO carga stats, eventos ni lineups (esos requieren una llamada por partido).
 *
 * Ideal para pre-cargar todos los partidos futuros de forma eficiente.
 * Ejecutar UNA VEZ al inicio del torneo o cuando Partidos esté desactualizado.
 */
function loadFullWorldCupCalendar() {
  Logger.log('=== CARGANDO CALENDARIO COMPLETO DEL MUNDIAL 2026 ===');

  const data = fetchAllWorldCupFixtures_();
  const fixtures = (data.response || []).filter(isWorldCupFixture_);

  if (!fixtures.length) {
    Logger.log('❌ No se recibieron fixtures. Revisar API key y cuota.');
    return;
  }

  Logger.log(`✅ API devolvió ${fixtures.length} partidos del Mundial`);

  const quota = createQuotaTracker_();

  // Agrupa por fecha para llamar upsertGoldenMatchesFromFixtures_ correctamente
  const byDate = {};
  fixtures.forEach(fx => {
    const date = String(fx.fixture.date || '').substring(0, 10);
    if (!date) return;
    if (!byDate[date]) byDate[date] = [];
    byDate[date].push(fx);
  });

  const dates = Object.keys(byDate).sort();
  Logger.log(`Fechas a cargar: ${dates.join(', ')}`);

  dates.forEach(date => {
    Logger.log(`  → ${date}: ${byDate[date].length} partidos`);
    try {
      upsertGoldenMatchesFromFixtures_(byDate[date], date, quota);
    } catch (e) {
      Logger.log(`  ⚠️ Error en ${date}: ${e.message}`);
    }
  });

  Logger.log(`\nCalendario cargado: ${fixtures.length} partidos en ${dates.length} fechas`);
  Logger.log('Nota: stats, eventos y lineups se cargan automáticamente cuando cada partido finalice.');
  Logger.log('=== FIN ===');
}

/**
 * Carga un rango de fechas personalizado.
 * @param {string} dateFrom - 'yyyy-MM-dd'
 * @param {string} dateTo   - 'yyyy-MM-dd'
 */
function backfillByDateRange(dateFrom, dateTo) {
  Logger.log(`=== BACKFILL INICIO: ${dateFrom} → ${dateTo} ===`);

  const run = createPipelineRun_({
    mode: 'BACKFILL',
    date_from: dateFrom,
    date_to: dateTo,
    step: 'backfillByDateRange',
    notes: JSON.stringify(BACKFILL_CONFIG)
  });

  const quota = createQuotaTracker_();
  const dates = buildDateRange_(dateFrom, dateTo);
  const summary = { dates: [], errors: [], totalFixtures: 0, apiCalls: 0 };

  dates.forEach(date => {
    Logger.log(`\n--- BACKFILL fecha: ${date} ---`);

    if (quota.isExhausted()) {
      Logger.log(`⚠️  Cuota agotada (${quota.used}/${BACKFILL_CONFIG.API_FOOTBALL_DAILY_BUDGET} req). Deteniendo.`);
      summary.errors.push(`Cuota agotada al procesar ${date}`);
      return;
    }

    const dayResult = backfillDate_(date, quota);
    summary.dates.push(dayResult);
    summary.totalFixtures += dayResult.fixtures;
    summary.apiCalls = quota.used;

    if (dayResult.error) summary.errors.push(`${date}: ${dayResult.error}`);

    Utilities.sleep(BACKFILL_CONFIG.SLEEP_BETWEEN_DATES_MS);
  });

  if (BACKFILL_CONFIG.ENABLE_STANDINGS && !quota.isExhausted()) {
    try {
      Logger.log('Actualizando tabla de posiciones...');
      quota.use(1);
      loadWorldCupStandings();
    } catch (e) {
      Logger.log(`Standings error: ${e.message}`);
      summary.errors.push(`standings: ${e.message}`);
    }
  }

  if (BACKFILL_CONFIG.ENABLE_DASHBOARD) {
    try {
      Logger.log('Actualizando Dashboard...');
      refreshDashboard();
    } catch (e) {
      Logger.log(`Dashboard error: ${e.message}`);
    }
  }

  finishPipelineRun_(run, {
    status: summary.errors.length ? 'PARTIAL_OK' : 'OK',
    api_football_count: summary.apiCalls,
    golden_count: summary.totalFixtures,
    errors: summary.errors.join(' | '),
    notes: JSON.stringify(summary)
  });

  Logger.log('\n=== BACKFILL FIN ===');
  Logger.log(JSON.stringify(summary, null, 2));

  return summary;
}

/**
 * Retoma el backfill desde el primer día que esté incompleto.
 * Un día está incompleto si hay partidos con campos de stats vacíos.
 */
function backfillResume() {
  const today = todayChile_();
  const lastIncomplete = detectFirstIncompleteDate_('2026-06-11', today);

  if (!lastIncomplete) {
    Logger.log('Todos los días entre 2026-06-11 y hoy parecen completos.');
    return;
  }

  Logger.log(`Resume desde: ${lastIncomplete}`);
  return backfillByDateRange(lastIncomplete, today);
}

// ─── Lógica por día ────────────────────────────────────────────────────────────

function backfillDate_(date, quota) {
  const result = { date, fixtures: 0, skipped: 0, error: '' };

  let fixturesData;

  try {
    fixturesData = loadOrFetchFixtures_(date, quota);
  } catch (e) {
    result.error = `fixtures: ${e.message}`;
    Logger.log(`Error fixtures ${date}: ${e.message}`);
    return result;
  }

  const fixtures = fixturesData.response || [];
  result.fixtures = fixtures.length;

  if (!fixtures.length) {
    Logger.log(`Sin partidos del Mundial para ${date}`);
    return result;
  }

  try {
    upsertGoldenMatchesFromFixtures_(fixtures, date, quota);
  } catch (e) {
    result.error += ` | golden: ${e.message}`;
    Logger.log(`Error golden ${date}: ${e.message}`);
  }

  fixtures.forEach(fixture => {
    const fixtureId = fixture.fixture.id;

    if (quota.isExhausted()) {
      Logger.log(`Cuota agotada, saltando fixture ${fixtureId}`);
      result.skipped++;
      return;
    }

    Logger.log(`  fixture ${fixtureId}: ${fixture.teams.home.name} vs ${fixture.teams.away.name}`);
    backfillFixture_(fixture, date, quota);
    Utilities.sleep(BACKFILL_CONFIG.SLEEP_BETWEEN_FIXTURES_MS);
  });

  return result;
}

function backfillFixture_(fixture, date, quota) {
  const fixtureId = fixture.fixture.id;
  const status    = String(fixture.fixture.status.short || '');
  const finished  = ['FT', 'AET', 'PEN'].includes(status);

  // Eventos
  if (!quota.isExhausted()) {
    const eventsFile = `raw/api-football/events/${date}/events-${fixtureId}.json`;
    const evCheck = rawFileCheck_(`raw/api-football/events/${date}`, `events-${fixtureId}.json`);

    let eventsData;
    if (evCheck.exists) {
      Logger.log(`    events: ya existe en Drive, reutilizando`);
      eventsData = { response: [] };
    } else {
      try {
        quota.use(1);
        Utilities.sleep(BACKFILL_CONFIG.SLEEP_BETWEEN_CALLS_MS);
        eventsData = fetchEventsByFixture_(fixtureId);
        saveRawJson_(`raw/api-football/events/${date}`, `events-${fixtureId}.json`, eventsData);
        Logger.log(`    events: ${(eventsData.response || []).length} eventos`);
      } catch (e) {
        Logger.log(`    events error: ${e.message}`);
        eventsData = { response: [] };
      }
    }

    try {
      saveEvents_(fixtureId, eventsData.response || [], evCheck.url || '', fixture.teams.home.id, fixture.teams.away.id);
      savePlayerSummaryFromEvents_(fixtureId, fixture, eventsData.response || []);
    } catch (e) {
      Logger.log(`    events save error: ${e.message}`);
    }
  }

  // Statistics (solo partidos terminados)
  if (finished && !quota.isExhausted()) {
    const statsCheck = rawFileCheck_(`raw/api-football/statistics/${fixtureId}`, `api-football-statistics-${fixtureId}.json`);

    if (!statsCheck.exists) {
      try {
        quota.use(1);
        Utilities.sleep(BACKFILL_CONFIG.SLEEP_BETWEEN_CALLS_MS);
        const statsData = fetchStatisticsByFixture_(fixtureId);
        saveRawJson_(`raw/api-football/statistics/${fixtureId}`, `api-football-statistics-${fixtureId}.json`, statsData);
        Logger.log(`    statistics: guardado`);

        const matchKey = buildMatchKey_(fixture);
        if (matchKey) {
          const stats = extractMatchStatsForPartidos_(statsData.response || []);
          const cards = extractCardsFromEvents_([], fixture.teams.home.name, fixture.teams.away.name);
          updatePartidosEnrichment_(matchKey, {
            posesion_local:      stats.home.possession,
            posesion_visitante:  stats.away.possession,
            tiros_local:         stats.home.totalShots,
            tiros_visitante:     stats.away.totalShots,
            xg_local:            stats.home.expectedGoals,
            xg_visitante:        stats.away.expectedGoals,
            corners_local:       stats.home.cornerKicks,
            corners_visitante:   stats.away.cornerKicks,
            faltas_local:        stats.home.fouls,
            faltas_visitante:    stats.away.fouls
          });
        }
      } catch (e) {
        Logger.log(`    statistics error: ${e.message}`);
      }
    } else {
      Logger.log(`    statistics: ya existe en Drive`);
    }
  }

  // Player stats avanzadas (solo partidos terminados)
  if (finished && BACKFILL_CONFIG.ENABLE_PLAYER_STATS && !quota.isExhausted()) {
    const psCheck = rawFileCheck_(`raw/api-football/player-stats/${fixtureId}`, `player-stats-${fixtureId}.json`);

    if (!psCheck.exists) {
      try {
        quota.use(1);
        Utilities.sleep(BACKFILL_CONFIG.SLEEP_BETWEEN_CALLS_MS);
        loadPlayerStatsForFixture_(fixtureId, fixture);
        Logger.log(`    player-stats: guardado`);
      } catch (e) {
        Logger.log(`    player-stats error: ${e.message}`);
      }
    } else {
      Logger.log(`    player-stats: ya existe en Drive`);
    }
  }
}

// ─── Golden dataset desde fixtures ya cargados ────────────────────────────────

function loadOrFetchFixtures_(date, quota) {
  const driveFile  = `api-football-worldcup-fixtures-${date}.json`;
  const driveCheck = rawFileCheck_(`raw/api-football/fixtures/${date}`, driveFile);

  if (driveCheck.exists) {
    Logger.log(`  fixtures ${date}: ya en Drive, re-usando`);
    return fetchWorldCupFixturesByDate_(date);
  }

  quota.use(1);
  const data = fetchWorldCupFixturesByDate_(date);
  saveRawJson_(`raw/api-football/fixtures/${date}`, driveFile, data);
  Logger.log(`  fixtures ${date}: ${(data.response || []).length} del Mundial`);
  return data;
}

function upsertGoldenMatchesFromFixtures_(fixtures, date, quota) {
  const goldenRows = fixtures.map(fixture => {
    const venue = fixture.fixture.venue || {};
    const venueInfo = getVenueInfo_(venue.name || '', venue.city || '');

    const score = fixture.score || {};
    const ft    = score.fulltime || {};
    const matchDate = fixture.fixture.date || '';

    return {
      match_key:             buildMatchKey_(fixture),
      fixture_id_af:         fixture.fixture.id,
      fixture_id_fd:         '',
      fecha:                 matchDate ? matchDate.substring(0, 10) : date,
      hora_utc:              matchDate,
      hora_chile:            matchDate ? Utilities.formatDate(new Date(matchDate), CONFIG.TIMEZONE, 'HH:mm') : '',
      local:                 fixture.teams.home.name,
      visitante:             fixture.teams.away.name,
      goles_local:           ft.home !== null && ft.home !== undefined ? ft.home : '',
      goles_visitante:       ft.away !== null && ft.away !== undefined ? ft.away : '',
      estado:                fixture.fixture.status.short || '',
      estadio:               venue.name || '',
      ciudad:                venue.city || '',
      pais_estadio:          venueInfo.pais_estadio || '',
      grupo:                 fixture.league.round || '',
      ronda:                 fixture.league.round || '',
      posesion_local:        '',
      posesion_visitante:    '',
      tiros_local:           '',
      tiros_visitante:       '',
      xg_local:              '',
      xg_visitante:          '',
      corners_local:         '',
      corners_visitante:     '',
      faltas_local:          '',
      faltas_visitante:      '',
      amarillas_local:       '',
      amarillas_visitante:   '',
      rojas_local:           '',
      rojas_visitante:       '',
      source_confidence:     0.8,
      data_quality_notes:    `Backfill ${nowChile_()}`,
      updated_at:            nowChile_()
    };
  });

  upsertGoldenMatches_(goldenRows);
  Logger.log(`  golden: ${goldenRows.length} partidos upserted en Partidos`);
}

// ─── Detección de datos incompletos ───────────────────────────────────────────

function detectFirstIncompleteDate_(dateFrom, dateTo) {
  const allPartidos = readAll_(CONFIG.SHEETS.PARTIDOS);
  const dates = buildDateRange_(dateFrom, dateTo);

  for (const date of dates) {
    const dayRows = allPartidos.filter(r => normalizeFecha_(r.fecha) === date);

    if (!dayRows.length) return date;

    const hasIncomplete = dayRows.some(r =>
      ['FT', 'AET', 'PEN'].includes(String(r.estado || '').toUpperCase()) &&
      (r.posesion_local === '' || r.posesion_local === null)
    );

    if (hasIncomplete) return date;
  }

  return null;
}

// ─── Control de cuota de API ──────────────────────────────────────────────────

function createQuotaTracker_() {
  return {
    used:  0,
    limit: BACKFILL_CONFIG.API_FOOTBALL_DAILY_BUDGET,

    use(n) {
      this.used += (n || 1);
      Logger.log(`  [quota] ${this.used}/${this.limit} req usadas`);
    },

    isExhausted() {
      return this.used >= this.limit;
    },

    remaining() {
      return Math.max(0, this.limit - this.used);
    }
  };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function buildMatchKey_(fixture) {
  const dateStr = fixture.fixture.date
    ? fixture.fixture.date.substring(0, 10)
    : '';
  const home = fixture.teams.home.name.replace(/\s+/g, '_').toLowerCase();
  const away = fixture.teams.away.name.replace(/\s+/g, '_').toLowerCase();
  return `${dateStr}_${home}_${away}`;
}

function buildDateRange_(dateFrom, dateTo) {
  const dates = [];
  const start = parseYyyyMmDdAsUtcDate_(dateFrom);
  const end   = parseYyyyMmDdAsUtcDate_(dateTo);
  let cursor  = new Date(start.getTime());

  while (cursor.getTime() <= end.getTime()) {
    dates.push(Utilities.formatDate(cursor, 'UTC', 'yyyy-MM-dd'));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }

  return dates;
}

function parseYyyyMmDdAsUtcDate_(dateString) {
  const parts = String(dateString).split('-').map(Number);
  return new Date(Date.UTC(parts[0], parts[1] - 1, parts[2]));
}

function getChileDatesToEnrichForUtcDate_(dateUtc) {
  const d        = parseYyyyMmDdAsUtcDate_(dateUtc);
  const previous = new Date(d.getTime());
  previous.setUTCDate(previous.getUTCDate() - 1);

  return [
    Utilities.formatDate(previous, 'UTC', 'yyyy-MM-dd'),
    Utilities.formatDate(d, 'UTC', 'yyyy-MM-dd')
  ];
}

// ─── Estado del backfill (diagnóstico) ────────────────────────────────────────

/**
 * Muestra en Logger el estado de cada día: cuántos partidos, cuáles faltan stats.
 * Ejecutar manualmente para saber qué falta antes de correr el backfill.
 * No hace llamadas a la API.
 */
function backfillStatus() {
  const dates    = buildDateRange_('2026-06-11', todayChile_());
  const partidos = readAll_(CONFIG.SHEETS.PARTIDOS);

  Logger.log('=== ESTADO BACKFILL ===');

  let totalPartidos = 0;
  let totalFaltanStats = 0;

  dates.forEach(date => {
    const rows     = partidos.filter(r => normalizeFecha_(r.fecha) === date);
    const finished = rows.filter(r => ['FT','AET','PEN'].includes(String(r.estado||'').toUpperCase()));
    const noStats  = finished.filter(r => r.posesion_local === '' || r.posesion_local === null || r.posesion_local === undefined);

    totalPartidos     += rows.length;
    totalFaltanStats  += noStats.length;

    const statusIcon = noStats.length === 0 && rows.length > 0 ? '✅' : rows.length === 0 ? '⬜' : '⚠️';
    Logger.log(`${statusIcon} ${date}: ${rows.length} partidos | ${finished.length} terminados | ${noStats.length} sin stats`);

    noStats.forEach(r => {
      Logger.log(`     → Falta: ${r.local} vs ${r.visitante} (fixture_id: ${r.fixture_id_af})`);
    });
  });

  Logger.log(`\nTOTAL: ${totalPartidos} partidos | ${totalFaltanStats} con stats incompletas`);
  Logger.log('Para cargar: ejecutar backfillWorldCupOpeningWeek()');
  Logger.log('======================');
}
