function savePlayerSummaryFromEvents_(fixtureId, fixture, events) {
  const map = {};

  events.forEach(event => {
    const player = event.player || {};
    const assist = event.assist || {};
    const team = event.team || {};

    if (player.id) {
      const key = `${fixtureId}_${player.id}`;
      if (!map[key]) {
        map[key] = createPlayerSummary_(fixtureId, player, team);
      }

      if (event.type === 'Goal') {
        map[key].goles++;
        map[key].minuto_gol.push(event.time.elapsed);
      }

      if (event.type === 'Card' && event.detail === 'Yellow Card') {
        map[key].tarjetas_amarillas++;
      }

      if (event.type === 'Card' && event.detail === 'Red Card') {
        map[key].tarjetas_rojas++;
      }

      if (event.type === 'subst') {
        map[key].salio_minuto = event.time.elapsed;
      }
    }

    if (assist.id && event.type === 'Goal') {
      const assistKey = `${fixtureId}_${assist.id}`;
      if (!map[assistKey]) {
        map[assistKey] = createPlayerSummary_(fixtureId, assist, team);
      }

      map[assistKey].asistencias++;
      map[assistKey].minuto_asistencia.push(event.time.elapsed);
    }

    if (assist.id && event.type === 'subst') {
      const enterKey = `${fixtureId}_${assist.id}`;
      if (!map[enterKey]) {
        map[enterKey] = createPlayerSummary_(fixtureId, assist, team);
      }

      map[enterKey].entro_minuto = event.time.elapsed;
    }
  });

  const rows = Object.values(map).map(p => [
    fixtureId,
    fixtureId,
    p.jugador_id,
    p.jugador,
    p.equipo_id,
    p.equipo,
    p.goles,
    p.asistencias,
    p.tarjetas_amarillas,
    p.tarjetas_rojas,
    p.minuto_gol.join(','),
    p.minuto_asistencia.join(','),
    p.salio_minuto,
    p.entro_minuto,
    calculatePlayerImpact_(p),
    p.observacion,
    'API-Football fixtures/events',
    nowChile_()
  ]);

  if (!rows.length) return;

  const sheet = getSheet_(CONFIG.SHEETS.RESUMEN_JUGADOR_PARTIDO);
  const values = sheet.getDataRange().getValues();
  const headers = values.length ? values[0] : [];
  const fidIdx = headers.indexOf('fixture_id');
  const pidIdx = headers.indexOf('jugador_id');

  const existingPairs = {};
  values.slice(1).forEach(row => {
    const k = `${row[fidIdx]}_${row[pidIdx]}`;
    existingPairs[k] = true;
  });

  const newRows = rows.filter(r => !existingPairs[`${r[0]}_${r[2]}`]);
  appendRows_(CONFIG.SHEETS.RESUMEN_JUGADOR_PARTIDO, newRows);
}

function createPlayerSummary_(fixtureId, player, team) {
  return {
    fixture_id: fixtureId,
    jugador_id: player.id,
    jugador: player.name,
    equipo_id: team.id,
    equipo: team.name,
    goles: 0,
    asistencias: 0,
    tarjetas_amarillas: 0,
    tarjetas_rojas: 0,
    minuto_gol: [],
    minuto_asistencia: [],
    salio_minuto: '',
    entro_minuto: '',
    observacion: ''
  };
}

function calculatePlayerImpact_(p) {
  const score = p.goles * 3 + p.asistencias * 2 - p.tarjetas_rojas * 3 - p.tarjetas_amarillas;

  if (score >= 4) return 'MUY_ALTO';
  if (score >= 2) return 'ALTO';
  if (score >= 1) return 'MEDIO';
  if (score < 0) return 'NEGATIVO';
  return 'BAJO';
}

