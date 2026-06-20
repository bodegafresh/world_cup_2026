/**
 * TodayDataRepair.gs
 *
 * Reparaciones idempotentes para correr después de los jobs diarios o manualmente.
 * No migra datos ni consume API-Football salvo que otra función llamada lo haga.
 */

function addDaysChile_(dateStr, days) {
  const parts = String(dateStr || todayChile_()).split('-').map(Number);
  const d = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2] + Number(days || 0), 12, 0, 0));
  return Utilities.formatDate(d, CONFIG.TIMEZONE, 'yyyy-MM-dd');
}

function isOperationalReportDate_(row, date) {
  const fecha = normalizeFecha_(row.fecha);
  if (fecha === date) return true;

  // Los partidos a las 00:00 Chile pertenecen operacionalmente al bloque del día anterior.
  const nextDate = addDaysChile_(date, 1);
  return fecha === nextDate && normalizeHora_(row.hora_chile || row.hora) === '00:00';
}

function getOperationalFixturesForDate_(date) {
  return readAll_(CONFIG.SHEETS.PARTIDOS)
    .filter(r => isOperationalReportDate_(r, date))
    .sort((a, b) => {
      const fa = normalizeFecha_(a.fecha) || '';
      const fb = normalizeFecha_(b.fecha) || '';
      const ha = normalizeHora_(a.hora_chile || a.hora) || '';
      const hb = normalizeHora_(b.hora_chile || b.hora) || '';
      return (fa + ' ' + ha).localeCompare(fb + ' ' + hb);
    });
}

function buildFixtureFromPartidosRow_(r) {
  const fixtureId = r.fixture_id_af || r.fixture_id_api_football || r.match_key || r.match_id ||
    buildMatchKeyFromRow_(r);
  const venueName = r.estadio || r.venue || '';
  const city = normalizeVenueCityForCatalog_(r.ciudad || r.city || '');

  return {
    fixture: {
      id: fixtureId,
      date: normalizeFecha_(r.fecha) || r.fecha || '',
      venue: {
        id: r.venue_id || '',
        name: venueName,
        city: city
      },
      status: { short: String(r.status || r.estado || '').toUpperCase() }
    },
    teams: {
      home: { name: r.local || r.home || '' },
      away: { name: r.visitante || r.away || '' }
    },
    league: {
      country: r.pais_torneo || r.pais || 'World',
      round: r.ronda || r.fase || ''
    },
    goals: {
      home: r.goles_local,
      away: r.goles_visitante
    }
  };
}

function normalizeVenueCityForCatalog_(city) {
  return String(city || '').split(',')[0].trim();
}

function buildMatchKeyFromRow_(r) {
  const date = normalizeFecha_(r.fecha) || '';
  return [
    date,
    normalizeMatchToken_(r.local || r.home || ''),
    normalizeMatchToken_(r.visitante || r.away || '')
  ].join('_');
}

function normalizeMatchToken_(value) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]/g, '');
}

function repairTodaySourceData() {
  const date = todayChile_();
  Logger.log('repairTodaySourceData: inicio ' + date);

  try { limpiarDuplicadosPartidos(); } catch (e) { console.warn('repair dup Partidos:', e.message); }

  const fixtures = getOperationalFixturesForDate_(date);
  Logger.log('repairTodaySourceData: fixtures operacionales=' + fixtures.length);

  fixtures.forEach(r => {
    const fixture = buildFixtureFromPartidosRow_(r);
    try {
      const weather = fetchWeatherForFixture_(fixture);
      if (weather.source !== 'cache') saveWeatherForFixture_(fixture, weather);
    } catch (e) {
      console.warn('repair weather ' + fixture.fixture.id + ': ' + e.message);
    }
    Utilities.sleep(300);
  });

  // Completa stats/lineups gratis desde ESPN para partidos terminados recientes.
  [yesterdayChile_(), date].forEach(d => {
    readAll_(CONFIG.SHEETS.PARTIDOS)
      .filter(r => normalizeFecha_(r.fecha) === d)
      .filter(r => ['FT','AET','PEN'].includes(String(r.status || '').toUpperCase()))
      .forEach(r => {
        try { saveEspnDataForFixture_(buildFixtureFromPartidosRow_(r), d); }
        catch (e) { console.warn('repair ESPN ' + buildMatchKeyFromRow_(r) + ': ' + e.message); }
        Utilities.sleep(300);
      });
  });

  // Orden correcto: primero tabla, después simulación.
  try { recalcularTablaDesdePartidos(); } catch (e) { console.warn('repair tabla:', e.message); }
  try { initializeEloRatings(); } catch (e) { console.warn('repair elo defaults:', e.message); }
  try { runGroupSimulation(); } catch (e) { console.warn('repair sim:', e.message); }
  try { refreshDashboard(); } catch (e) { console.warn('repair dashboard:', e.message); }

  Logger.log('repairTodaySourceData: fin');
}

function cronTodayDataRepair() {
  runWithHealthCheck_('cronTodayDataRepair', () => repairTodaySourceData());
}
