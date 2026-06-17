/**
 * GoalScorerModel.gs
 *
 * Modelo de predicción de goleadores para mercado "anytime scorer".
 *
 * Fundamento matemático:
 *   P(jugador X anota ≥ 1) = 1 − e^(−λ_X)
 *   λ_X = λ_equipo × participación_X_en_goles_torneo
 *
 * La participación se calcula desde ResumenJugadorPartido acumulado.
 * Si el jugador no tiene partidos → tasa base según posición.
 * Se pondera opcionalmente con xG acumulado de SofaStats.
 *
 * Hoja de salida: GoalScorerOdds
 * Headers: match_key, fecha, jugador, equipo, posicion, goles_torneo,
 *          asistencias_torneo, xg_torneo, participacion_goles,
 *          lambda_player, prob_anotar_pct, cuota_fair, updated_at
 *
 * Comandos del bot:
 *   /goleador <Equipo>           → top goleadores probables del equipo
 *   /goleador partido <Equipo>   → probables anotadores en próximo partido
 */

// ─── Tasas base por posición (sin datos del torneo) ───────────────────────────

const SCORER_BASE_RATE = {
  'Delantero':      0.35,
  'Mediocampista':  0.15,
  'Defensa':        0.05,
  'Portero':        0.01,
  'default':        0.10
};

// Peso de asistencias al calcular participación en goles
const SCORER_ASSIST_WEIGHT = 0.3;

// Peso del xG en el blend con participación estadística (0=solo stats, 1=solo xG)
const SCORER_XG_BLEND = 0.35;

// Nombre de la hoja de salida
const SHEET_GOAL_SCORER_ODDS = 'GoalScorerOdds';

// ─── 1. buildGoalScorerStrengths_ ─────────────────────────────────────────────

/**
 * Lee ResumenJugadorPartido, agrupa por jugador del equipo indicado y calcula
 * la participación en goles (contribución relativa al total del equipo).
 *
 * @param {string} teamName  Nombre del equipo en español (normalizado)
 * @returns {Object}  { jugador: { goles, asistencias, participacion, posicion, xg } }
 */
function buildGoalScorerStrengths_(teamName) {
  const norm = s => String(s || '').trim().toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '');

  const teamNorm = norm(teamNameToSpanish_(teamName));

  // Leer stats acumuladas del torneo
  const rows = readAll_(CONFIG.SHEETS.RESUMEN_JUGADOR_PARTIDO);

  const players = {};  // key = nombre jugador

  rows.forEach(r => {
    const equipoNorm = norm(teamNameToSpanish_(r.equipo || ''));
    if (!equipoNorm.includes(teamNorm) && !teamNorm.includes(equipoNorm)) return;

    const nombre = String(r.jugador || r.nombre || '').trim();
    if (!nombre) return;

    if (!players[nombre]) {
      players[nombre] = {
        nombre,
        equipo: r.equipo || teamName,
        goles: 0,
        asistencias: 0,
        xg: 0,
        posicion: r.posicion || r.position || 'default',
        partidos: 0
      };
    }
    players[nombre].goles       += Number(r.goles       || 0);
    players[nombre].asistencias += Number(r.asistencias || 0);
    players[nombre].xg          += Number(r.xg          || r.expected_goals || 0);
    players[nombre].partidos    += 1;
  });

  // Intentar completar posición desde Planteles si falta
  let plantelRows = [];
  try { plantelRows = readAll_(CONFIG.SHEETS.PLANTELES); } catch(e_) {}
  plantelRows.forEach(p => {
    const equipoNorm = norm(teamNameToSpanish_(p.equipo || p.seleccion || ''));
    if (!equipoNorm.includes(teamNorm) && !teamNorm.includes(equipoNorm)) return;
    const nombre = String(p.nombre || p.jugador || '').trim();
    if (players[nombre] && players[nombre].posicion === 'default') {
      players[nombre].posicion = p.posicion || p.position || 'default';
    }
    // Agregar jugadores del plantel que no tienen stats aún (partidos = 0)
    if (!players[nombre] && nombre) {
      players[nombre] = {
        nombre,
        equipo: p.equipo || p.seleccion || teamName,
        goles: 0,
        asistencias: 0,
        xg: 0,
        posicion: p.posicion || p.position || 'default',
        partidos: 0
      };
    }
  });

  // Intentar enriquecer xG desde SofaStats
  try {
    const sofaRows = readAll_(CONFIG.SHEETS.SOFA_STATS);
    sofaRows.forEach(s => {
      const equipoNorm = norm(teamNameToSpanish_(s.equipo || s.team || ''));
      if (!equipoNorm.includes(teamNorm) && !teamNorm.includes(equipoNorm)) return;
      const nombre = String(s.jugador || s.player || '').trim();
      if (players[nombre]) {
        players[nombre].xg += Number(s.xg || s.expected_goals || 0);
      }
    });
  } catch(e_) {}

  // Calcular total de contribución del equipo (goles + asistencias ponderadas)
  let totalContrib = 0;
  Object.values(players).forEach(p => {
    totalContrib += p.goles + p.asistencias * SCORER_ASSIST_WEIGHT;
  });

  // Calcular participación de cada jugador
  Object.values(players).forEach(p => {
    const contrib = p.goles + p.asistencias * SCORER_ASSIST_WEIGHT;
    if (totalContrib > 0 && p.partidos > 0) {
      p.participacion = contrib / totalContrib;
    } else {
      // Sin datos → tasa base por posición
      const posKey = _normalizarPosicion_(p.posicion);
      p.participacion = SCORER_BASE_RATE[posKey] || SCORER_BASE_RATE['default'];
    }
  });

  return players;
}

