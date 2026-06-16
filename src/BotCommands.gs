/**
 * BotCommands.gs
 *
 * Webhook y handlers de comandos del bot de Telegram para el Mundial 2026.
 *
 * Comandos disponibles:
 *   /hoy            — Partidos de hoy
 *   /ayer           — Resultados de ayer
 *   /proximos       — Próximos 3 días de partidos
 *   /seleccion TEAM — Historial de un equipo
 *   /tabla          — Tabla de posiciones por grupo
 *   /stats EQUIPO   — Estadísticas acumuladas del equipo
 *   /jugador NOMBRE — Stats del jugador en el torneo
 *   /clima CIUDAD   — Clima del estadio de esa ciudad
 *   /h2h E1 vs E2   — Historial cara a cara
 *   /prediccion P   — Predicción IA + cuotas del partido
 *   /noticias EQUIPO— Últimas noticias del equipo
 *   /ayuda          — Lista de comandos
 */

function doPost(e) {
  // Serializar ejecuciones: Apps Script no soporta concurrencia en web apps.
  // Sin lock, si Telegram reenvía antes que terminemos, obtiene 302.
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(8000); // esperar hasta 8s para obtener el lock
  } catch (lockErr) {
    // No se pudo obtener el lock — responder 200 igual para que Telegram no reintente
    console.warn('doPost: lock timeout, descartando update');
    return ContentService.createTextOutput('ok').setMimeType(ContentService.MimeType.TEXT);
  }

  try {
    const update = JSON.parse((e && e.postData && e.postData.contents) || '{}');

    // Ignorar updates ya procesados (Telegram reintenta si no recibe 200 a tiempo)
    if (update.update_id != null && !shouldProcessUpdate_(update.update_id)) {
      return ContentService.createTextOutput('ok').setMimeType(ContentService.MimeType.TEXT);
    }

    if (update.message) {
      handleMessage_(update.message);
    }
  } catch (err) {
    console.error('doPost error:', err.message);
  } finally {
    lock.releaseLock();
  }

  return ContentService.createTextOutput('ok').setMimeType(ContentService.MimeType.TEXT);
}

/**
 * Devuelve true solo si este update_id es nuevo (mayor al último procesado).
 * Guarda el último en Script Properties para persistir entre ejecuciones.
 */
function shouldProcessUpdate_(updateId) {
  const props = PropertiesService.getScriptProperties();
  const last  = Number(props.getProperty('LAST_UPDATE_ID') || '0');
  const cur   = Number(updateId);

  if (!isFinite(cur) || cur <= 0) return true;
  if (last && cur <= last) return false;

  props.setProperty('LAST_UPDATE_ID', String(cur));
  return true;
}

// Telegram verifica el endpoint con GET antes de aceptar el webhook
function doGet(e) {
  return ContentService.createTextOutput('ok').setMimeType(ContentService.MimeType.TEXT);
}

function handleMessage_(msg) {
  const chatId   = msg && msg.chat && msg.chat.id ? String(msg.chat.id) : '';
  const text     = msg && msg.text ? String(msg.text).trim() : '';
  const username = msg && msg.from && msg.from.username ? msg.from.username : '';

  if (!chatId) return;

  try { registerSubscriber_(chatId, username); } catch (e_) { console.warn('register:', e_.message); }

  if (!text.startsWith('/')) return;

  // Comandos que envían imágenes — manejar aquí porque necesitan chatId
  const parts_ = text.split(' ');
  const cmd_   = parts_[0].toLowerCase().split('@')[0];
  const args_  = parts_.slice(1).join(' ').trim();

  if (cmd_ === '/grafico') {
    try { handleGraficoCommand_(chatId, args_); } catch (e_) {
      sendTelegramMessageToSingleChat_(chatId, `⚠️ Error en /grafico: ${e_.message}`);
    }
    return;
  }

  let response;
  try {
    response = handleTelegramCommand_(text);
  } catch (e_) {
    response = `⚠️ Error: ${e_.message}`;
  }

  if (response) sendTelegramMessageToSingleChat_(chatId, response);
}