function cronLiveEventsMonitor() {
  const liveFixtures = getFixturesLikelyLive_();

  liveFixtures.forEach(fixture => {
    try {
      const fixtureId = fixture.match_id || fixture.fixture_id;

      const eventsData = fetchEventsByFixture_(fixtureId);
      const events     = eventsData.response || [];

      const newImportantEvents = detectNewImportantEvents_(fixtureId, events);

      if (newImportantEvents.length) {
        saveEvents_(fixtureId, events, 'API-Football fixtures/events live');

        newImportantEvents.forEach(event => {
          const score    = getLiveScore_(fixtureId, events);
          const textMsg  = formatImportantEventMessage_(fixture, event, score);
          sendTelegramMessage_(textMsg);
          markEventAsAlerted_(fixtureId, event);

          // Enviar imagen de stats solo en goles y rojas (los eventos de mayor impacto)
          if (event.type === 'Goal' || (event.type === 'Card' && event.detail === 'Red Card')) {
            try {
              const liveStats = fetchLiveStatistics_(fixtureId);
              if (liveStats) {
                const minute   = event.time ? event.time.elapsed : null;
                // Construir objeto fixture mínimo para buildLiveScoreChartUrl_
                const fxObj    = buildFixtureFromSheetRow_(fixture);
                if (score) { fxObj.goals = { home: score.home, away: score.away }; }
                const chartUrl = buildLiveScoreChartUrl_(fxObj, liveStats, minute);
                if (chartUrl) {
                  const caption = `${fixture.local || ''} ${score ? score.home + '-' + score.away : ''} ${fixture.visitante || ''}`;
                  broadcastTelegramPhoto_(chartUrl, caption);
                }
              }
            } catch (imgErr) {
              console.warn(`Live chart ${fixtureId}:`, imgErr.message);
            }
          }
        });
      }

      Utilities.sleep(800);
    } catch (e) {
      console.warn(`Live monitor error: ${e.message}`);
    }
  });
}

function getFixturesLikelyLive_() {
  const rows = readAll_(CONFIG.SHEETS.PARTIDOS);
  const now = new Date();

  return rows.filter(r => {
    if (!r.hora_chile) return false;

    const kickoff = new Date(r.hora_chile);
    const diffMinutes = (now.getTime() - kickoff.getTime()) / 60000;

    return diffMinutes >= -15 && diffMinutes <= 140;
  });
}

function detectNewImportantEvents_(fixtureId, events) {
  const alerted = getAlertedEventIds_();

  return events.filter(event => {
    const eventId = buildEventId_(fixtureId, event);
    if (alerted[eventId]) return false;

    return isImportantEvent_(event);
  });
}

function isImportantEvent_(event) {
  if (event.type === 'Goal') return true;
  if (event.type === 'Card' && event.detail === 'Red Card') return true;
  if (event.type === 'Var') return true;
  if (event.type === 'subst' && event.time && event.time.elapsed >= 75) return true;
  if (event.type === 'Card' && event.detail === 'Yellow Card' && event.time && event.time.elapsed >= 85) return true;

  return false;
}

function getAlertedEventIds_() {
  const rows = readAll_(CONFIG.SHEETS.ALERTAS);
  const map = {};

  rows.forEach(r => {
    if (r.evento_id) map[String(r.evento_id)] = true;
  });

  return map;
}

function markEventAsAlerted_(fixtureId, event) {
  const eventId = buildEventId_(fixtureId, event);

  appendRows_(CONFIG.SHEETS.ALERTAS, [[
    eventId,
    fixtureId,
    safe_(event.type),
    safe_(event.detail),
    safe_(event.team && event.team.name),
    safe_(event.player && event.player.name),
    safe_(event.time && event.time.elapsed),
    safe_(event.time && event.time.extra),
    nowChile_(),
    'TELEGRAM'
  ]]);
}

function formatImportantEventMessage_(fixture, event, score) {
  const minute = event.time && event.time.extra
    ? `${event.time.elapsed}+${event.time.extra}`
    : String(event.time ? event.time.elapsed : '?');

  const home = fixture.local || '';
  const away = fixture.visitante || '';
  const scoreStr = score ? `  ${home} <b>${score.home} - ${score.away}</b> ${away}` : `${home} vs ${away}`;

  if (event.type === 'Goal') {
    const assist = event.assist && event.assist.name ? `\n👟 Asistencia: ${event.assist.name}` : '';
    return [
      `⚽ <b>GOL! ${minute}'</b>`,
      scoreStr,
      `📌 ${safe_(event.team && event.team.name)} — ${safe_(event.player && event.player.name)}${assist}`
    ].join('\n');
  }

  if (event.type === 'Card' && event.detail === 'Red Card') {
    return [
      `🟥 <b>TARJETA ROJA ${minute}'</b>`,
      scoreStr,
      `📌 ${safe_(event.team && event.team.name)} — ${safe_(event.player && event.player.name)}`
    ].join('\n');
  }

  if (event.type === 'Card' && event.detail === 'Second Yellow card') {
    return [
      `🟨🟥 <b>SEGUNDA AMARILLA (= ROJA) ${minute}'</b>`,
      scoreStr,
      `📌 ${safe_(event.team && event.team.name)} — ${safe_(event.player && event.player.name)}`
    ].join('\n');
  }

  if (event.type === 'Card' && event.detail === 'Yellow Card') {
    return [
      `🟨 Amarilla ${minute}'`,
      `${safe_(event.team && event.team.name)} — ${safe_(event.player && event.player.name)}`
    ].join('\n');
  }

  if (event.type === 'Var') {
    return [
      `📺 <b>VAR ${minute}'</b>`,
      scoreStr,
      `${safe_(event.detail)} — ${safe_(event.team && event.team.name)}`
    ].join('\n');
  }

  if (event.type === 'subst') {
    return [
      `🔄 Cambio ${minute}'`,
      `${safe_(event.team && event.team.name)}`,
      `⬆️ ${safe_(event.assist && event.assist.name)} ⬇️ ${safe_(event.player && event.player.name)}`
    ].join('\n');
  }

  return `📌 ${safe_(event.type)} ${minute}'\n${safe_(event.detail)}\n${safe_(event.team && event.team.name)}`;
}