// ─── 2. predictScorerProbability_ ─────────────────────────────────────────────

/**
 * Calcula P(jugador anota ≥ 1 en el partido) usando modelo Poisson.
 *
 * @param {string} playerName
 * @param {string} teamName
 * @param {number} lambdaTeam   λ del equipo para este partido (de PoissonModel)
 * @param {Object} [strengths]  resultado de buildGoalScorerStrengths_(teamName)
 * @returns {{ prob_anotar: number, lambda_player: number, confianza: string }}
 */
function predictScorerProbability_(playerName, teamName, lambdaTeam, strengths) {
  if (!strengths) strengths = buildGoalScorerStrengths_(teamName);

  const norm = s => String(s || '').trim().toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '');

  const pNorm = norm(playerName);

  // Buscar jugador (coincidencia exacta primero, luego parcial)
  let player = strengths[playerName]
    || Object.values(strengths).find(p => norm(p.nombre) === pNorm)
    || Object.values(strengths).find(p => norm(p.nombre).includes(pNorm) || pNorm.includes(norm(p.nombre)));

  let participacion, confianza, xg;

  if (player) {
    participacion = player.participacion;
    xg            = player.xg;
    confianza     = player.partidos > 0 ? (player.partidos >= 3 ? 'alta' : 'media') : 'baja';
  } else {
    // Jugador desconocido → tasa default
    participacion = SCORER_BASE_RATE['default'];
    xg            = 0;
    confianza     = 'baja';
  }

  // λ_player base desde participación
  let lambdaPlayer = lambdaTeam * participacion;

  // Ajuste opcional con xG acumulado normalizado
  if (xg > 0 && player && player.partidos > 0) {
    const xgPerGame  = xg / player.partidos;
    // xG por partido es directamente comparable a λ_player
    lambdaPlayer = lambdaPlayer * (1 - SCORER_XG_BLEND) + xgPerGame * SCORER_XG_BLEND;
  }

  // Clamp razonable
  lambdaPlayer = Math.max(0.001, Math.min(lambdaPlayer, 3.0));

  // P(anotar ≥ 1) = 1 − P(0) = 1 − e^(−λ)
  const probAnotar = 1 - Math.exp(-lambdaPlayer);

  return {
    prob_anotar:   probAnotar,
    lambda_player: lambdaPlayer,
    confianza
  };
}

// ─── 3. buildTeamScorerRanking_ ───────────────────────────────────────────────

/**
 * Genera ranking de probables anotadores de un equipo para un partido.
 *
 * @param {string} teamName
 * @param {string} opponent
 * @param {string} [matchKey]
 * @param {boolean} [isHome]
 * @returns {Array}  Array de jugadores ordenados por prob_anotar desc
 */