function handleTelegramCommand_(text) {
  const parts = text.split(' ');
  const command = parts[0].toLowerCase().split('@')[0];
  const args = parts.slice(1).join(' ').trim();

  switch (command) {
    case '/hoy':        return buildTodayCommandResponse_();
    case '/ayer':       return buildYesterdayCommandResponse_();
    case '/proximos':   return buildUpcomingCommandResponse_();
    case '/seleccion':  return buildTeamCommandResponse_(args);
    case '/tabla':      return buildStandingsText_();
    case '/stats':      return buildTeamStatsResponse_(args);
    case '/jugador':    return buildPlayerStatsResponse_(args);
    case '/clima':      return buildWeatherResponse_(args);
    case '/h2h':        return buildH2HCommandResponse_(args);
    case '/prediccion': return buildPredictionResponse_(args);
    case '/noticias':   return buildNewsResponse_(args);
    case '/paises':     return buildPaisesCommandResponse_();
    case '/jugadores':  return buildJugadoresCommandResponse_(args);
    case '/arbitros':   return buildArbitrosResumenText_();
    case '/ev':         return buildEvSummaryText_();
    case '/elo':        return buildEloRankingText_();
    case '/historial':  return buildBettingHistoryText_();
    case '/calibrar':   return buildCalibrationText_();
    case '/en_vivo':    return buildLiveMatchesText_();
    case '/grafico':    return null; // manejado antes del switch (necesita chatId)
    case '/portafolio': return buildPortfolioText_();
    case '/upsets':     return buildUpsetRankingText_();
    case '/grupos':     return buildGroupSimText_(args);
    case '/ayuda':      return buildHelpCommandResponse_();
    default:            return null;
  }
}

// ─── /grafico ──────────────────────────────────────────────────────────────────

/**
 * Envía imágenes de probabilidades y ELO para el próximo partido del equipo.
 * Se llama directamente desde handleMessage_ (no pasa por el switch).
 *
 * @param {string} chatId
 * @param {string} args    Nombre del equipo (ej: "Argentina")
 */
function handleGraficoCommand_(chatId, args) {
  if (!args) {
    sendTelegramMessageToSingleChat_(chatId, 'Uso: /grafico Argentina\n\nEscribe el nombre del equipo.');
    return;
  }

  const q = args.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

  // Buscar próximo partido (NS = Not Started)
  const partidos = readAll_(CONFIG.SHEETS.PARTIDOS);
  const fixture  = partidos.find(r => {
    const local     = norm_(r.local     || '');
    const visitante = norm_(r.visitante || '');
    const esEquipo  = local.includes(q) || visitante.includes(q);
    const estado    = String(r.status || r.estado || '').toUpperCase();
    return esEquipo && ['NS', 'TBD', '1H', 'HT', '2H', 'ET', 'BT', 'P', 'LIVE', 'INT'].includes(estado);
  });

  if (!fixture) {
    sendTelegramMessageToSingleChat_(chatId,
      `No encontré un próximo partido para: ${args}\n\n` +
      `Puede que el equipo ya no tenga partidos pendientes o el nombre no coincide.\n` +
      `Prueba con /paises para ver los nombres exactos.`
    );
    return;
  }

  const home = fixture.local     || '';
  const away = fixture.visitante || '';
  const fixtureId = fixture.fixture_id_af || fixture.match_id;

  // Obtener probabilidades desde AI Analysis (cache)
  let probHome = 0.33, probDraw = 0.34, probAway = 0.33;
  let probSource = 'ELO';
  try {
    const aiRows = readAll_(CONFIG.SHEETS.AI_ANALYSIS).filter(r =>
      norm_(r.local || r.home || '').includes(norm_(home)) ||
      norm_(r.visitante || r.away || '').includes(norm_(away))
    );
    if (aiRows.length) {
      const latest = aiRows[aiRows.length - 1];
      if (latest.prob_local && latest.prob_empate && latest.prob_visitante) {
        probHome = Number(latest.prob_local);
        probDraw = Number(latest.prob_empate);
        probAway = Number(latest.prob_visitante);
        probSource = 'IA';
      }
    }
  } catch (e_) { /* usar ELO */ }

  // Fallback ELO si no hay AI
  if (probSource === 'ELO') {
    try {
      const eloProbs = getEloProbabilities_(home, away);
      if (eloProbs) { probHome = eloProbs.home; probDraw = eloProbs.draw; probAway = eloProbs.away; }
    } catch (e_) { /* mantener defaults */ }
  }

  // 1. Gráfico de probabilidades
  const probUrl = buildProbabilityChartUrl_(home, away, probHome, probDraw, probAway);
  const caption1 = [
    `📊 <b>${home} vs ${away}</b>`,
    `${home}: ${Math.round(probHome * 100)}% | Empate: ${Math.round(probDraw * 100)}% | ${away}: ${Math.round(probAway * 100)}%`,
    `<i>Fuente: ${probSource} | ${fixture.fecha || ''} ${fixture.hora_chile || ''}</i>`
  ].join('\n').substring(0, 1024);

  sendPhotoToSingleChat_(chatId, probUrl, caption1);
  Utilities.sleep(400);

  // 2. Gráfico de comparación ELO
  try {
    const eloHome = getTeamElo_(home);
    const eloAway = getTeamElo_(away);
    const eloUrl  = buildEloComparisonChartUrl_(home, away, eloHome, eloAway);
    const caption2 = `⚡ ELO: ${home} ${eloHome} vs ${away} ${eloAway} (Δ ${eloHome - eloAway > 0 ? '+' : ''}${eloHome - eloAway})`;
    sendPhotoToSingleChat_(chatId, eloUrl, caption2.substring(0, 1024));
    Utilities.sleep(400);
  } catch (e_) { console.warn('handleGraficoCommand_ ELO chart:', e_.message); }

  // 3. Evolución de cuotas (solo si hay suficientes datos)
  try {
    const oddsUrl = buildOddsEvolutionChartUrl_(fixtureId, home);
    if (oddsUrl) {
      sendPhotoToSingleChat_(chatId, oddsUrl, `📈 Evolución de cuotas — ${home} (1X2)`);
    }
  } catch (e_) { /* sin datos suficientes */ }
}