// ─── Estadísticas en vivo ─────────────────────────────────────────────────────

/**
 * Obtiene las estadísticas en vivo del partido desde API-Football.
 * Retorna un objeto { home: {...}, away: {...} } o null si no hay datos.
 *
 * @param {string|number} fixtureId
 * @returns {Object|null}
 */
function fetchLiveStatistics_(fixtureId) {
  try {
    const data  = fetchStatisticsByFixture_(fixtureId);
    const stats = data.response || [];
    if (!stats.length) return null;

    const extract = teamStats => {
      const find  = type => {
        const item = (teamStats.statistics || []).find(s => s.type === type);
        return item ? (Number(String(item.value || '0').replace('%', '')) || 0) : 0;
      };
      return {
        posesion:  find('Ball Possession'),
        tiros:     find('Total Shots'),
        tirosArco: find('Shots on Goal'),
        corners:   find('Corner Kicks'),
        faltas:    find('Fouls'),
        amarillas: find('Yellow Cards'),
        rojas:     find('Red Cards')
      };
    };

    return {
      home: extract(stats[0] || {}),
      away: extract(stats[1] || {})
    };
  } catch (e) {
    console.warn(`fetchLiveStatistics_ ${fixtureId}:`, e.message);
    return null;
  }
}

/**
 * Calcula el marcador actual leyendo los goles de EVENTOS_LIVE.
 * Más confiable que el objeto fixture durante el partido.
 *
 * @param {string|number} fixtureId
 * @param {Array}         [events]  Si ya se tienen los eventos del API, usarlos directamente
 * @returns {{ home: number, away: number }|null}
 */
function getLiveScore_(fixtureId, events) {
  try {
    // Si se pasaron los eventos del API (durante cronLiveEventsMonitor), usarlos
    if (events && events.length) {
      // Los eventos del API no tienen info de cuál es local/visitante fácilmente
      // Leer de EVENTOS_LIVE que tiene scoreHome/scoreAway calculados
    }

    const allEvents = readAll_(CONFIG.SHEETS.EVENTOS_LIVE)
      .filter(r => String(r.fixture_id || r.event_id || '').includes(String(fixtureId)))
      .filter(r => r.tipo === 'Goal');

    if (!allEvents.length) return { home: 0, away: 0 };

    // scoreHome y scoreAway se calculan de forma acumulada en saveEvents_
    // Tomar el último valor guardado
    const last = allEvents[allEvents.length - 1];
    return {
      home: Number(last.score_home || 0),
      away: Number(last.score_away || 0)
    };
  } catch (e) {
    return null;
  }
}

/**
 * Formatea estadísticas en vivo en texto HTML para el comando /en_vivo.
 *
 * @param {Object} fixture   Fila de Partidos (con local, visitante, hora_chile, status)
 * @param {Object} stats     Resultado de fetchLiveStatistics_
 * @param {Object} [score]   { home, away }
 * @returns {string}
 */
function formatLiveStatsMessage_(fixture, stats, score) {
  const home = fixture.local || '';
  const away = fixture.visitante || '';
  const scoreStr = score ? `${score.home} - ${score.away}` : '? - ?';

  let msg = `🔴 <b>EN VIVO: ${home} ${scoreStr} ${away}</b>\n`;
  if (fixture.minuto) msg += `⏱️ Minuto ${fixture.minuto}'\n`;
  msg += '\n';

  if (!stats) return msg + '<i>Estadísticas no disponibles</i>';

  const row = (label, h, a, suffix) => {
    const hs = String(h) + (suffix || '');
    const as = String(a) + (suffix || '');
    return `${label}: <code>${hs}</code> vs <code>${as}</code>`;
  };

  msg += row('⚽ Posesión',   stats.home.posesion,  stats.away.posesion,  '%') + '\n';
  msg += row('🎯 Tiros',      stats.home.tiros,     stats.away.tiros      ) + '\n';
  msg += row('✅ Al arco',    stats.home.tirosArco, stats.away.tirosArco  ) + '\n';
  msg += row('🔄 Corners',    stats.home.corners,   stats.away.corners    ) + '\n';
  msg += row('⚠️ Faltas',     stats.home.faltas,    stats.away.faltas     ) + '\n';
  msg += row('🟨 Amarillas',  stats.home.amarillas, stats.away.amarillas  ) + '\n';

  msg += `\n<i>${home} (local) vs ${away} (visitante)</i>`;
  return msg;
}