function buildTeamScorerRanking_(teamName, opponent, matchKey, isHome) {
  const teamEs = teamNameToSpanish_(teamName);
  const oppEs  = teamNameToSpanish_(opponent);

  // Obtener λ del equipo desde PoissonModel
  let lambdaTeam = 1.3; // fallback histórico mundiales
  try {
    const poissonData = isHome
      ? getPoissonOdds_(teamEs, oppEs, matchKey)
      : getPoissonOdds_(oppEs, teamEs, matchKey);
    if (poissonData) {
      lambdaTeam = isHome
        ? (poissonData.lambda_home || lambdaTeam)
        : (poissonData.lambda_away || lambdaTeam);
    }
  } catch(e_) {}

  // Obtener fortalezas individuales
  const strengths = buildGoalScorerStrengths_(teamEs);

  const result = [];
  Object.values(strengths).forEach(p => {
    const pred = predictScorerProbability_(p.nombre, teamEs, lambdaTeam, strengths);
    result.push({
      nombre:              p.nombre,
      equipo:              p.equipo || teamEs,
      posicion:            _normalizarPosicion_(p.posicion),
      goles_torneo:        p.goles,
      asistencias_torneo:  p.asistencias,
      xg_torneo:           p.xg,
      participacion_goles: p.participacion,
      lambda_player:       pred.lambda_player,
      prob_anotar:         pred.prob_anotar,
      prob_anotar_pct:     Math.round(pred.prob_anotar * 1000) / 10,
      cuota_fair:          pred.prob_anotar > 0 ? Math.round((1 / pred.prob_anotar) * 100) / 100 : 99,
      confianza:           pred.confianza,
      lambda_equipo:       lambdaTeam
    });
  });

  return result
    .sort((a, b) => b.prob_anotar - a.prob_anotar)
    .filter(p => p.prob_anotar > 0.01); // filtrar probabilidades insignificantes
}

// ─── 4. buildMatchScorerPredictions_ ──────────────────────────────────────────

/**
 * Combina rankings de ambos equipos para un partido.
 *
 * @param {string} homeTeam
 * @param {string} awayTeam
 * @param {string} [matchKey]
 * @returns {{ home: Array, away: Array, lambdaHome: number, lambdaAway: number }}
 */
function buildMatchScorerPredictions_(homeTeam, awayTeam, matchKey) {
  const homeEs = teamNameToSpanish_(homeTeam);
  const awayEs = teamNameToSpanish_(awayTeam);

  let lambdaHome = 1.3, lambdaAway = 1.1;
  try {
    const po = getPoissonOdds_(homeEs, awayEs, matchKey);
    if (po) {
      lambdaHome = po.lambda_home || lambdaHome;
      lambdaAway = po.lambda_away || lambdaAway;
    }
  } catch(e_) {}

  const homeRanking = buildTeamScorerRanking_(homeEs, awayEs, matchKey, true);
  const awayRanking = buildTeamScorerRanking_(awayEs, homeEs, matchKey, false);

  return {
    home: homeRanking,
    away: awayRanking,
    lambdaHome,
    lambdaAway
  };
}

// ─── 5. saveScorerPredictions_ ────────────────────────────────────────────────

/**
 * Calcula predicciones de goleadores para un partido y las guarda en GoalScorerOdds.
 * Sobreescribe filas previas con el mismo match_key.
 *
 * @param {{ local: string, visitante: string, match_key: string, fecha: string }} fixture
 */
function saveScorerPredictions_(fixture) {
  const matchKey = fixture.match_key || `${fixture.local}_vs_${fixture.visitante}`;
  const fecha    = fixture.fecha || todayChile_();

  const predictions = buildMatchScorerPredictions_(fixture.local, fixture.visitante, matchKey);
  const now = nowChile_();

  const headers = [
    'match_key', 'fecha', 'jugador', 'equipo', 'posicion',
    'goles_torneo', 'asistencias_torneo', 'xg_torneo', 'participacion_goles',
    'lambda_player', 'prob_anotar_pct', 'cuota_fair', 'updated_at'
  ];

  const allPlayers = [
    ...predictions.home.map(p => ({ ...p, _lado: 'home' })),
    ...predictions.away.map(p => ({ ...p, _lado: 'away' }))
  ];

  // Construir filas
  const newRows = allPlayers.map(p => [
    matchKey,
    fecha,
    p.nombre,
    p.equipo,
    p.posicion,
    p.goles_torneo,
    p.asistencias_torneo,
    Math.round(p.xg_torneo * 100) / 100,
    Math.round(p.participacion_goles * 10000) / 10000,
    Math.round(p.lambda_player * 10000) / 10000,
    p.prob_anotar_pct,
    p.cuota_fair,
    now
  ]);

  const ss    = SpreadsheetApp.openById(getSpreadsheetId_());
  let sheet   = ss.getSheetByName(SHEET_GOAL_SCORER_ODDS);

  if (!sheet) {
    sheet = ss.insertSheet(SHEET_GOAL_SCORER_ODDS);
    sheet.appendRow(headers);
    sheet.getRange(1, 1, 1, headers.length).setFontWeight('bold');
    sheet.setFrozenRows(1);
  }

  // Eliminar filas previas para este match_key
  const all = sheet.getDataRange().getValues();
  const mkCol = all[0].indexOf('match_key'); // índice de columna
  const toDelete = [];
  for (let i = all.length - 1; i >= 1; i--) {
    if (String(all[i][mkCol]) === String(matchKey)) toDelete.push(i + 1);
  }
  toDelete.forEach(row => sheet.deleteRow(row));

  // Insertar nuevas filas
  if (newRows.length > 0) {
    sheet.getRange(sheet.getLastRow() + 1, 1, newRows.length, headers.length)
      .setValues(newRows);
  }

  console.log(`GoalScorerOdds: guardadas ${newRows.length} filas para ${matchKey}`);
  return newRows.length;
}

