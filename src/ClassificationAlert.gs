/**
 * ClassificationAlert.gs
 *
 * Detecta partidos de mañana que pueden cambiar quién clasifica de un grupo.
 * Un partido es "decisivo" si el resultado puede mover la prob. de clasificación
 * de cualquier equipo en más de SIM_DECISIVE_THRESH (25%).
 *
 * Depende de GroupSimulator.gs (simulateGroup_, simulateGroupWithFixedResult_,
 * isFinishedStatus_, SIM_HOJA, SIM_DECISIVE_THRESH).
 *
 * Se llama desde cronTomorrowPreview() en Main.gs.
 */

/**
 * Detecta partidos decisivos de mañana y envía alerta por Telegram si los hay.
 * No-op si SimulacionGrupos está vacía o no hay partidos de mañana.
 */
function checkClassificationAlerts_() {
  const tomorrow = tomorrowChile_();

  let simData, fixtures, standings;
  try {
    simData   = readAll_(SIM_HOJA);
    fixtures  = readAll_(CONFIG.SHEETS.PARTIDOS);
    standings = readAll_(CONFIG.SHEETS.CLASIFICACION);
  } catch (e) {
    console.warn('checkClassificationAlerts_:', e.message);
    return;
  }

  if (!simData.length || !fixtures.length) return;

  // Mapa equipo → prob_clasificar actual
  const simMap = {};
  simData.forEach(r => { simMap[r.equipo] = Number(r.prob_clasificar || 0); });

  // Partidos de mañana en fase de grupos (con grupo asignado, no terminados)
  const tomorrowFixtures = fixtures.filter(r => {
    const fecha  = normalizeFecha_(r.fecha);
    const status = String(r.status || r.estado || '').toUpperCase();
    return fecha === tomorrow &&
           r.grupo &&
           !isFinishedStatus_(status);
  });

  if (!tomorrowFixtures.length) return;

  const decisiveMatches = [];

  tomorrowFixtures.forEach(fix => {
    const home  = fix.local     || '';
    const away  = fix.visitante || '';
    const grupo = fix.grupo     || '';
    if (!home || !away || !grupo) return;

    const homeBase = simMap[home] !== undefined ? simMap[home] : -1;
    const awayBase = simMap[away] !== undefined ? simMap[away] : -1;

    // Equipos no en rango "en juego" → partido no importa para clasificación
    const homeInPlay = homeBase >= 0.05 && homeBase <= 0.95;
    const awayInPlay = awayBase >= 0.05 && awayBase <= 0.95;
    if (!homeBase || (!homeInPlay && !awayInPlay)) return;

    const groupStandings = standings.filter(r => r.grupo === grupo);
    const groupPending   = fixtures.filter(r =>
      r.grupo === grupo && !isFinishedStatus_(String(r.status || r.estado || ''))
    );

    let scenHome, scenDraw, scenAway;
    try {
      scenHome = simulateGroupWithFixedResult_(groupStandings, groupPending, fix, 'home');
      scenDraw = simulateGroupWithFixedResult_(groupStandings, groupPending, fix, 'draw');
      scenAway = simulateGroupWithFixedResult_(groupStandings, groupPending, fix, 'away');
    } catch (e) {
      console.warn(`ClassificationAlert simul ${home} vs ${away}:`, e.message);
      return;
    }

    // Calcular delta máximo para home y away
    const allProbs = [scenHome, scenDraw, scenAway];

    const maxDeltaHome = homeBase >= 0 ? Math.max(...allProbs.map(s =>
      Math.abs((s[home] || 0) - homeBase)
    )) : 0;

    const maxDeltaAway = awayBase >= 0 ? Math.max(...allProbs.map(s =>
      Math.abs((s[away] || 0) - awayBase)
    )) : 0;

    if (maxDeltaHome > SIM_DECISIVE_THRESH || maxDeltaAway > SIM_DECISIVE_THRESH) {
      decisiveMatches.push({
        fix, home, away, grupo,
        homeBase, awayBase,
        scenHome, scenDraw, scenAway
      });
    }
  });

  if (decisiveMatches.length) {
    sendClassificationAlert_(decisiveMatches);
  }
}

/**
 * Envía alerta de partidos decisivos por Telegram.
 *
 * @param {Array} matches  Lista de partidos decisivos con escenarios calculados
 */
function sendClassificationAlert_(matches) {
  let msg = `🚨 <b>Partidos Decisivos Mañana — Clasificación en Juego</b>\n\n`;

  matches.forEach(m => {
    const hora = m.fix.hora_chile || '';
    msg += `⚽ <b>${m.home} vs ${m.away}</b>`;
    if (hora) msg += ` — 🕒 ${hora}`;
    msg += `\nGrupo ${m.grupo}\n\n`;

    msg += `📊 Prob. clasificar ACTUAL:\n`;
    msg += `  ${m.home}: <code>${Math.round(m.homeBase * 100)}%</code>`;
    msg += ` | ${m.away}: <code>${Math.round(m.awayBase * 100)}%</code>\n\n`;

    msg += `Si gana <b>${m.home}</b>:\n`;
    msg += `  ${m.home} <code>${Math.round((m.scenHome[m.home] || 0) * 100)}%</code>`;
    msg += ` | ${m.away} <code>${Math.round((m.scenHome[m.away] || 0) * 100)}%</code>\n`;

    msg += `Si <b>Empate</b>:\n`;
    msg += `  ${m.home} <code>${Math.round((m.scenDraw[m.home] || 0) * 100)}%</code>`;
    msg += ` | ${m.away} <code>${Math.round((m.scenDraw[m.away] || 0) * 100)}%</code>\n`;

    msg += `Si gana <b>${m.away}</b>:\n`;
    msg += `  ${m.home} <code>${Math.round((m.scenAway[m.home] || 0) * 100)}%</code>`;
    msg += ` | ${m.away} <code>${Math.round((m.scenAway[m.away] || 0) * 100)}%</code>\n\n`;
  });

  msg += `<i>Probabilidades basadas en simulación Monte Carlo (${SIM_RUNS} runs).\nActualiza con runGroupSimulation().</i>`;

  broadcastTelegramMessage_(msg);
}