// ─── /jugadores ────────────────────────────────────────────────────────────────

function buildJugadoresCommandResponse_(pais) {
  if (!pais) return 'Uso: /jugadores Argentina\n\nVer todos los países con /paises';

  const q = pais.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

  // 1. Buscar si hay un partido en curso o reciente de este equipo
  const today = todayChile_();
  const partidos = readAll_(CONFIG.SHEETS.PARTIDOS);

  const matchToday = partidos.find(r => {
    const fecha = normalizeFecha_(r.fecha);
    if (fecha !== today) return false;
    const local     = norm_(r.local     || '');
    const visitante = norm_(r.visitante || '');
    return local.includes(q) || visitante.includes(q);
  });

  let msg = '';

  if (matchToday) {
    const esLocal    = norm_(matchToday.local     || '').includes(q);
    const equipoNombre = esLocal ? matchToday.local : matchToday.visitante;
    const rival        = esLocal ? matchToday.visitante : matchToday.local;
    const estado       = String(matchToday.estado || '').toUpperCase();
    const liveStatuses = ['1H','HT','2H','ET','BT','P','LIVE','INT','FT','AET','PEN'];
    const esVivo       = liveStatuses.includes(estado);

    msg += `⚽ <b>${equipoNombre} vs ${rival}</b> — ${esVivo ? '🔴 EN VIVO' : estado}\n`;

    // Intentar obtener alineación (desde hoja o API si está en curso)
    const fixtureId = matchToday.fixture_id_af || matchToday.match_id;
    if (fixtureId) {
      const fakeFixture = { fixture: { id: fixtureId, status: { short: estado } } };
      const lineups = getOrFetchLineup_(fakeFixture);
      const equipoLineup = lineups && findTeamInLineup_(lineups, q);

      if (equipoLineup) {
        msg += buildLineupText_(equipoNombre, equipoLineup);
      } else {
        msg += '\n<i>Alineación aún no disponible (se publica al inicio del partido)</i>\n';
      }
    }

    // Lesiones/molestias mencionadas en noticias
    const lesiones = getLesionesEquipo_(equipoNombre, q);
    if (lesiones.length) {
      msg += '\n🩹 <b>Posibles molestias/lesiones:</b>\n';
      lesiones.forEach(l => msg += `  • ${l}\n`);
    }

    msg += '\n';
  }

  // 2. Plantel completo desde la hoja Planteles
  const plantel = readAll_(CONFIG.SHEETS.PLANTELES).filter(r =>
    norm_(r.equipo || '').includes(q)
  );

  if (!plantel.length && !msg) {
    return `No encontré jugadores para: ${pais}\n\nVer todos los países con /paises`;
  }

  if (plantel.length) {
    const equipoNombre = plantel[0].equipo || pais;
    if (!matchToday) msg += `👕 <b>Plantel — ${equipoNombre}</b>\n\n`;
    else             msg += `👕 <b>Plantel completo — ${equipoNombre}</b>\n`;

    // Agrupar por posición
    const porPosicion = {};
    plantel.forEach(p => {
      const pos = String(p.posicion || 'Sin posición');
      if (!porPosicion[pos]) porPosicion[pos] = [];
      porPosicion[pos].push(`${p.numero ? p.numero + '. ' : ''}${p.jugador || p.nombre || ''}`);
    });

    const orden = ['Goalkeeper', 'Defender', 'Midfielder', 'Attacker', 'Sin posición'];
    const labels = { Goalkeeper: '🧤 Porteros', Defender: '🛡 Defensas', Midfielder: '⚙️ Mediocampistas', Attacker: '⚡ Delanteros', 'Sin posición': '— Otros' };

    orden.forEach(pos => {
      if (!porPosicion[pos]) return;
      msg += `\n<b>${labels[pos] || pos}:</b>\n`;
      msg += porPosicion[pos].join('\n') + '\n';
    });

    // Posiciones que no están en el orden predefinido
    Object.keys(porPosicion).forEach(pos => {
      if (orden.includes(pos)) return;
      msg += `\n<b>${pos}:</b>\n${porPosicion[pos].join('\n')}\n`;
    });
  }

  if (!matchToday && !plantel.length) {
    msg += '\n<i>Sin datos de plantel. Ejecuta loadSquadsForKnownTeams() para cargarlos.</i>';
  }

  return msg.trim();
}