// ─── 6. buildScorerEVText_ ────────────────────────────────────────────────────

/**
 * Lee GoalScorerOdds para el partido y formatea un texto con los top 10
 * goleadores probables, incluyendo EV si hay cuota real disponible.
 *
 * @param {string} homeTeam
 * @param {string} awayTeam
 * @returns {string}  Texto HTML para Telegram
 */
function buildScorerEVText_(homeTeam, awayTeam) {
  const homeEs = teamNameToSpanish_(homeTeam);
  const awayEs = teamNameToSpanish_(awayTeam);
  const norm   = s => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z]/g, '');

  // Intentar leer desde GoalScorerOdds caché
  let players = [];
  try {
    const rows = readAll_(SHEET_GOAL_SCORER_ODDS);
    const qH = norm(homeEs), qA = norm(awayEs);
    players = rows.filter(r => {
      const eq = norm(r.equipo || '');
      return norm(r.match_key || '').includes(qH) || norm(r.match_key || '').includes(qA);
    });
  } catch(e_) {}

  // Si no hay caché → calcular en tiempo real
  if (players.length === 0) {
    const pred = buildMatchScorerPredictions_(homeEs, awayEs);
    players = [
      ...pred.home.map(p => ({ ...p, prob_anotar_pct: p.prob_anotar_pct, cuota_fair: p.cuota_fair })),
      ...pred.away.map(p => ({ ...p, prob_anotar_pct: p.prob_anotar_pct, cuota_fair: p.cuota_fair }))
    ];
  }

  if (!players.length) return `⚽ Sin datos de goleadores para ${homeEs} vs ${awayEs}.`;

  // Ordenar por prob_anotar_pct desc y tomar top 10
  const top10 = [...players]
    .sort((a, b) => parseFloat(b.prob_anotar_pct || 0) - parseFloat(a.prob_anotar_pct || 0))
    .slice(0, 10);

  const flagH = teamFlag_(homeEs);
  const flagA = teamFlag_(awayEs);

  let msg = `⚽ <b>Probables Goleadores</b>\n`;
  msg += `${flagH} ${homeEs} vs ${awayEs} ${flagA}\n\n`;

  top10.forEach((p, i) => {
    const nombre    = p.nombre || p.jugador || '?';
    const equipo    = p.equipo || '';
    const pct       = parseFloat(p.prob_anotar_pct || 0).toFixed(1);
    const cuota     = parseFloat(p.cuota_fair || 99).toFixed(2);
    const flag      = teamFlag_(equipo);
    const goles     = p.goles_torneo !== undefined ? Number(p.goles_torneo) : (Number(p.goles || 0));
    const golStr    = goles > 0 ? ` · ⚽${goles}` : '';

    msg += `${i + 1}. ${flag} <b>${nombre}</b>${golStr}\n`;
    msg += `   📊 ${pct}% · cuota fair: ${cuota}\n`;
  });

  msg += `\n<i>Modelo Poisson × participación torneo</i>`;
  return msg.trim();
}

// ─── 7. buildScorerCommandText_ ───────────────────────────────────────────────

/**
 * Comando /goleador para el bot de Telegram.
 *
 * Uso:
 *   /goleador              → top 15 goleadores reales del torneo
 *   /goleador Ecuador      → probables anotadores de Ecuador
 *   /goleador partido Ecuador → goleadores en próximo partido de Ecuador
 *
 * @param {string} [args]
 * @returns {string}  Texto HTML para Telegram
 */
