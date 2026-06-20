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
  return isOperationalNextDayFixture_(row, date);
}

function isOperationalNextDayFixture_(row, date) {
  const fecha = normalizeFecha_(row.fecha);
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

  try { repairPlayerStatsForDate_(yesterdayChile_()); } catch (e) { console.warn('repair player stats:', e.message); }

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

function repairPlayerStatsForDate_(date) {
  const finished = readAll_(CONFIG.SHEETS.PARTIDOS)
    .filter(r => normalizeFecha_(r.fecha) === date)
    .filter(r => ['FT','AET','PEN'].includes(String(r.status || '').toUpperCase()));

  Logger.log('repairPlayerStatsForDate_: ' + date + ' partidos terminados=' + finished.length);

  finished.forEach(r => {
    const fixture = buildFixtureFromPartidosRow_(r);
    const fixtureId = String(r.fixture_id_af || r.fixture_id_api_football || '').trim();

    if (fixtureId) {
      try {
        loadPlayerStatsForFixture_(fixtureId, fixture);
      } catch (e) {
        console.warn('official player stats ' + fixtureId + ': ' + e.message);
      }
      Utilities.sleep(500);
    } else {
      Logger.log('repairPlayerStatsForDate_: sin fixture_id oficial para ' + r.local + ' vs ' + r.visitante + ' — fallback ESPN');
    }

    try { saveEspnFallbackPlayerContext_(fixture, date); }
    catch (e) { console.warn('ESPN player fallback ' + fixture.fixture.id + ': ' + e.message); }
    Utilities.sleep(400);
  });
}

function repairRecentOfficialPlayerStats_(daysBack, maxOfficialFixtures) {
  const days = Number(daysBack || 7);
  const maxFixtures = Number(maxOfficialFixtures || 8);
  let officialAttempts = 0;

  for (let i = 1; i <= days; i++) {
    const date = addDaysChile_(todayChile_(), -i);
    const finished = readAll_(CONFIG.SHEETS.PARTIDOS)
      .filter(r => normalizeFecha_(r.fecha) === date)
      .filter(r => ['FT','AET','PEN'].includes(String(r.status || '').toUpperCase()));

    finished.forEach(r => {
      const fixture = buildFixtureFromPartidosRow_(r);
      const fixtureId = String(r.fixture_id_af || r.fixture_id_api_football || '').trim();
      if (fixtureId && officialAttempts < maxFixtures) {
        try {
          loadPlayerStatsForFixture_(fixtureId, fixture);
          officialAttempts++;
        } catch (e) {
          console.warn('weekly official player stats ' + fixtureId + ': ' + e.message);
        }
        Utilities.sleep(500);
      }

      try { saveEspnFallbackPlayerContext_(fixture, date); } catch(e_) {}
      Utilities.sleep(250);
    });
  }

  Logger.log('repairRecentOfficialPlayerStats_: official attempts=' + officialAttempts + '/' + maxFixtures);
}

function saveEspnFallbackPlayerContext_(fixture, date) {
  const fixtureId = String(fixture.fixture.id || '');
  const homeTeam = (fixture.teams.home || {}).name || '';
  const awayTeam = (fixture.teams.away || {}).name || '';
  const espnId = findEspnEventId_(date, homeTeam, awayTeam);
  if (!espnId) {
    Logger.log('saveEspnFallbackPlayerContext_: sin ESPN id para ' + homeTeam + ' vs ' + awayTeam);
    return;
  }

  const summary = fetchEspnSummary_(espnId);
  _saveEspnStats_(fixtureId, espnId, date, homeTeam, awayTeam, summary);
  _saveEspnLineupsToSheet_(fixtureId, espnId, homeTeam, awayTeam, summary);
  _saveEspnForma_(summary);
  try { _saveEspnRostersAsPlayers_(summary, homeTeam, awayTeam); } catch(e_) {}
  saveEspnPlayerEventsToResumen_(fixtureId, summary);
}

function auditOfficialPlayerStatsCoverage() {
  const finished = readAll_(CONFIG.SHEETS.PARTIDOS)
    .filter(r => ['FT','AET','PEN'].includes(String(r.status || '').toUpperCase()));
  const pms = readAll_(CONFIG.SHEETS.PLAYER_MATCH_STATS);
  const resumen = readAll_(CONFIG.SHEETS.RESUMEN_JUGADOR_PARTIDO);
  const pmsFixtures = new Set(pms.map(r => String(r.fixture_id || '')));
  const resumenFixtures = new Set(resumen.map(r => String(r.fixture_id || '')));

  Logger.log('=== AUDIT PLAYER STATS COVERAGE ===');
  finished.forEach(r => {
    const officialId = String(r.fixture_id_af || r.fixture_id_api_football || '').trim();
    const fallbackId = String(r.match_key || r.match_id || '').trim();
    const hasOfficial = officialId && pmsFixtures.has(officialId);
    const hasResumen = (officialId && resumenFixtures.has(officialId)) || (fallbackId && resumenFixtures.has(fallbackId));
    Logger.log([
      hasOfficial ? '✅ API' : (officialId ? '❌ API_MISSING' : '⚠️ NO_OFFICIAL_ID'),
      hasResumen ? '✅ RESUMEN' : '❌ NO_RESUMEN',
      normalizeFecha_(r.fecha),
      r.local + ' vs ' + r.visitante,
      'official_id=' + (officialId || 'NULL'),
      'fallback_id=' + (fallbackId || 'NULL')
    ].join(' | '));
  });
}

function auditPlayerStatsConsistency() {
  return playerStatsConsistency_(false);
}

function repairPlayerStatsConsistency() {
  return playerStatsConsistency_(true);
}

function playerStatsConsistency_(applyFix) {
  const fixtureIndex = buildPlayerStatsFixtureIndex_();
  const result = {
    mode: applyFix ? 'repair' : 'audit',
    player_match_stats: auditStatsSheetByFixtureTeam_(
      CONFIG.SHEETS.PLAYER_MATCH_STATS,
      'fixture_id',
      'team_name',
      ['fixture_id', 'player_id'],
      fixtureIndex,
      applyFix
    ),
    resumen_jugador_partido: auditStatsSheetByFixtureTeam_(
      CONFIG.SHEETS.RESUMEN_JUGADOR_PARTIDO,
      'fixture_id',
      'equipo',
      ['fixture_id', 'jugador_id'],
      fixtureIndex,
      applyFix
    )
  };

  Logger.log('playerStatsConsistency_: ' + JSON.stringify(result));
  return result;
}

function buildPlayerStatsFixtureIndex_() {
  const index = {};
  readAll_(CONFIG.SHEETS.PARTIDOS).forEach(r => {
    const teams = [
      normalizeTeamNameStrong_(teamNameToSpanish_(r.local || '')),
      normalizeTeamNameStrong_(teamNameToSpanish_(r.visitante || ''))
    ].filter(Boolean);
    [r.fixture_id_api_football, r.fixture_id_af, r.match_id, r.match_key].forEach(fid => {
      fid = String(fid || '').trim();
      if (!fid) return;
      index[fid] = { teams: teams, match_key: r.match_key || '', fecha: normalizeFecha_(r.fecha) };
    });
  });
  return index;
}

function auditStatsSheetByFixtureTeam_(sheetName, fixtureCol, teamCol, keyCols, fixtureIndex, applyFix) {
  const sheet = getSheet_(sheetName);
  const values = sheet.getDataRange().getValues();
  if (values.length <= 1) return { rows: 0, duplicates: 0, invalid_fixture: 0, team_mismatch: 0, deleted: 0 };

  const headers = values[0];
  const idx = name => headers.indexOf(name);
  const fixtureIdx = idx(fixtureCol);
  const teamIdx = idx(teamCol);
  const keyIdxs = keyCols.map(idx);
  if (fixtureIdx === -1 || teamIdx === -1 || keyIdxs.some(i => i === -1)) {
    Logger.log('auditStatsSheetByFixtureTeam_: columnas faltantes en ' + sheetName);
    return { rows: values.length - 1, error: 'missing_columns' };
  }

  const seen = {};
  const deleteRows = [];
  let duplicates = 0;
  let invalidFixture = 0;
  let teamMismatch = 0;

  values.slice(1).forEach((row, offset) => {
    const rowNum = offset + 2;
    const fixtureId = String(row[fixtureIdx] || '').trim();
    const key = keyIdxs.map(i => String(row[i] || '').trim()).join('_');
    const teamKey = normalizeTeamNameStrong_(teamNameToSpanish_(row[teamIdx] || ''));

    if (key && seen[key]) {
      duplicates++;
      deleteRows.push(rowNum);
      Logger.log('DUP ' + sheetName + ' row=' + rowNum + ' key=' + key);
      return;
    }
    if (key) seen[key] = true;

    if (!fixtureId || fixtureId.indexOf('espn_') === 0) return;
    const fixture = fixtureIndex[fixtureId];
    if (!fixture) {
      invalidFixture++;
      deleteRows.push(rowNum);
      Logger.log('INVALID_FIXTURE ' + sheetName + ' row=' + rowNum + ' fixture_id=' + fixtureId);
      return;
    }
    if (teamKey && fixture.teams.indexOf(teamKey) === -1) {
      teamMismatch++;
      deleteRows.push(rowNum);
      Logger.log('TEAM_MISMATCH ' + sheetName + ' row=' + rowNum + ' fixture_id=' + fixtureId + ' team=' + row[teamIdx]);
    }
  });

  if (applyFix && deleteRows.length) {
    deleteRows.sort((a, b) => b - a).forEach(rowNum => sheet.deleteRow(rowNum));
  }

  return {
    rows: values.length - 1,
    duplicates: duplicates,
    invalid_fixture: invalidFixture,
    team_mismatch: teamMismatch,
    deleted: applyFix ? deleteRows.length : 0
  };
}

function backfillMissingApiFootballFixtureIds() {
  return backfillMissingApiFootballFixtureIdsForDates_([yesterdayChile_(), todayChile_()]);
}

function backfillMissingApiFootballFixtureIdsForDate(date) {
  return backfillMissingApiFootballFixtureIdsForDates_([date]);
}

function backfillMissingApiFootballFixtureIdsForDates_(dates) {
  Logger.log('backfillMissingApiFootballFixtureIdsForDates_: inicio ' + dates.join(', '));

  let official = [];
  dates.forEach(date => {
    try {
      const data = fetchFixturesByDate_(date); // 1 request por fecha; funciona en plan gratis para día puntual
      const fixtures = (data.response || []).filter(isLikelyWorldCup2026Fixture_);
      Logger.log('  API-Football date=' + date + ' fixtures=' + fixtures.length);
      official = official.concat(fixtures.map(apiFootballFixtureToCandidate_));
      Utilities.sleep(350);
    } catch (e) {
      console.warn('backfill ids date ' + date + ': ' + e.message);
    }
  });

  official = official.filter(f => f.id);
  if (!official.length) {
    Logger.log('backfillMissingApiFootballFixtureIdsForDates_: sin candidatos oficiales.');
    return { updated: 0, unresolved: 0, candidates: 0 };
  }

  const sheet = getSheet_(CONFIG.SHEETS.PARTIDOS);
  const values = sheet.getDataRange().getValues();
  if (values.length <= 1) return;

  const headers = values[0];
  const idx = name => headers.indexOf(name);
  const idIdx = idx('fixture_id_api_football');
  const matchIdIdx = idx('match_id');
  const sourceCountIdx = idx('sources_count');
  const sourcesUsedIdx = idx('sources_used');
  const lastValidatedIdx = idx('last_validated_at');
  const notesIdx = idx('data_quality_notes');
  if (idIdx === -1) {
    Logger.log('backfillMissingApiFootballFixtureIds: falta columna fixture_id_api_football.');
    return;
  }

  let updated = 0;
  let unresolved = 0;

  values.slice(1).forEach((row, offset) => {
    const rowNum = offset + 2;
    if (String(row[idIdx] || '').trim()) return;

    const local = row[idx('local')] || '';
    const visitante = row[idx('visitante')] || '';
    if (isKnockoutPlaceholderTeam_(local) || isKnockoutPlaceholderTeam_(visitante)) return;

    const fecha = normalizeFecha_(row[idx('fecha')]) || normalizeFecha_(row[idx('fecha_chile')]);
    if (!fecha) return;

    const match = findBestApiFootballFixtureMatch_(row, headers, official);
    if (!match || match.score < 0.86) {
      unresolved++;
      if (notesIdx !== -1) {
        const prev = String(row[notesIdx] || '');
        sheet.getRange(rowNum, notesIdx + 1).setValue((prev ? prev + ' | ' : '') + 'NO_API_FOOTBALL_ID_MATCH');
      }
      Logger.log('  sin match confiable: ' + local + ' vs ' + visitante + ' ' + fecha + ' score=' + (match ? match.score : 0));
      return;
    }

    sheet.getRange(rowNum, idIdx + 1).setValue(match.fixture.id);
    if (matchIdIdx !== -1 && !String(row[matchIdIdx] || '').trim()) sheet.getRange(rowNum, matchIdIdx + 1).setValue(match.fixture.id);
    if (sourcesUsedIdx !== -1) {
      const used = new Set(String(row[sourcesUsedIdx] || '').split(',').map(s => s.trim()).filter(Boolean));
      used.add('API_FOOTBALL');
      sheet.getRange(rowNum, sourcesUsedIdx + 1).setValue(Array.from(used).join(','));
    }
    if (sourceCountIdx !== -1) {
      const usedCount = sourcesUsedIdx !== -1
        ? String(sheet.getRange(rowNum, sourcesUsedIdx + 1).getValue() || '').split(',').filter(Boolean).length
        : Number(row[sourceCountIdx] || 0) + 1;
      sheet.getRange(rowNum, sourceCountIdx + 1).setValue(usedCount);
    }
    if (lastValidatedIdx !== -1) sheet.getRange(rowNum, lastValidatedIdx + 1).setValue(nowChile_());
    if (notesIdx !== -1) sheet.getRange(rowNum, notesIdx + 1).setValue('API_FOOTBALL_ID_BACKFILLED score=' + match.score.toFixed(2));
    updated++;
    Logger.log('  OK ' + local + ' vs ' + visitante + ' → fixture_id_api_football=' + match.fixture.id + ' score=' + match.score.toFixed(2));
  });

  Logger.log('backfillMissingApiFootballFixtureIdsForDates_: actualizados=' + updated + ' sin_match=' + unresolved + ' candidatos=' + official.length);
  return { updated, unresolved, candidates: official.length };
}

function apiFootballFixtureToCandidate_(f) {
  return {
    id: String(f.fixture && f.fixture.id || ''),
    dateUtc: String(f.fixture && f.fixture.date || '').substring(0, 10),
    dateChile: f.fixture && f.fixture.date ? Utilities.formatDate(new Date(f.fixture.date), CONFIG.TIMEZONE, 'yyyy-MM-dd') : '',
    home: (f.teams && f.teams.home && f.teams.home.name) || '',
    away: (f.teams && f.teams.away && f.teams.away.name) || '',
    venue: (f.fixture && f.fixture.venue && f.fixture.venue.name) || '',
    city: (f.fixture && f.fixture.venue && f.fixture.venue.city) || ''
  };
}

function isLikelyWorldCup2026Fixture_(fixture) {
  if (isWorldCupFixture_(fixture)) return true;

  const league = fixture && fixture.league || {};
  const seasonOk = !league.season || Number(league.season) === CONFIG.API_FOOTBALL.SEASON;
  const leagueName = String(league.name || '').toLowerCase();
  const country = String(league.country || '').toLowerCase();
  if (seasonOk && leagueName.includes('world cup')) return true;
  if (seasonOk && country === 'world' && leagueName.includes('cup')) return true;

  const known = buildKnownWorldCupTeamSet_();
  const home = normalizeTeamNameStrong_((fixture.teams && fixture.teams.home && fixture.teams.home.name) || '');
  const away = normalizeTeamNameStrong_((fixture.teams && fixture.teams.away && fixture.teams.away.name) || '');
  return known.has(home) && known.has(away);
}

function buildKnownWorldCupTeamSet_() {
  const teams = new Set();
  try {
    Object.keys(WC2026_GROUPS || {}).forEach(name => teams.add(normalizeTeamNameStrong_(name)));
  } catch(e_) {}
  try {
    readAll_(CONFIG.SHEETS.CLASIFICACION).forEach(r => teams.add(normalizeTeamNameStrong_(r.equipo || '')));
  } catch(e_) {}
  try {
    readAll_(CONFIG.SHEETS.PARTIDOS).forEach(r => {
      if (!isKnockoutPlaceholderTeam_(r.local)) teams.add(normalizeTeamNameStrong_(r.local || ''));
      if (!isKnockoutPlaceholderTeam_(r.visitante)) teams.add(normalizeTeamNameStrong_(r.visitante || ''));
    });
  } catch(e_) {}
  return teams;
}

function findBestApiFootballFixtureMatch_(row, headers, officialFixtures) {
  const idx = name => headers.indexOf(name);
  const fecha = normalizeFecha_(row[idx('fecha')]) || normalizeFecha_(row[idx('fecha_chile')]);
  const local = row[idx('local')] || '';
  const visitante = row[idx('visitante')] || '';
  const venue = row[idx('estadio')] || '';
  const city = row[idx('ciudad')] || '';

  let best = null;
  officialFixtures.forEach(f => {
    let score = 0;
    if (fecha && (f.dateChile === fecha || f.dateUtc === fecha)) score += 0.30;
    else if (fecha && Math.abs(new Date((f.dateChile || f.dateUtc) + 'T12:00:00Z') - new Date(fecha + 'T12:00:00Z')) <= 86400000) score += 0.10;

    const homeScore = teamNameMatches_(f.home, local) ? 0.28 : 0;
    const awayScore = teamNameMatches_(f.away, visitante) ? 0.28 : 0;
    const reversedHome = teamNameMatches_(f.home, visitante) ? 0.18 : 0;
    const reversedAway = teamNameMatches_(f.away, local) ? 0.18 : 0;
    score += Math.max(homeScore + awayScore, reversedHome + reversedAway);

    if (venue && normalizeVenueKey_(venue) && normalizeVenueKey_(f.venue) === normalizeVenueKey_(venue)) score += 0.10;
    if (city && normalizeVenueKey_(city).includes(normalizeVenueKey_(f.city))) score += 0.04;

    if (!best || score > best.score) best = { fixture: f, score };
  });
  return best;
}
