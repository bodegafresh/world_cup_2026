/**
 * EspnStats.gs
 *
 * Guarda y lee estadísticas avanzadas de ESPN para cada partido.
 * Complementa el modelo de datos con métricas que API-Football
 * no entrega en plan gratuito: pases exactos, tackles, despejes,
 * centros, tiros bloqueados, intercepciones, salidas de portero.
 *
 * También gestiona la hoja FormaEquipos con los últimos 5 partidos
 * de cada selección — insumo clave para el modelo predictivo.
 *
 * Hojas:
 *   EspnStats    — stats avanzadas por partido (1 fila por fixture)
 *   FormaEquipos — forma reciente de cada equipo (1 fila por equipo)
 */

const ESPN_STATS_HEADERS = [
  'fixture_id','espn_event_id','fecha','local','visitante',
  // Stats duplicadas (validación cruzada con API-Football)
  'posesion_local','posesion_visitante',
  'tiros_local','tiros_visitante',
  'tiros_arco_local','tiros_arco_visitante',
  'corners_local','corners_visitante',
  'faltas_local','faltas_visitante',
  'amarillas_local','amarillas_visitante',
  'rojas_local','rojas_visitante',
  // Stats nuevas — solo ESPN
  'offsides_local','offsides_visitante',
  'saves_local','saves_visitante',
  'pases_local','pases_visitante',
  'pases_precisos_local','pases_precisos_visitante',
  'centros_local','centros_visitante',
  'centros_precisos_local','centros_precisos_visitante',
  'tackles_local','tackles_visitante',
  'tackles_efectivos_local','tackles_efectivos_visitante',
  'intercepciones_local','intercepciones_visitante',
  'despejes_local','despejes_visitante',
  'tiros_bloqueados_local','tiros_bloqueados_visitante',
  'asistencia',
  'updated_at'
];

const ESPN_FORMA_HEADERS = [
  'equipo','espn_team_id',
  'ultimos_5_resultados','ultimos_5_rivales','ultimos_5_marcadores',
  'updated_at'
];

// ─── EspnStats ─────────────────────────────────────────────────────────────────

/**
 * Enriquece un fixture con datos ESPN.
 * Llama a ESPN, parsea stats y forma, guarda en hojas.
 * Safe: si ESPN no encuentra el partido, no hace nada.
 *
 * @param {Object} fixture  - fixture objeto de API-Football
 * @param {string} date     - 'yyyy-MM-dd'
 */
function saveEspnDataForFixture_(fixture, date) {
  const fixtureId = String(fixture.fixture.id);
  const homeTeam  = (fixture.teams.home || {}).name || '';
  const awayTeam  = (fixture.teams.away || {}).name || '';

  // Buscar event ID ESPN por nombre de equipo
  const espnId = findEspnEventId_(date, homeTeam, awayTeam);
  if (!espnId) {
    Logger.log(`ESPN: no match para fixture ${fixtureId} (${homeTeam} vs ${awayTeam})`);
    return;
  }

  // Si ya está guardado y el partido terminó, no re-fetchar
  const existing = getEspnStatsForFixture_(fixtureId);
  const status   = String((fixture.fixture.status || {}).short || '');
  if (existing && ['FT','AET','PEN'].includes(status)) {
    Logger.log(`ESPN fixture ${fixtureId}: ya guardado y partido finalizado, skip`);
    return;
  }

  let summary;
  try {
    summary = fetchEspnSummary_(espnId);
  } catch (e) {
    console.warn(`ESPN summary ${espnId}: ${e.message}`);
    return;
  }

  _saveEspnStats_(fixtureId, espnId, date, homeTeam, awayTeam, summary);
  _saveEspnForma_(summary);

  // Guardar árbitro usando el summary ya descargado (misma llamada, 0 cuota extra)
  try {
    const ronda = String((fixture.league || {}).round || '');
    saveRefereeFromEspnSummary_(fixtureId, date, homeTeam, awayTeam, ronda, summary);
  } catch (e_) { console.warn('ESPN referee:', e_.message); }
}