function buildScorerCommandText_(args) {
  const raw = String(args || '').trim();

  // Sin args → top goleadores reales del torneo (mismo que /goleadores)
  if (!raw) return buildGoleadoresText_();

  // "partido <Equipo>" → buscar próximo partido y predecir
  const matchMode = raw.match(/^partido\s+(.+)$/i);
  if (matchMode) {
    const teamQuery = matchMode[1].trim();
    return _buildScorerNextMatchText_(teamQuery);
  }

  // "<Equipo>" → probables goleadores en el equipo (ranking general del torneo)
  return _buildScorerTeamText_(raw);
}

// ─── Helpers internos ─────────────────────────────────────────────────────────

/**
 * Normaliza la posición a una clave estándar del modelo.
 */
function _normalizarPosicion_(posicion) {
  const p = String(posicion || '').toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '');
  if (p.includes('delantero') || p.includes('forward') || p.includes('striker') || p.includes('fw') || p.includes('cf') || p.includes('st')) return 'Delantero';
  if (p.includes('medio') || p.includes('midfielder') || p.includes('mf') || p.includes('cm') || p.includes('am') || p.includes('dm')) return 'Mediocampista';
  if (p.includes('defensa') || p.includes('defender') || p.includes('df') || p.includes('cb') || p.includes('lb') || p.includes('rb') || p.includes('back')) return 'Defensa';
  if (p.includes('portero') || p.includes('goalkeeper') || p.includes('gk') || p.includes('arquero') || p.includes('golero')) return 'Portero';
  return 'default';
}

/**
 * Texto con probables anotadores de un equipo (sin partido específico).
 * Usa un oponente neutro con lambda de torneo.
 */
function _buildScorerTeamText_(teamQuery) {
  const teamEs = teamNameToSpanish_(teamQuery);
  const flag   = teamFlag_(teamEs);

  // Obtener strengths del equipo
  const strengths = buildGoalScorerStrengths_(teamEs);
  const playerCount = Object.keys(strengths).length;

  if (playerCount === 0) {
    return `${flag} No encontré datos para <b>${teamEs}</b>.\nVerifica el nombre del equipo.`;
  }

  // λ equipo promedio del torneo (fallback si no hay partido específico)
  let lambdaTeam = 1.3;
  try {
    const strengths2 = buildPoissonStrengths_();
    if (strengths2 && strengths2.ataque && strengths2.ataque[teamEs]) {
      lambdaTeam = strengths2.mu * strengths2.ataque[teamEs];
    }
  } catch(e_) {}

  // Calcular probs y ordenar
  const ranked = Object.values(strengths).map(p => {
    const pred = predictScorerProbability_(p.nombre, teamEs, lambdaTeam, strengths);
    return {
      nombre:        p.nombre,
      goles_torneo:  p.goles,
      asistencias:   p.asistencias,
      posicion:      _normalizarPosicion_(p.posicion),
      prob_anotar:   pred.prob_anotar,
      prob_pct:      Math.round(pred.prob_anotar * 1000) / 10,
      cuota_fair:    pred.prob_anotar > 0 ? Math.round((1 / pred.prob_anotar) * 100) / 100 : 99
    };
  })
  .sort((a, b) => b.prob_anotar - a.prob_anotar)
  .slice(0, 12);

  let msg = `${flag} <b>Probables Goleadores — ${teamEs}</b>\n\n`;
  msg += `<code>Jugador              Pos  %Gol  Cuota  ⚽</code>\n`;

  ranked.forEach((p, i) => {
    const nombre  = (p.nombre || '').substring(0, 18).padEnd(19);
    const pos     = (p.posicion || '').substring(0, 3).padEnd(4);
    const pct     = String(p.prob_pct.toFixed(1)).padStart(5);
    const cuota   = String(p.cuota_fair.toFixed(2)).padStart(6);
    const goles   = p.goles_torneo > 0 ? ` ${p.goles_torneo}` : '';
    msg += `<code>${i + 1 < 10 ? ' ' : ''}${i + 1}. ${nombre} ${pos} ${pct}% ${cuota}${goles}</code>\n`;
  });

  msg += `\n<i>λ_equipo=${lambdaTeam.toFixed(2)} · Modelo Poisson × participación</i>`;
  return msg.trim();
}

/**
 * Texto con probables goleadores en el próximo partido de un equipo.
 */