// ─── Texto para /en_vivo ──────────────────────────────────────────────────────

/**
 * Resumen de todos los partidos que están en curso ahora mismo.
 * Usado por el comando /en_vivo del bot.
 */
function buildLiveMatchesText_() {
  const liveStatuses = ['1H', 'HT', '2H', 'ET', 'BT', 'P', 'LIVE', 'INT'];

  let rows;
  try {
    rows = readAll_(CONFIG.SHEETS.PARTIDOS).filter(r =>
      liveStatuses.includes(String(r.status || '').toUpperCase())
    );
  } catch (e) { rows = []; }

  if (!rows.length) {
    return [
      '⚽ <b>En vivo ahora</b>',
      '',
      'No hay partidos en curso en este momento.',
      '',
      '<i>Usa /hoy para ver el horario de los partidos de hoy.</i>'
    ].join('\n');
  }

  let msg = `🔴 <b>Partidos en vivo — ${rows.length} partido${rows.length > 1 ? 's' : ''}</b>\n\n`;

  rows.forEach(fixture => {
    const fixtureId = fixture.fixture_id_af || fixture.match_id;
    const home = fixture.local     || '?';
    const away = fixture.visitante || '?';
    const statusLabel = {
      '1H': '1° Tiempo', 'HT': 'Descanso', '2H': '2° Tiempo',
      'ET': 'Prórroga', 'BT': 'Descanso Prórroga', 'P': 'Penales',
      'LIVE': 'En curso', 'INT': 'Interrumpido'
    }[String(fixture.status || '').toUpperCase()] || fixture.status;

    const score = getLiveScore_(fixtureId);
    const scoreStr = score ? `<b>${score.home} - ${score.away}</b>` : '<b>? - ?</b>';

    msg += `⚽ ${home} ${scoreStr} ${away}\n`;
    msg += `   ${statusLabel} | ${fixture.estadio || fixture.ciudad || ''}\n`;

    // Mini stats si disponibles
    try {
      const stats = fetchLiveStatistics_(fixtureId);
      if (stats) {
        msg += `   Pos: ${stats.home.posesion}%-${stats.away.posesion}% | `;
        msg += `Tiros: ${stats.home.tiros}-${stats.away.tiros}\n`;
      }
    } catch (e_) { /* sin stats */ }

    msg += '\n';
  });

  return msg.trim();
}

function saveEvents_(fixtureId, events, rawUrl, homeTeamId, awayTeamId) {
  const existing = getExistingIds_(CONFIG.SHEETS.EVENTOS_LIVE, 'evento_id');

  let scoreHome = 0;
  let scoreAway = 0;

  const rows = [];

  events.forEach(event => {
    const eventId = buildEventId_(fixtureId, event);
    if (existing[eventId]) return;

    if (event.type === 'Goal') {
      const teamId = event.team ? Number(event.team.id) : null;

      if (homeTeamId && teamId === Number(homeTeamId)) scoreHome++;
      if (awayTeamId && teamId === Number(awayTeamId)) scoreAway++;
    }

    rows.push([
      eventId,
      fixtureId,
      fixtureId,
      safe_(event.time && event.time.elapsed),
      safe_(event.time && event.time.extra),
      safe_(event.type),
      safe_(event.detail),
      safe_(event.team && event.team.id),
      safe_(event.team && event.team.name),
      safe_(event.player && event.player.id),
      safe_(event.player && event.player.name),
      safe_(event.assist && event.assist.id),
      safe_(event.assist && event.assist.name),
      safe_(event.comments),
      scoreHome,
      scoreAway,
      calculateEventImpact_(event),
      nowChile_(),
      rawUrl
    ]);
  });

  appendRows_(CONFIG.SHEETS.EVENTOS_LIVE, rows);
}

function calculateEventImpact_(event) {
  if (event.type === 'Goal') return 'ALTO';
  if (event.type === 'Card' && event.detail === 'Red Card') return 'ALTO';
  if (event.type === 'Card' && event.detail === 'Yellow Card') return 'MEDIO';
  if (event.type === 'subst') return 'MEDIO';
  return 'BAJO';
}