function _saveEspnStats_(fixtureId, espnId, date, homeTeam, awayTeam, summary) {
  const sheet = getOrCreateSheet_(CONFIG.SHEETS.ESPN_STATS, ESPN_STATS_HEADERS);

  const bsTeams = (summary.boxscore || {}).teams || [];
  const homeEntry = bsTeams.find(t => t.homeAway === 'home') || bsTeams[0];
  const awayEntry = bsTeams.find(t => t.homeAway === 'away') || bsTeams[1];

  if (!homeEntry || !awayEntry) return;

  const hs = parseEspnTeamStats_(homeEntry);
  const as = parseEspnTeamStats_(awayEntry);

  // Attendance from header
  const attendance = ((summary.header || {}).competitions || [{}])[0].attendance || 0;

  const row = [
    fixtureId, espnId, date, homeTeam, awayTeam,
    hs.possessionPct     || '', as.possessionPct     || '',
    hs.totalShots        || '', as.totalShots        || '',
    hs.shotsOnTarget     || '', as.shotsOnTarget     || '',
    hs.wonCorners        || '', as.wonCorners        || '',
    hs.foulsCommitted    || '', as.foulsCommitted    || '',
    hs.yellowCards       || '', as.yellowCards       || '',
    hs.redCards          || '', as.redCards          || '',
    hs.offsides          || '', as.offsides          || '',
    hs.saves             || '', as.saves             || '',
    hs.totalPasses       || '', as.totalPasses       || '',
    hs.accuratePasses    || '', as.accuratePasses    || '',
    hs.totalCrosses      || '', as.totalCrosses      || '',
    hs.accurateCrosses   || '', as.accurateCrosses   || '',
    hs.totalTackles      || '', as.totalTackles      || '',
    hs.effectiveTackles  || '', as.effectiveTackles  || '',
    hs.interceptions     || '', as.interceptions     || '',
    hs.totalClearance    || '', as.totalClearance    || '',
    hs.blockedShots      || '', as.blockedShots      || '',
    attendance,
    nowChile_()
  ];

  // Upsert por fixture_id
  const values = sheet.getDataRange().getValues();
  const fidIdx = 0;
  for (let i = 1; i < values.length; i++) {
    if (String(values[i][fidIdx]) === fixtureId) {
      sheet.getRange(i + 1, 1, 1, row.length).setValues([row]);
      Logger.log(`ESPN stats actualizado: fixture ${fixtureId}`);
      return;
    }
  }
  appendRows_(CONFIG.SHEETS.ESPN_STATS, [row]);
  Logger.log(`ESPN stats guardado: fixture ${fixtureId}`);
}

function _saveEspnForma_(summary) {
  const sheet       = getOrCreateSheet_(CONFIG.SHEETS.FORMA_EQUIPOS, ESPN_FORMA_HEADERS);
  const last5Groups = summary.lastFiveGames || [];

  if (!last5Groups.length) return;

  const values = sheet.getDataRange().getValues();
  const nameIdx = 0;

  last5Groups.forEach(teamData => {
    const team     = teamData.team || {};
    const espnTeamId = String(team.id || '');
    const nombre   = team.displayName || '';
    if (!nombre) return;

    const forma = parseEspnTeamForm_(last5Groups, espnTeamId);
    if (!forma) return;

    const row = [
      nombre, espnTeamId,
      forma.resultados, forma.rivales, forma.marcadores,
      nowChile_()
    ];

    // Upsert por nombre
    let found = false;
    for (let i = 1; i < values.length; i++) {
      if (String(values[i][nameIdx]).toLowerCase() === nombre.toLowerCase()) {
        sheet.getRange(i + 1, 1, 1, row.length).setValues([row]);
        found = true;
        break;
      }
    }
    if (!found) appendRows_(CONFIG.SHEETS.FORMA_EQUIPOS, [row]);
  });
}

// ─── Lecturas ──────────────────────────────────────────────────────────────────

/**
 * Lee las stats ESPN para un fixture dado.
 * @param {string} fixtureId
 * @returns {Object|null}
 */
function getEspnStatsForFixture_(fixtureId) {
  const rows = readAll_(CONFIG.SHEETS.ESPN_STATS);
  return rows.find(r => String(r.fixture_id) === String(fixtureId)) || null;
}