function _buildScorerNextMatchText_(teamQuery) {
  const teamEs = teamNameToSpanish_(teamQuery);
  const flag   = teamFlag_(teamEs);
  const norm   = s => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

  // Buscar próximo partido no jugado
  let nextMatch = null;
  try {
    const partidos = readAll_(CONFIG.SHEETS.PARTIDOS);
    const today    = todayChile_();
    const pending  = partidos.filter(r => {
      const st = String(r.status || '').toUpperCase();
      if (st === 'FT' || st === 'AET' || st === 'PEN') return false;
      const fecha = normalizeFecha_(r.fecha);
      if (fecha < today) return false;
      const localNorm = norm(teamNameToSpanish_(r.local || ''));
      const visNorm   = norm(teamNameToSpanish_(r.visitante || ''));
      const teamNorm  = norm(teamEs);
      return localNorm.includes(teamNorm) || teamNorm.includes(localNorm) ||
             visNorm.includes(teamNorm)   || teamNorm.includes(visNorm);
    });
    pending.sort((a, b) => String(normalizeFecha_(a.fecha)).localeCompare(String(normalizeFecha_(b.fecha))));
    nextMatch = pending[0] || null;
  } catch(e_) {}

  if (!nextMatch) {
    return `${flag} No encontré próximo partido para <b>${teamEs}</b>. Usa /goleador ${teamEs} para el ranking general.`;
  }

  const homeEs  = teamNameToSpanish_(nextMatch.local     || '');
  const awayEs  = teamNameToSpanish_(nextMatch.visitante || '');
  const isHome  = norm(homeEs).includes(norm(teamEs)) || norm(teamEs).includes(norm(homeEs));
  const matchKey = nextMatch.match_key || `${homeEs}_vs_${awayEs}`;
  const fecha    = normalizeFecha_(nextMatch.fecha);

  const pred = buildMatchScorerPredictions_(homeEs, awayEs, matchKey);
  const myPlayers   = isHome ? pred.home : pred.away;
  const oppPlayers  = isHome ? pred.away : pred.home;
  const oppTeamEs   = isHome ? awayEs : homeEs;
  const flagOpp     = teamFlag_(oppTeamEs);
  const myLambda    = isHome ? pred.lambdaHome : pred.lambdaAway;

  const top8      = myPlayers.slice(0, 8);
  const topOpp3   = oppPlayers.slice(0, 3);

  let msg = `⚽ <b>Goleadores Partido</b>\n`;
  msg += `${flag} ${homeEs} vs ${awayEs} ${flagOpp}\n`;
  msg += `📅 ${fecha}\n\n`;

  msg += `${flag} <b>${teamEs}</b> (λ=${myLambda.toFixed(2)})\n`;
  top8.forEach((p, i) => {
    const goles  = p.goles_torneo > 0 ? ` ⚽${p.goles_torneo}` : '';
    const posTag = p.posicion.substring(0, 3);
    msg += `  ${i + 1}. <b>${p.nombre}</b> [${posTag}]${goles} — ${p.prob_anotar_pct.toFixed(1)}% · ${p.cuota_fair.toFixed(2)}\n`;
  });

  msg += `\n${flagOpp} <b>${oppTeamEs}</b> — Top 3\n`;
  topOpp3.forEach((p, i) => {
    const goles = p.goles_torneo > 0 ? ` ⚽${p.goles_torneo}` : '';
    msg += `  ${i + 1}. <b>${p.nombre}</b>${goles} — ${p.prob_anotar_pct.toFixed(1)}%\n`;
  });

  msg += `\n<i>Modelo Poisson × participación torneo</i>`;
  return msg.trim();
}

// ─── Cron: guardar predicciones de goleadores para partidos próximos ──────────

/**
 * Cron job: guarda predicciones de goleadores para todos los partidos
 * del día actual y siguiente. Llamar desde un trigger Time-based.
 */
function cronSaveScorerPredictions() {
  const today    = todayChile_();
  const tomorrow = tomorrowChile_();

  let partidos = [];
  try {
    partidos = readAll_(CONFIG.SHEETS.PARTIDOS).filter(r => {
      const fecha = normalizeFecha_(r.fecha);
      const st    = String(r.status || '').toUpperCase();
      return (fecha === today || fecha === tomorrow) && st !== 'FT';
    });
  } catch(e) {
    console.error('cronSaveScorerPredictions: error leyendo Partidos:', e.message);
    return;
  }

  console.log(`cronSaveScorerPredictions: ${partidos.length} partido(s) a procesar`);
  partidos.forEach(f => {
    try { saveScorerPredictions_(f); } catch(e) {
      console.error(`Error en ${f.match_key}: ${e.message}`);
    }
  });
}