function findTeamInLineup_(lineups, query) {
  const key = Object.keys(lineups).find(k => norm_(k).includes(query));
  return key ? lineups[key] : null;
}

function getLesionesEquipo_(equipoNombre, query) {
  try {
    const noticias = readAll_(CONFIG.SHEETS.NOTICIAS).filter(r => {
      const titulo = String(r.titulo || r.title || '').toLowerCase();
      const eq1 = norm_(r.equipo_local || r.home || '').includes(query);
      const eq2 = norm_(r.equipo_visitante || r.away || '').includes(query);
      const mencion = norm_(titulo).includes(query);
      return (eq1 || eq2 || mencion);
    });

    const INJURY_KW = ['lesion','lesionado','baja','duda','injury','injured','doubt','ankle','knee','muscle','hamstring'];
    return noticias
      .filter(r => {
        const t = String(r.titulo || r.title || '').toLowerCase();
        return INJURY_KW.some(kw => t.includes(kw));
      })
      .slice(0, 3)
      .map(r => String(r.titulo || r.title || '').substring(0, 80));
  } catch (e) {
    return [];
  }
}

function norm_(str) {
  return String(str || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
}

// ─── /paises ───────────────────────────────────────────────────────────────────

function buildPaisesCommandResponse_() {
  // Leer equipos desde Partidos (siempre tiene datos si hay backfill)
  const rows = readAll_(CONFIG.SHEETS.PARTIDOS);

  const nombres = new Set();
  rows.forEach(r => {
    if (r.local)     nombres.add(String(r.local).trim());
    if (r.visitante) nombres.add(String(r.visitante).trim());
  });

  if (!nombres.size) {
    return 'Aún no hay equipos cargados. Ejecuta el backfill primero.';
  }

  const lista = [...nombres].sort((a, b) => a.localeCompare(b));

  // Agrupar de a 4 por línea para que sea más compacto
  const lineas = [];
  for (let i = 0; i < lista.length; i += 4) {
    lineas.push(lista.slice(i, i + 4).join('  |  '));
  }

  return [
    `🌍 <b>Selecciones en el torneo (${lista.length})</b>`,
    '',
    lineas.join('\n'),
    '',
    '<i>Usa el nombre exacto (o parte de él) en los comandos:</i>',
    '/noticias Argentina',
    '/stats Morocco',
    '/seleccion United States',
    '/prediccion Brazil'
  ].join('\n');
}

// ─── /ayuda ────────────────────────────────────────────────────────────────────

function buildHelpCommandResponse_() {
  return [
    '🏆 <b>Bot Mundial 2026 — Comandos</b>',
    '',
    '/hoy — Partidos de hoy',
    '/ayer — Resultados de ayer',
    '/proximos — Próximos 3 días',
    '/paises — Ver todas las selecciones del torneo',
    '/jugadores Argentina — Plantel + alineación si hay partido',
    '/seleccion Brasil — Historial de un equipo',
    '/tabla — Tabla de posiciones por grupo',
    '/stats Argentina — Estadísticas del equipo',
    '/jugador Messi — Stats del jugador en el torneo',
    '/clima Miami — Clima del estadio',
    '/h2h España vs Francia — Historial cara a cara',
    '/prediccion Argentina — Predicción IA del próximo partido',
    '/noticias Brasil — Últimas noticias del equipo',
    '/arbitros — Árbitros del torneo con estadísticas',
    '',
    '📊 <b>Análisis estadístico</b>',
    '/ev — Oportunidades EV+ actuales',
    '/elo — Ranking ELO de equipos',
    '/historial — P&L de apuestas registradas',
    '/calibrar — Precisión del modelo predictivo',
    '',
    '📸 <b>Gráficos e imágenes</b>',
    '/grafico Argentina — Probabilidades + ELO en imagen',
    '/en_vivo — Marcadores y estadísticas en tiempo real',
    '',
    '🧮 <b>Apuestas</b>',
    '/portafolio — P&L realizado + posiciones abiertas',
    '/upsets — Divergencias ELO vs cuotas de mercado',
    '/grupos A — Probabilidad de clasificación por grupo',
    '',
    '/ayuda — Ver este menú'
  ].join('\n');
}

// ─── /hoy ──────────────────────────────────────────────────────────────────────

function buildTodayCommandResponse_() {
  const date = todayChile_();
  const partidos = getTodayFixturesForReport_(date);

  if (!partidos.length) return `No hay partidos registrados para hoy ${date}.`;

  let msg = `📅 <b>Partidos de hoy ${date}</b>\n`;

  partidos.forEach(p => {
    const score = (p.goles_local !== '' && p.goles_local !== null)
      ? ` ${p.goles_local} - ${p.goles_visitante}`
      : '';
    msg += `\n⚽ <b>${p.local}${score} vs ${p.visitante}</b>`;
    msg += `\n🕒 ${p.hora_chile || ''}`;
    msg += `\n🏟️ ${p.estadio || 'Sin estadio'}\n`;
  });

  return msg.trim();
}

// ─── /ayer ─────────────────────────────────────────────────────────────────────

function buildYesterdayCommandResponse_() {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  const date = Utilities.formatDate(d, CONFIG.TIMEZONE, 'yyyy-MM-dd');

  const rows = readAll_(CONFIG.SHEETS.PARTIDOS).filter(r => normalizeFecha_(r.fecha) === date);

  if (!rows.length) return `No encontré resultados para ayer ${date}.`;

  let msg = `📊 <b>Resultados ${date}</b>\n`;

  rows.forEach(r => {
    msg += `\n${r.local} <b>${r.goles_local ?? ''} - ${r.goles_visitante ?? ''}</b> ${r.visitante}`;
  });

  return msg.trim();
}

// ─── /proximos ─────────────────────────────────────────────────────────────────

function buildUpcomingCommandResponse_() {
  const today = new Date();
  const dates = [1, 2, 3].map(n => {
    const d = new Date(today);
    d.setDate(d.getDate() + n);
    return Utilities.formatDate(d, CONFIG.TIMEZONE, 'yyyy-MM-dd');
  });

  const allRows = readAll_(CONFIG.SHEETS.PARTIDOS);

  let msg = '📆 <b>Próximos partidos</b>\n';
  let total = 0;

  dates.forEach(date => {
    const rows = allRows.filter(r => normalizeFecha_(r.fecha) === date);
    if (!rows.length) return;

    msg += `\n<b>${date}</b>`;
    rows.forEach(r => {
      msg += `\n⚽ ${r.local} vs ${r.visitante} — 🕒 ${r.hora_chile || ''}`;
    });
    msg += '\n';
    total += rows.length;
  });

  if (!total) return 'No hay partidos registrados en los próximos 3 días.';

  return msg.trim();
}

// ─── /seleccion ────────────────────────────────────────────────────────────────

function buildTeamCommandResponse_(team) {
  if (!team) return 'Uso: /seleccion Brasil';

  const rows = readAll_(CONFIG.SHEETS.PARTIDOS).filter(r => {
    const local = String(r.local || '').toLowerCase();
    const visitante = String(r.visitante || '').toLowerCase();
    const q = team.toLowerCase();
    return local.includes(q) || visitante.includes(q);
  });

  if (!rows.length) return `No encontré partidos para: ${team}`;

  let msg = `🔎 <b>Partidos de ${team}</b>\n`;

  rows.slice(-10).forEach(r => {
    const score = (r.goles_local !== '' && r.goles_local !== null)
      ? `${r.goles_local} - ${r.goles_visitante}`
      : 'vs';
    msg += `\n${r.fecha} — ${r.local} <b>${score}</b> ${r.visitante}`;
  });

  return msg.trim();
}

// ─── /stats ────────────────────────────────────────────────────────────────────

function buildTeamStatsResponse_(team) {
  if (!team) return 'Uso: /stats Argentina';

  const q = team.toLowerCase();
  const rows = readAll_(CONFIG.SHEETS.PARTIDOS).filter(r => {
    return String(r.local || '').toLowerCase().includes(q) ||
           String(r.visitante || '').toLowerCase().includes(q);
  });

  if (!rows.length) return `Sin partidos para: ${team}`;

  let gf = 0, gc = 0, pg = 0, pe = 0, pp = 0, pj = 0;
  let posesionTotal = 0, posesionCount = 0;
  let tirosTotal = 0, tirosCount = 0;

  rows.forEach(r => {
    const isHome = String(r.local || '').toLowerCase().includes(q);
    const gl = Number(isHome ? r.goles_local : r.goles_visitante) || 0;
    const gc_ = Number(isHome ? r.goles_visitante : r.goles_local) || 0;

    if (r.goles_local === '' || r.goles_local === null) return;

    pj++;
    gf += gl;
    gc += gc_;

    if (gl > gc_) pg++;
    else if (gl === gc_) pe++;
    else pp++;

    const pos = Number(isHome ? r.posesion_local : r.posesion_visitante);
    if (!isNaN(pos) && pos > 0) { posesionTotal += pos; posesionCount++; }

    const tiros = Number(isHome ? r.tiros_local : r.tiros_visitante);
    if (!isNaN(tiros) && tiros > 0) { tirosTotal += tiros; tirosCount++; }
  });

  const posAvg = posesionCount ? Math.round(posesionTotal / posesionCount) : 'N/A';
  const tirosAvg = tirosCount ? Math.round(tirosTotal / tirosCount) : 'N/A';

  return [
    `📊 <b>Estadísticas de ${team}</b>`,
    `PJ: ${pj}  PG: ${pg}  PE: ${pe}  PP: ${pp}`,
    `Goles: ${gf} favor / ${gc} contra`,
    `Posesión prom: ${posAvg}%`,
    `Tiros prom: ${tirosAvg}`
  ].join('\n');
}

// ─── /jugador ──────────────────────────────────────────────────────────────────

function buildPlayerStatsResponse_(name) {
  if (!name) return 'Uso: /jugador Messi';

  const q = name.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

  const rows = readAll_(CONFIG.SHEETS.RESUMEN_JUGADOR_PARTIDO).filter(r => {
    const n = String(r.player_name || r.jugador || '').toLowerCase()
      .normalize('NFD').replace(/[̀-ͯ]/g, '');
    return n.includes(q);
  });

  if (!rows.length) return `No encontré estadísticas para: ${name}`;

  let goles = 0, asistencias = 0, amarillas = 0, rojas = 0, partidos = 0;

  rows.forEach(r => {
    partidos++;
    goles += Number(r.goals || r.goles || 0);
    asistencias += Number(r.assists || r.asistencias || 0);
    amarillas += Number(r.yellow_cards || r.amarillas || 0);
    rojas += Number(r.red_cards || r.rojas || 0);
  });

  const displayName = rows[0].player_name || rows[0].jugador || name;
  const equipo = rows[0].team_name || rows[0].equipo || '';

  return [
    `⚽ <b>${displayName}</b> (${equipo})`,
    `Partidos: ${partidos}`,
    `Goles: ${goles}  Asistencias: ${asistencias}`,
    `Amarillas: ${amarillas}  Rojas: ${rojas}`
  ].join('\n');
}

// ─── /clima ────────────────────────────────────────────────────────────────────

function buildWeatherResponse_(cityOrStadium) {
  if (!cityOrStadium) return 'Uso: /clima Miami';

  const q = cityOrStadium.toLowerCase();

  const rows = readAll_(CONFIG.SHEETS.ESTADIOS_CLIMA).filter(r => {
    return String(r.ciudad || r.city || '').toLowerCase().includes(q) ||
           String(r.estadio || r.stadium || '').toLowerCase().includes(q);
  });

  if (!rows.length) return `Sin datos de clima para: ${cityOrStadium}`;

  const latest = rows[rows.length - 1];

  const temp = latest.temperatura_c !== undefined ? latest.temperatura_c : latest.temperature_c;
  const hum = latest.humedad !== undefined ? latest.humedad : latest.humidity;
  const wind = latest.viento_kmh !== undefined ? latest.viento_kmh : latest.wind_kmh;
  const rain = latest.prob_lluvia !== undefined ? latest.prob_lluvia : latest.rain_probability;
  const condition = latest.condicion !== undefined ? latest.condicion : latest.condition;

  return [
    `🌤️ <b>Clima — ${latest.estadio || latest.stadium || cityOrStadium}</b>`,
    `🌡️ Temperatura: ${temp !== null && temp !== '' ? temp + '°C' : 'N/A'}`,
    `💧 Humedad: ${hum !== null && hum !== '' ? hum + '%' : 'N/A'}`,
    `💨 Viento: ${wind !== null && wind !== '' ? wind + ' km/h' : 'N/A'}`,
    `🌧️ Prob. lluvia: ${rain !== null && rain !== '' ? rain + '%' : 'N/A'}`,
    `☀️ Condición: ${condition || 'N/A'}`
  ].join('\n');
}

// ─── /h2h ──────────────────────────────────────────────────────────────────────

function buildH2HCommandResponse_(args) {
  if (!args) return 'Uso: /h2h España vs Francia';

  const separator = args.toLowerCase().indexOf(' vs ');

  if (separator === -1) return 'Formato: /h2h España vs Francia';

  const team1 = args.substring(0, separator).trim();
  const team2 = args.substring(separator + 4).trim();

  const q1 = team1.toLowerCase();
  const q2 = team2.toLowerCase();

  try {
    const sheet = SpreadsheetApp.openById(getSpreadsheetId_()).getSheetByName('HistorialH2H');
    if (!sheet || sheet.getLastRow() <= 1) {
      return `Sin historial H2H para ${team1} vs ${team2}. Los datos se cargan antes de cada partido.`;
    }

    const rows = readAll_('HistorialH2H').filter(r => {
      const ref1 = String(r.equipo_local_ref || '').toLowerCase();
      const ref2 = String(r.equipo_visitante_ref || '').toLowerCase();
      return (ref1.includes(q1) && ref2.includes(q2)) ||
             (ref1.includes(q2) && ref2.includes(q1));
    });

    if (!rows.length) {
      return `Sin historial H2H registrado para ${team1} vs ${team2}.`;
    }

    let msg = `📋 <b>Historial ${team1} vs ${team2}</b>\n`;
    rows.slice(0, 5).forEach(r => {
      const fecha = normalizeFecha_(r.fecha);
      msg += `\n${fecha} — ${r.local} <b>${r.goles_local} - ${r.goles_visitante}</b> ${r.visitante} (${r.torneo || ''})`;
    });

    return msg.trim();
  } catch (e) {
    return `Error al consultar H2H: ${e.message}`;
  }
}

// ─── /prediccion ───────────────────────────────────────────────────────────────

function buildPredictionResponse_(team) {
  if (!team) return 'Uso: /prediccion Argentina';

  const q = team.toLowerCase();

  const aiRows = readAll_(CONFIG.SHEETS.AI_ANALYSIS).filter(r => {
    return String(r.local || r.home || '').toLowerCase().includes(q) ||
           String(r.visitante || r.away || '').toLowerCase().includes(q);
  });

  const oddsRows = readAll_(CONFIG.SHEETS.ODDS).filter(r => {
    return String(r.home || r.local || '').toLowerCase().includes(q) ||
           String(r.away || r.visitante || '').toLowerCase().includes(q);
  });

  if (!aiRows.length && !oddsRows.length) {
    return `Sin predicción disponible para: ${team}. Se genera el día anterior al partido.`;
  }

  let msg = `🔮 <b>Predicción — ${team}</b>\n`;

  if (aiRows.length) {
    const latest = aiRows[aiRows.length - 1];
    const summary = latest.resumen_telegram || latest.summary || latest.analisis || '';
    if (summary) msg += `\n${summary}\n`;
  }

  if (oddsRows.length) {
    const h2xRows = oddsRows.filter(r => String(r.mercado || r.market || '') === '1X2');

    if (h2xRows.length >= 3) {
      msg += '\n<b>Cuotas de mercado:</b>';
      h2xRows.slice(-3).forEach(r => {
        const prob = r.probabilidad_modelo || r.model_probability;
        const conf = r.confianza || r.confidence || '';
        const sel = r.seleccion || r.selection || '';
        const odd = r.cuota_real || r.odd || '';
        msg += `\n• ${sel}: ${odd ? odd + ' → ' : ''}${prob ? Math.round(prob * 100) + '%' : 'N/A'} (${conf})`;
      });
    }
  }

  return msg.trim();
}

// ─── /noticias ─────────────────────────────────────────────────────────────────

function buildNewsResponse_(team) {
  if (!team) return 'Uso: /noticias Brasil';

  const q = team.toLowerCase();

  const rows = readAll_(CONFIG.SHEETS.NOTICIAS).filter(r => {
    return String(r.query || r.equipo || r.team || '').toLowerCase().includes(q) ||
           String(r.titulo || r.title || '').toLowerCase().includes(q);
  });

  if (!rows.length) return `Sin noticias recientes para: ${team}`;

  let msg = `📰 <b>Noticias — ${team}</b>\n`;

  rows.slice(-5).reverse().forEach(r => {
    const titulo = r.titulo || r.title || 'Sin título';
    const link = r.link || r.url || '';
    const fecha = String(r.fecha || r.published_at || '').substring(0, 10);

    msg += link
      ? `\n• <a href="${link}">${titulo}</a> (${fecha})`
      : `\n• ${titulo} (${fecha})`;
  });

  return msg.trim();
}

// ─── Utilidades ────────────────────────────────────────────────────────────────

function splitMessage_(text, maxLen) {
  if (text.length <= maxLen) return [text];

  const chunks = [];
  let start = 0;

  while (start < text.length) {
    let end = start + maxLen;
    if (end < text.length) {
      const lastNewline = text.lastIndexOf('\n', end);
      if (lastNewline > start) end = lastNewline;
    }
    chunks.push(text.substring(start, end));
    start = end;
  }

  return chunks;
}