/**
 * Lee la forma reciente de un equipo.
 * @param {string} teamName
 * @returns {Object|null} { ultimos_5_resultados, ultimos_5_rivales, ultimos_5_marcadores }
 */
function getTeamForm_(teamName) {
  const rows = readAll_(CONFIG.SHEETS.FORMA_EQUIPOS);
  const norm = s => String(s || '').toLowerCase()
    .replace(/[áàä]/g,'a').replace(/[éèë]/g,'e').replace(/[íìï]/g,'i')
    .replace(/[óòö]/g,'o').replace(/[úùü]/g,'u').replace(/ñ/g,'n');

  const q = norm(teamName);
  return rows.find(r => norm(r.equipo).includes(q) || q.includes(norm(r.equipo))) || null;
}

/**
 * Formatea la forma de un equipo para incluir en análisis IA / Telegram.
 * Ejemplo: "W W D L W (France: Azerbaijan 3-1, Romania 2-0, ...)"
 * @param {string} teamName
 * @returns {string}
 */
function formatTeamFormText_(teamName) {
  const forma = getTeamForm_(teamName);
  if (!forma) return '';

  const results  = String(forma.ultimos_5_resultados || '').split(',');
  const rivals   = String(forma.ultimos_5_rivales    || '').split(',');
  const scores   = String(forma.ultimos_5_marcadores || '').split(',');

  const formStr = results.join(' ');
  const details = rivals.map((r, i) => `${r} ${scores[i] || ''}`).join(', ');

  return `${formStr} — últimos 5: ${details}`;
}

/**
 * Genera texto de stats avanzadas ESPN para un fixture terminado.
 * Usado en resúmenes post-partido.
 * @param {string} fixtureId
 * @returns {string}
 */
function formatEspnStatsText_(fixtureId) {
  const s = getEspnStatsForFixture_(fixtureId);
  if (!s) return '';

  const home = s.local || 'Local';
  const away = s.visitante || 'Visitante';

  let lines = [`📊 <b>Stats Avanzadas</b> (ESPN)\n`];
  lines.push(`🏃 Pases: <code>${home} ${s.pases_precisos_local}/${s.pases_local} — ${away} ${s.pases_precisos_visitante}/${s.pases_visitante}</code>`);
  lines.push(`🎯 Centros: <code>${home} ${s.centros_precisos_local}/${s.centros_local} — ${away} ${s.centros_precisos_visitante}/${s.centros_visitante}</code>`);
  lines.push(`🛡️ Tackles: <code>${home} ${s.tackles_efectivos_local}/${s.tackles_local} — ${away} ${s.tackles_efectivos_visitante}/${s.tackles_visitante}</code>`);
  lines.push(`✊ Despejes: <code>${home} ${s.despejes_local} — ${away} ${s.despejes_visitante}</code>`);
  lines.push(`⛔ Intercepciones: <code>${home} ${s.intercepciones_local} — ${away} ${s.intercepciones_visitante}</code>`);
  lines.push(`🚩 Offsides: <code>${home} ${s.offsides_local} — ${away} ${s.offsides_visitante}</code>`);
  if (s.saves_local !== '' || s.saves_visitante !== '') {
    lines.push(`🧤 Atajadas: <code>${home} ${s.saves_local} — ${away} ${s.saves_visitante}</code>`);
  }
  if (s.asistencia && Number(s.asistencia) > 0) {
    lines.push(`🏟️ Asistencia: <code>${Number(s.asistencia).toLocaleString()}</code>`);
  }

  return lines.join('\n');
}

/**
 * Extrae eventos individuales (goles, asistencias, tarjetas) del summary ESPN
 * y los guarda TEMPORALMENTE en ResumenJugadorPartido usando "espn_XXXXX" como jugador_id.
 *
 * Solo se llama cuando no hay fixture_id_af (path ESPN).
 * Cuando llegue el fixture_id_af real y se carguen datos de API-Football,
 * savePlayerSummaryFromEvents_ escribe filas con IDs reales que el frontend prioriza.
 */
function saveEspnPlayerEventsToResumen_(fixtureId, summary) {
  const map = {};

  const upsert = (espnAthId, name, teamEspnId, teamName) => {
    const pid = 'espn_' + espnAthId;
    if (!map[pid]) map[pid] = {
      fixture_id:  fixtureId,
      jugador_id:  pid,
      jugador:     name || '',
      equipo_id:   teamEspnId ? 'espn_' + teamEspnId : '',
      equipo:      teamNameToSpanish_(teamName || ''),
      goles: 0, asistencias: 0, amarillas: 0, rojas: 0, minutos: 0
    };
    return map[pid];
  };

  // Goles y asistencias desde header.competitions[0].details
  const comp = ((summary.header || {}).competitions || [])[0] || {};
  (comp.details || []).forEach(detail => {
    const typeText = String((detail.type || {}).text || '').toLowerCase();
    const isGoal = typeText.includes('goal') || typeText.includes('penalty - scored');
    const isCard = typeText.includes('yellow card') || typeText.includes('red card') || typeText.includes('second yellow');
    if (!isGoal && !isCard) return;

    const teamId   = String((detail.team || {}).id || '');
    const teamName = String((detail.team || {}).displayName || '');
    const athletes = Array.isArray(detail.athletesInvolved) ? detail.athletesInvolved : [];

    if (isGoal) {
      if (athletes[0] && athletes[0].id) {
        const p = upsert(athletes[0].id, athletes[0].displayName || athletes[0].shortName, teamId, teamName);
        if (!typeText.includes('own')) p.goles++;
      }
      if (athletes[1] && athletes[1].id) {
        upsert(athletes[1].id, athletes[1].displayName || athletes[1].shortName, teamId, teamName).asistencias++;
      }
    }
    if (isCard && athletes[0] && athletes[0].id) {
      const p = upsert(athletes[0].id, athletes[0].displayName || athletes[0].shortName, teamId, teamName);
      if (typeText.includes('red') || typeText.includes('second yellow')) p.rojas++;
      else p.amarillas++;
    }
  });

  // Tarjetas desde plays como fallback si details no las tiene
  (summary.plays || summary.keyEvents || []).forEach(play => {
    const typeText = String((play.type || {}).text || '').toLowerCase();
    if (!typeText.includes('yellow') && !typeText.includes('red card')) return;
    const athletes = Array.isArray(play.athletes) ? play.athletes : (play.athlete ? [play.athlete] : []);
    const teamId   = String((play.team || {}).id || '');
    const teamName = String((play.team || {}).displayName || '');
    athletes.slice(0, 1).forEach(a => {
      const ath = a.athlete || a;
      if (!ath || !ath.id) return;
      const p = upsert(ath.id, ath.displayName || ath.shortName, teamId, teamName);
      if (typeText.includes('red')) { if (!p.rojas) p.rojas++; }
      else { if (!p.amarillas) p.amarillas++; }
    });
  });

  const rows = Object.values(map);
  if (!rows.length) return;

  const sheet = getOrCreateSheet_(CONFIG.SHEETS.RESUMEN_JUGADOR_PARTIDO,
    ['fixture_id','jugador_id','jugador','equipo_id','equipo','goles','asistencias','amarillas','rojas','minutos','updated_at']);
  const existing = sheet.getDataRange().getValues();
  const existingKeys = new Set();
  if (existing.length > 1) {
    const h   = existing[0];
    const fi  = h.indexOf('fixture_id');
    const pi  = h.indexOf('jugador_id');
    existing.slice(1).forEach(r => existingKeys.add(r[fi] + '_' + r[pi]));
  }

  const toSave = rows
    .filter(r => !existingKeys.has(r.fixture_id + '_' + r.jugador_id))
    .map(r => [r.fixture_id, r.jugador_id, r.jugador, r.equipo_id, r.equipo,
               r.goles, r.asistencias, r.amarillas, r.rojas, r.minutos, nowChile_()]);

  if (toSave.length) {
    appendRows_(CONFIG.SHEETS.RESUMEN_JUGADOR_PARTIDO, toSave);
    Logger.log('saveEspnPlayerEventsToResumen_: ' + toSave.length + ' filas (temp) para fixture ' + fixtureId);
  }
}

