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
  // Si hay parámetro ?tab= → API del dashboard web
  if (e && e.parameter && e.parameter.tab) {
    return routeWebRequest_(e);
  }
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

  if (cmd_ === '/alertas') {
    try { sendTelegramMessageToSingleChat_(chatId, buildAlertasToggleText_(args_, chatId)); } catch (e_) {}
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
    case '/arbitros':    return buildArbitrosResumenText_();
    case '/ev':          return buildEvSummaryText_();
    case '/elo':         return buildEloRankingText_();
    case '/historial':   return buildBettingHistoryText_();
    case '/calibrar':    return buildCalibrationText_();
    case '/en_vivo':     return buildLiveMatchesText_();
    case '/grafico':     return null; // manejado antes del switch (necesita chatId)
    case '/portafolio':  return buildPortfolioText_();
    case '/upsets':      return buildUpsetRankingText_();
    case '/grupos':      return buildGroupSimText_(args);
    // ── Comandos nuevos ───────────────────────────────────────────────────────
    case '/goleadores':  return buildGoleadoresText_();
    case '/goleador':   return buildScorerCommandText_(args);
    case '/grupo':       return buildGrupoDetalleText_(args);
    case '/partido':     return buildPartidoDirectoText_(args);
    case '/alertas':     return buildAlertasToggleText_(args, chatId);
    case '/eliminados':  return buildEliminadosText_();
    case '/liga':        return buildLeagueManagerText_(args);
    case '/corners':     return buildCornersCommandText_(args);
    case '/tarjetas':    return buildCardsCommandText_(args);
    case '/ayuda':       return buildHelpCommandResponse_();
    default:             return null;
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

  const searchTerms = teamSearchTerms_(pais);
  const matchToday = partidos.find(r => {
    const fecha = normalizeFecha_(r.fecha);
    if (fecha !== today) return false;
    const local     = norm_(r.local     || '');
    const visitante = norm_(r.visitante || '');
    return searchTerms.some(t => local.includes(t) || visitante.includes(t));
  });

  let msg = '';

  if (matchToday) {
    const esLocal    = searchTerms.some(t => norm_(matchToday.local || '').includes(t));
    const equipoNombre = esLocal ? matchToday.local : matchToday.visitante;
    const rival        = esLocal ? matchToday.visitante : matchToday.local;
    const estado       = String(matchToday.status || '').toUpperCase();
    const liveStatuses = ['1H','HT','2H','ET','BT','P','LIVE','INT','FT','AET','PEN'];
    const esVivo       = liveStatuses.includes(estado);

    msg += `⚽ <b>${equipoNombre} vs ${rival}</b> — ${esVivo ? '🔴 EN VIVO' : estado}\n`;

    // Intentar obtener alineación (desde hoja o API si está en curso)
    const fixtureId = matchToday.fixture_id_af || matchToday.match_id;
    let equipoLineup = null;
    if (fixtureId) {
      const fakeFixture = { fixture: { id: fixtureId, status: { short: estado } } };
      const lineups = getOrFetchLineup_(fakeFixture);
      equipoLineup = lineups && findTeamInLineup_(lineups, q);

      if (equipoLineup) {
        msg += buildLineupText_(equipoNombre, equipoLineup);
      }
    }

    if (!fixtureId || !equipoLineup) {
      // Fallback: buscar en ESPN por fecha + equipos
      try {
        const espnId = findEspnEventId_(
          normalizeFecha_(matchToday.fecha),
          matchToday.local,
          matchToday.visitante
        );
        if (espnId) {
          const summary  = fetchEspnSummary_(espnId);
          const rosters  = summary.rosters || [];
          if (rosters.length) {
            const isHome   = searchTerms.some(t => norm_(matchToday.local || '').includes(t));
            const side     = isHome ? 'home' : 'away';
            const lineup   = parseEspnLineup_(rosters, side);
            if (lineup) {
              const scorersMap = parseEspnScorers_(summary.scoringPlays || [], summary.keyEvents || []);
              msg += formatEspnLineupText_(equipoNombre, lineup, scorersMap);
              // Mostrar suplentes del roster ESPN
              const teamRoster = rosters.find(r_ => r_.homeAway === side);
              if (teamRoster) {
                const suplentes = (teamRoster.roster || [])
                  .filter(p => !p.starter)
                  .map(p => `${(p.athlete||{}).jersey ? (p.athlete||{}).jersey + '.' : ''}${(p.athlete||{}).shortName || (p.athlete||{}).displayName || ''}`)
                  .filter(Boolean);
                if (suplentes.length) {
                  msg += `<i>Banco:</i> ${suplentes.join(', ')}\n`;
                }
              }
            } else {
              msg += '\n<i>Alineación aún no disponible (se publica al inicio del partido)</i>\n';
            }
          } else {
            msg += '\n<i>Alineación aún no disponible (se publica al inicio del partido)</i>\n';
          }
        } else {
          msg += '\n<i>Alineación aún no disponible (se publica al inicio del partido)</i>\n';
        }
      } catch (espnErr) {
        console.warn('jugadores ESPN fallback:', espnErr.message);
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
    '📅 <b>Partidos</b>',
    '/hoy — En vivo, terminados y próximos de hoy',
    '/ayer — Resultados de ayer con goleadores',
    '/proximos — Próximos 3 días con clima y hora Chile',
    '/en_vivo — Partido en curso: marcador, stats, goles, tarjetas',
    '/partido Argentina vs Francia — Resultado o fecha de un partido',
    '',
    '🏅 <b>Equipos y jugadores</b>',
    '/seleccion Brasil — Todos los partidos de un equipo',
    '/jugadores Argentina — Plantel + alineación en vivo',
    '/jugador Messi — Stats del jugador en el torneo',
    '/stats Argentina — Stats acumuladas del equipo',
    '/goleadores — Top 15 goleadores del torneo',
    '/goleador Ecuador — Probables anotadores del equipo',
    '/goleador partido Ecuador — Goleadores en próximo partido',
    '',
    '📊 <b>Clasificación y grupos</b>',
    '/tabla — Tabla de posiciones de los 12 grupos',
    '/grupo A — Tabla + resultados + próximos de un grupo',
    '/eliminados — Quién sigue y quién ya se fue del torneo',
    '/grupos A — Probabilidad de clasificación (simulación)',
    '',
    '🔍 <b>Análisis</b>',
    '/prediccion Argentina — Análisis IA + cuotas del partido',
    '/h2h España vs Francia — Historial cara a cara',
    '/noticias Brasil — Últimas noticias del equipo',
    '/arbitros — Árbitros asignados a partidos de hoy',
    '/clima Miami — Clima del estadio de una ciudad',
    '',
    '🔔 <b>Alertas y configuración</b>',
    '/alertas on — Recibir alertas de goles y tarjetas rojas',
    '/alertas off — Desactivar alertas automáticas',
    '/liga — Ver y cambiar la liga activa (Premier, La Liga, Champions...)',
    '',
    '📈 <b>Modelo y apuestas</b>',
    '/corners — Predicción de córners (O/U 9.5, por equipo)',
    '/tarjetas — Predicción de tarjetas (O/U 4.5, roja sí/no)',
    '/ev — Apuestas con valor esperado positivo (EV+)',
    '/upsets — Divergencias ELO vs cuotas de mercado',
    '/elo — Ranking ELO de los 48 equipos',
    '/grafico Argentina — Gráfico de probabilidades',
    '/portafolio — P&L de apuestas registradas',
    '',
    '/ayuda — Ver este menú',
    '',
    '<i>Nombres de equipos sin tildes y en cualquier idioma ✓</i>'
  ].join('\n');
}

// ─── /hoy ──────────────────────────────────────────────────────────────────────

function buildTodayCommandResponse_() {
  const date     = todayChile_();
  const partidos = getTodayFixturesForReport_(date);

  if (!partidos.length) return `No hay partidos registrados para hoy ${date}.`;

  // Deduplicar por par de equipos: si hay duplicados (ESPN + API-Football),
  // conservar el que tenga status más informativo (en vivo > terminado > NS).
  const STATUS_PRIORITY = s => {
    if (['1H','2H','HT','ET','P','BT','INT','LIVE'].includes(s)) return 3;
    if (['FT','AET','PEN'].includes(s)) return 2;
    return 1; // NS, TBD, vacío
  };
  const toKey_hoy_ = s => {
    const es = teamNameToSpanish_(String(s || ''));
    return es.toLowerCase().replace(/[áàä]/g,'a').replace(/[éèë]/g,'e')
      .replace(/[íìï]/g,'i').replace(/[óòö]/g,'o').replace(/[úùü]/g,'u')
      .replace(/ñ/g,'n').replace(/[^a-z0-9]/g,'').trim();
  };
  const deduped = new Map();
  partidos.forEach(p => {
    const key = toKey_hoy_(p.local) + '_' + toKey_hoy_(p.visitante);
    const existing = deduped.get(key);
    if (!existing || STATUS_PRIORITY(p.status) > STATUS_PRIORITY(existing.status)) {
      deduped.set(key, p);
    }
  });
  const partidosFinal = [...deduped.values()]
    .sort((a, b) => (a.hora_chile || '').localeCompare(b.hora_chile || ''));

  // Mapa de clima por fixture_id
  const climaMap = {};
  try {
    readAll_(CONFIG.SHEETS.ESTADIOS_CLIMA).forEach(r => {
      if (r.fixture_id) climaMap[String(r.fixture_id)] = r;
    });
  } catch (e) { /* sin clima */ }

  const FINAL_STATUS = ['FT','AET','PEN'];
  const LIVE_STATUS  = ['1H','2H','HT','ET','P','BT','INT','LIVE'];

  let terminados = partidosFinal.filter(p => FINAL_STATUS.includes(p.status));
  let enVivo     = partidosFinal.filter(p => LIVE_STATUS.includes(p.status));
  let proximos   = partidosFinal.filter(p =>
    !FINAL_STATUS.includes(p.status) && !LIVE_STATUS.includes(p.status)
  );

  // Obtener estado real desde ESPN scoreboard (overridea status de la hoja)
  const liveScoreMap = {};
  const ESPN_LIVE_MAP = {
    'in progress':'1H', 'halftime':'HT', 'end period':'2H',
    'final':'FT', 'full time':'FT', 'final/aet':'AET', 'final/pen':'PEN'
  };
  try {
    const espnData = espnGet_('/scoreboard');
    const normN = s => String(s || '').toLowerCase()
      .replace(/[áàä]/g,'a').replace(/[éèë]/g,'e').replace(/[íìï]/g,'i')
      .replace(/[óòö]/g,'o').replace(/[úùü]/g,'u').replace(/ñ/g,'n')
      .replace(/[^a-z]/g,'');
    (espnData.events || []).forEach(ev => {
      const comp    = (ev.competitions || [])[0] || {};
      const comps   = comp.competitors || [];
      const home    = comps.find(c => c.homeAway === 'home') || {};
      const away    = comps.find(c => c.homeAway === 'away') || {};
      const stateDesc = String((ev.status && ev.status.type && ev.status.type.description) || '').toLowerCase();
      const espnShort = String((ev.status && ev.status.type && ev.status.type.shortDetail) || '');
      const overrideStatus = ESPN_LIVE_MAP[stateDesc] || null;
      const score = {
        gLocal:  home.score !== undefined ? home.score : null,
        gVisit:  away.score !== undefined ? away.score : null,
        status:  overrideStatus,
        minuto:  espnShort
      };
      const hNameEn = (home.team||{}).displayName || '';
      const aNameEn = (away.team||{}).displayName || '';
      liveScoreMap[normN(hNameEn) + '_' + normN(aNameEn)] = score;
      liveScoreMap[normN(teamNameToSpanish_(hNameEn)) + '_' + normN(teamNameToSpanish_(aNameEn))] = score;
    });
  } catch (e_) { /* usar datos de hoja como fallback */ }

  // Override status en partidosFinal con lo que dice ESPN en tiempo real
  const normN_ = s => String(s || '').toLowerCase()
    .replace(/[áàä]/g,'a').replace(/[éèë]/g,'e').replace(/[íìï]/g,'i')
    .replace(/[óòö]/g,'o').replace(/[úùü]/g,'u').replace(/ñ/g,'n')
    .replace(/[^a-z]/g,'');
  partidosFinal.forEach(p => {
    const k = normN_(teamNameToSpanish_(p.local)) + '_' + normN_(teamNameToSpanish_(p.visitante));
    const espn = liveScoreMap[k];
    if (espn && espn.status) p.status = espn.status;
  });

  // Re-clasificar con statuses actualizados
  terminados = partidosFinal.filter(p => FINAL_STATUS.includes(p.status));
  enVivo     = partidosFinal.filter(p => LIVE_STATUS.includes(p.status));
  proximos   = partidosFinal.filter(p =>
    !FINAL_STATUS.includes(p.status) && !LIVE_STATUS.includes(p.status)
  );

  let msg = `📅 <b>Partidos de hoy ${date}</b>\n`;

  if (terminados.length) {
    msg += '\n✅ <b>Resultados</b>\n';
    terminados.forEach(p => {
      const local = teamNameToSpanish_(p.local);
      const visit = teamNameToSpanish_(p.visitante);
      msg += `\n⚽ <b>${local} ${p.goles_local} - ${p.goles_visitante} ${visit}</b>`;
      if (p.grupo) msg += ` <i>(Grupo ${p.grupo})</i>`;
      msg += `\n🏟️ ${p.estadio}`;
      msg += '\n';
    });
  }

  if (enVivo.length) {
    msg += '\n🔴 <b>En vivo</b>\n';
    enVivo.forEach(p => {
      const local = teamNameToSpanish_(p.local);
      const visit = teamNameToSpanish_(p.visitante);
      const liveKey = normN_(teamNameToSpanish_(p.local)) + '_' + normN_(teamNameToSpanish_(p.visitante));
      const liveScore = liveScoreMap[liveKey] || {};
      const gLocal = liveScore.gLocal !== null && liveScore.gLocal !== undefined
        ? liveScore.gLocal
        : (p.goles_local !== null && p.goles_local !== '' ? p.goles_local : '0');
      const gVisit = liveScore.gVisit !== null && liveScore.gVisit !== undefined
        ? liveScore.gVisit
        : (p.goles_visitante !== null && p.goles_visitante !== '' ? p.goles_visitante : '0');
      const minuto = liveScore.minuto ? ` (${liveScore.minuto})` : ` (${p.status})`;
      msg += `\n🔴 <b>${local} ${gLocal} - ${gVisit} ${visit}</b>${minuto}`;
      if (p.grupo) msg += ` <i>(Grupo ${p.grupo})</i>`;
      msg += `\n🏟️ ${p.estadio}`;
      msg += '\n';
    });
  }

  if (proximos.length) {
    msg += '\n🕒 <b>Próximos</b>\n';
    proximos.forEach(p => {
      const local = teamNameToSpanish_(p.local);
      const visit = teamNameToSpanish_(p.visitante);
      const fid   = String(p.fixture_id);
      const clima = climaMap[fid] || null;

      msg += `\n⚽ <b>${local} vs ${visit}</b>`;
      if (p.grupo) msg += ` <i>(Grupo ${p.grupo})</i>`;
      msg += `\n🕒 ${p.hora_chile || 'hora pendiente'} hrs Chile`;
      msg += `\n🏟️ ${p.estadio}${p.ciudad ? ', ' + p.ciudad : ''}`;
      if (clima && clima.temperatura_c !== null && clima.temperatura_c !== '') {
        const lluvia = Number(clima.prob_lluvia) > 30
          ? ` ☔${clima.prob_lluvia}%` : '';
        msg += `\n🌡️ ${clima.temperatura_c}°C, ${clima.humedad}% hum${lluvia}`;
      }
      msg += '\n';
    });
  }

  return msg.trim();
}

// ─── /ayer ─────────────────────────────────────────────────────────────────────

function buildYesterdayCommandResponse_() {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  const date = Utilities.formatDate(d, CONFIG.TIMEZONE, 'yyyy-MM-dd');

  const FT_STATUSES = ['FT','AET','PEN'];
  const allRows = readAll_(CONFIG.SHEETS.PARTIDOS).filter(r =>
    normalizeFecha_(r.fecha) === date &&
    FT_STATUSES.includes(String(r.status || '').toUpperCase())
  );

  // Deduplicar por par de equipos (puede haber entradas ESPN + API-Football)
  const toKey_ayer_ = s => {
    const es = teamNameToSpanish_(String(s || ''));
    return es.toLowerCase().replace(/[áàä]/g,'a').replace(/[éèë]/g,'e')
      .replace(/[íìï]/g,'i').replace(/[óòö]/g,'o').replace(/[úùü]/g,'u')
      .replace(/ñ/g,'n').replace(/[^a-z0-9]/g,'').trim();
  };
  const dedupAyer = new Map();
  allRows.forEach(r => {
    const key = toKey_ayer_(r.local) + '_' + toKey_ayer_(r.visitante);
    const existing = dedupAyer.get(key);
    // Preferir fila con marcador sobre fila sin marcador
    const hasScore    = r.goles_local !== '' && r.goles_local !== null && r.goles_local !== undefined;
    const prevHasScore = existing && (existing.goles_local !== '' && existing.goles_local !== null && existing.goles_local !== undefined);
    if (!existing || (hasScore && !prevHasScore)) dedupAyer.set(key, r);
  });
  const rows = [...dedupAyer.values()];

  if (!rows.length) return `No encontré resultados para ayer ${date}.`;

  let msg = `📊 <b>Resultados ${date}</b>\n`;

  rows.sort((a, b) => (normalizeHora_(a.hora_chile) || '').localeCompare(normalizeHora_(b.hora_chile) || ''))
    .forEach(r => {
      const local = teamNameToSpanish_(r.local);
      const visit = teamNameToSpanish_(r.visitante);
      const gl    = r.goles_local    ?? '';
      const gv    = r.goles_visitante ?? '';
      const grupo = r.grupo ? ` <i>(Grupo ${r.grupo})</i>` : '';
      const hora  = normalizeHora_(r.hora_chile);
      msg += `\n⚽ <b>${local} ${gl} - ${gv} ${visit}</b>${grupo}`;
      if (hora) msg += ` — 🕒${hora}`;
      msg += `\n🏟️ ${r.estadio || ''}`;
      msg += '\n';
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
    rows.sort((a, b) => (normalizeHora_(a.hora_chile) || '').localeCompare(normalizeHora_(b.hora_chile) || ''))
      .forEach(r => {
        const local = teamNameToSpanish_(r.local);
        const visit = teamNameToSpanish_(r.visitante);
        const hora  = normalizeHora_(r.hora_chile);
        msg += `\n⚽ ${local} vs ${visit} — 🕒 ${hora || '?'} hrs`;
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

  const terms = teamSearchTerms_(team);
  const norm  = s => String(s || '').toLowerCase()
    .replace(/[áàä]/g,'a').replace(/[éèë]/g,'e').replace(/[íìï]/g,'i')
    .replace(/[óòö]/g,'o').replace(/[úùü]/g,'u').replace(/ñ/g,'n').trim();

  const rows = readAll_(CONFIG.SHEETS.PARTIDOS).filter(r => {
    const local    = norm(r.local);
    const visitante = norm(r.visitante);
    return terms.some(t => local.includes(t) || visitante.includes(t));
  });

  if (!rows.length) return `No encontré partidos para: ${team}`;

  const displayName = teamNameToSpanish_(rows[0].local.toLowerCase().includes(
    terms[0]) ? rows[0].local : rows[0].visitante);

  let msg = `🔎 <b>Partidos de ${displayName}</b>\n`;

  rows.slice(-10)
    .sort((a, b) => (normalizeFecha_(a.fecha) || '').localeCompare(normalizeFecha_(b.fecha) || ''))
    .forEach(r => {
      const local = teamNameToSpanish_(r.local);
      const visit = teamNameToSpanish_(r.visitante);
      const fecha = normalizeFecha_(r.fecha);
      const hora  = normalizeHora_(r.hora_chile);
      const hasScore = r.goles_local !== '' && r.goles_local !== null &&
                       r.goles_local !== undefined;
      const score = hasScore
        ? `<b>${r.goles_local} - ${r.goles_visitante}</b>`
        : `🕒 ${hora || '?'}`;
      msg += `\n${fecha} — ${local} ${score} ${visit}`;
    });

  return msg.trim();
}

// ─── /stats ────────────────────────────────────────────────────────────────────

function buildTeamStatsResponse_(team) {
  if (!team) return 'Uso: /stats Argentina';

  const terms = teamSearchTerms_(team);
  const norm  = s => String(s || '').toLowerCase()
    .replace(/[áàä]/g,'a').replace(/[éèë]/g,'e').replace(/[íìï]/g,'i')
    .replace(/[óòö]/g,'o').replace(/[úùü]/g,'u').replace(/ñ/g,'n').trim();

  const rows = readAll_(CONFIG.SHEETS.PARTIDOS).filter(r => {
    const local    = norm(r.local);
    const visitante = norm(r.visitante);
    return terms.some(t => local.includes(t) || visitante.includes(t));
  });

  if (!rows.length) return `Sin partidos para: ${team}`;

  let gf = 0, gc = 0, pg = 0, pe = 0, pp = 0, pj = 0;
  let posesionTotal = 0, posesionCount = 0;
  let tirosTotal = 0, tirosCount = 0;

  const firstMatch = rows[0];
  const displayName = teamNameToSpanish_(
    norm(firstMatch.local) === terms[0] || terms.some(t => norm(firstMatch.local).includes(t))
      ? firstMatch.local : firstMatch.visitante
  );

  rows.forEach(r => {
    const isHome = terms.some(t => norm(r.local).includes(t));
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

  let msg = [
    `📊 <b>Estadísticas de ${displayName}</b>`,
    `PJ: ${pj}  PG: ${pg}  PE: ${pe}  PP: ${pp}`,
    `Goles: ${gf} favor / ${gc} contra`,
    `Posesión prom: ${posAvg}%`,
    `Tiros prom: ${tirosAvg}`
  ].join('\n');

  // ESPN: forma reciente
  try {
    const formaText = formatTeamFormText_(team);
    if (formaText) msg += `\n\n🔄 <b>Forma reciente</b>\n${formaText}`;
  } catch (e) { /* ESPN no disponible */ }

  return msg;
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
  if (!team) return 'Uso: /prediccion Argentina\nO: /prediccion Argentina vs Brasil';

  // Detectar si viene "X vs Y"
  const vsMatch = team.match(/^(.+?)\s+vs\.?\s+(.+)$/i);
  if (vsMatch) {
    return buildPoissonPredictionText_(vsMatch[1].trim(), vsMatch[2].trim());
  }

  const q  = norm_(team);
  const normN = s => String(s||'').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g,'').replace(/[^a-z]/g,'');

  // Buscar partido próximo del equipo en Partidos
  const partidos = readAll_(CONFIG.SHEETS.PARTIDOS)
    .filter(r => {
      const st = String(r.status || '').toUpperCase();
      if (st === 'FT' || st === 'AET' || st === 'PEN') return false;
      return normN(r.local||'').includes(q) || normN(r.visitante||'').includes(q);
    })
    .sort((a, b) => new Date(normalizeFecha_(a.fecha)) - new Date(normalizeFecha_(b.fecha)));

  if (!partidos.length) {
    return `Sin partido próximo para: <b>${team}</b>. ¿Ya fue eliminado?\n\nUsa /prediccion EquipoA vs EquipoB para predicción directa.`;
  }

  const fixture = partidos[0];
  const home = fixture.local, away = fixture.visitante;
  const hFlag = teamFlag_(home), aFlag = teamFlag_(away);
  const fecha = normalizeFecha_(fixture.fecha);
  const hora  = normalizeHora_(fixture.hora_chile || fixture.hora) || '';

  let msg = `🔮 <b>Predicción — ${hFlag}${teamNameToSpanish_(home)} vs ${aFlag}${teamNameToSpanish_(away)}</b>\n`;
  msg += `📅 ${fecha}${hora ? ' · ' + hora : ''} (Chile)\n\n`;

  // Poisson
  try {
    const poisson = getPoissonOdds_(home, away, fixture.match_key);
    if (poisson) {
      const pct = v => `${(Number(v)||0).toFixed(1)}%`;
      msg += `<b>📐 Modelo Poisson</b>\n`;
      msg += `${hFlag} Local: <b>${pct(poisson.prob_home)}</b>  `;
      msg += `➖ Empate: <b>${pct(poisson.prob_draw)}</b>  `;
      msg += `${aFlag} Visita: <b>${pct(poisson.prob_away)}</b>\n`;
      msg += `⚽ Goles esperados: <b>${poisson.lambda_home}</b> – <b>${poisson.lambda_away}</b>`;
      if (poisson.goles_esperados) msg += ` (total ${poisson.goles_esperados})`;
      msg += `\n`;
      if (poisson.over_2_5) msg += `📊 Over 2.5: ${pct(poisson.over_2_5)} · BTTS: ${pct(poisson.prob_btts_si)}\n`;
      if (poisson.score_probable) msg += `🎯 Marcador más probable: <b>${poisson.score_probable}</b>\n`;
      msg += '\n';
    }
  } catch (e_) {}

  // ELO
  try {
    const elo = getEloProbabilities_(home, away);
    if (elo) {
      const pct = v => `${Math.round((Number(v)||0)*100)}%`;
      msg += `<b>⚡ ELO Rating</b>\n`;
      msg += `${hFlag} ${pct(elo.home)}  ➖ ${pct(elo.draw)}  ${aFlag} ${pct(elo.away)}\n\n`;
    }
  } catch (e_) {}

  // IA análisis
  try {
    const aiRows = readAll_(CONFIG.SHEETS.AI_ANALYSIS).filter(r =>
      normN(r.local||r.home||'').includes(q) || normN(r.visitante||r.away||'').includes(q)
    );
    if (aiRows.length) {
      const latest = aiRows[aiRows.length - 1];
      const summary = latest.resumen_telegram || latest.summary || '';
      if (summary) msg += `<b>🤖 Análisis IA</b>\n${summary}\n\n`;
    }
  } catch (e_) {}

  // Cuotas de mercado
  try {
    const oddsRows = readAll_(CONFIG.SHEETS.ODDS).filter(r =>
      (normN(r.home||r.local||'').includes(q) || normN(r.away||r.visitante||'').includes(q)) &&
      String(r.mercado||'').toUpperCase() === '1X2'
    );
    if (oddsRows.length) {
      msg += `<b>💰 Cuotas mercado (1X2)</b>\n`;
      const h = oddsRows.find(r => (r.seleccion||'').toLowerCase().includes('home')) || {};
      const d = oddsRows.find(r => (r.seleccion||'').toLowerCase().includes('draw')) || {};
      const a = oddsRows.find(r => (r.seleccion||'').toLowerCase().includes('away')) || {};
      if (h.cuota) msg += `${hFlag} Local ${Number(h.cuota).toFixed(2)}  `;
      if (d.cuota) msg += `➖ Empate ${Number(d.cuota).toFixed(2)}  `;
      if (a.cuota) msg += `${aFlag} Visita ${Number(a.cuota).toFixed(2)}\n`;
    }
  } catch (e_) {}

  msg += `\n<i>💡 Para detalles completos: /prediccion ${teamNameToSpanish_(home)} vs ${teamNameToSpanish_(away)}</i>`;
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

// ═══════════════════════════════════════════════════════════════════════════════
// NUEVOS COMANDOS
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * /goleadores — Top goleadores del torneo con asistencias.
 */
function buildGoleadoresText_() {
  // Fuente primaria: ResumenJugadorPartido acumulado
  const rows = readAll_(CONFIG.SHEETS.RESUMEN_JUGADOR_PARTIDO || 'ResumenJugadorPartido');

  // Dedup: fixture_id + jugador_id → keep latest
  const dedupMap = {};
  rows.forEach(r => {
    const fid = r.fixture_id || r.match_id || '';
    const pid = r.jugador_id || '';
    if (fid && pid) {
      const k = `${fid}_${pid}`;
      const ts = r.timestamp_carga || r.updated_at || '';
      if (!dedupMap[k] || String(ts) > String(dedupMap[k].timestamp_carga || '')) dedupMap[k] = r;
    }
  });
  const deduped = Object.values(dedupMap);

  const totals = {};
  deduped.forEach(r => {
    const key = `${r.jugador_id || r.jugador}`;
    if (!totals[key]) totals[key] = { nombre: r.jugador || '', equipo: r.equipo || '', goles: 0, asistencias: 0 };
    totals[key].goles       += Number(r.goles || 0);
    totals[key].asistencias += Number(r.asistencias || 0);
  });

  const sorted = Object.values(totals)
    .filter(t => t.goles > 0)
    .sort((a, b) => b.goles - a.goles || b.asistencias - a.asistencias)
    .slice(0, 15);

  if (!sorted.length) return '⚽ Aún no hay goles registrados en el torneo.';

  let msg = '🥇 <b>Goleadores — Mundial 2026</b>\n\n';
  sorted.forEach((p, i) => {
    const flag = teamFlag_(p.equipo);
    msg += `${i + 1}. ${flag} <b>${p.nombre}</b> (${p.equipo})\n`;
    msg += `   ⚽ ${p.goles} gol${p.goles !== 1 ? 'es' : ''}`;
    if (p.asistencias) msg += ` · 👟 ${p.asistencias} asist.`;
    msg += '\n';
  });
  return msg.trim();
}

/**
 * /grupo <A-L> — Detalle completo de un grupo: tabla + resultados + próximos.
 */
function buildGrupoDetalleText_(args) {
  if (!args) return 'Uso: /grupo A\n\nGrupos disponibles: A B C D E F G H I J K L';

  const grupoKey = 'Grupo ' + args.toUpperCase().trim().replace(/grupo\s*/i, '');
  const clas = readAll_('Clasificacion').filter(r => r.grupo === grupoKey);
  if (!clas.length) return `No encontré el ${grupoKey}. Usa /grupo A (o B, C... L).`;

  let msg = `🏆 <b>${grupoKey}</b>\n\n`;

  // Tabla
  msg += '<b>Tabla</b>\n';
  clas
    .sort((a, b) => Number(b.puntos||0) - Number(a.puntos||0) || Number(b.gd||0) - Number(a.gd||0))
    .forEach((r, i) => {
      const flag = teamFlag_(r.equipo);
      const pts  = Number(r.puntos || 0);
      const pj   = Number(r.pj || 0);
      const avanza = i < 2 ? '✅' : '  ';
      msg += `${avanza}${i+1}. ${flag} <b>${r.equipo}</b> ${pts}pts`;
      if (pj > 0) msg += ` (${pj}PJ ${r.pg}G ${r.pe}E ${r.pp}P | ${r.gf}:${r.gc})`;
      msg += '\n';
    });

  // Partidos jugados
  const equipos    = clas.map(r => r.equipo);
  const normEquipo = e => teamNameToSpanish_(e).toLowerCase().replace(/[^a-z]/g, '');
  const todos      = readAll_(CONFIG.SHEETS.PARTIDOS);

  const delGrupo = todos.filter(r => {
    const h = normEquipo(r.local || ''), a = normEquipo(r.visitante || '');
    return equipos.some(eq => normEquipo(eq) === h || normEquipo(eq) === a);
  });

  const jugados  = delGrupo.filter(r => ['FT','AET','PEN'].includes(String(r.status||'').toUpperCase()));
  const proximos = delGrupo.filter(r => String(r.status||'').toUpperCase() === 'NS');

  if (jugados.length) {
    msg += '\n<b>Resultados</b>\n';
    jugados.sort((a,b) => normalizeFecha_(a.fecha) > normalizeFecha_(b.fecha) ? -1 : 1)
      .slice(0, 6).forEach(r => {
        const h = teamNameToSpanish_(r.local||''), a = teamNameToSpanish_(r.visitante||'');
        msg += `${teamFlag_(h)} ${h} <b>${r.goles_local}-${r.goles_visitante}</b> ${a} ${teamFlag_(a)}\n`;
      });
  }

  if (proximos.length) {
    msg += '\n<b>Próximos</b>\n';
    proximos.sort((a,b) => normalizeFecha_(a.fecha) > normalizeFecha_(b.fecha) ? 1 : -1)
      .slice(0, 6).forEach(r => {
        const h    = teamNameToSpanish_(r.local||''), a = teamNameToSpanish_(r.visitante||'');
        const hora = normalizeHora_(r.hora_chile || r.hora);
        const fecha = normalizeFecha_(r.fecha);
        msg += `${teamFlag_(h)} ${h} vs ${a} ${teamFlag_(a)} — ${fecha} ${hora}\n`;
      });
  }

  return msg.trim();
}

/**
 * /partido <equipo1> vs <equipo2> — Resultado o fecha de un partido específico.
 */
function buildPartidoDirectoText_(args) {
  if (!args || !args.toLowerCase().includes('vs')) {
    return 'Uso: /partido Argentina vs Francia\n(usa "vs" para separar los equipos)';
  }
  const [rawH, rawA] = args.split(/\s+vs\s+/i);
  const qH = rawH.trim(), qA = rawA ? rawA.trim() : '';
  if (!qH || !qA) return 'Uso: /partido Argentina vs Francia';

  const normN = s => String(s||'').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g,'').replace(/[^a-z0-9 ]/g,'').trim();
  const termsH = teamSearchTerms_(qH).map(normN);
  const termsA = teamSearchTerms_(qA).map(normN);

  const partidos = readAll_(CONFIG.SHEETS.PARTIDOS);
  const match = partidos.find(r => {
    const h = normN(r.local||''), a = normN(r.visitante||'');
    return (termsH.some(t => h.includes(t)) && termsA.some(t => a.includes(t))) ||
           (termsA.some(t => h.includes(t)) && termsH.some(t => a.includes(t)));
  });

  if (!match) return `No encontré un partido entre ${qH} y ${qA} en el Mundial 2026.`;

  const h    = teamNameToSpanish_(match.local||'');
  const a    = teamNameToSpanish_(match.visitante||'');
  const hF   = teamFlag_(h), aF = teamFlag_(a);
  const fecha = normalizeFecha_(match.fecha);
  const hora  = normalizeHora_(match.hora_chile || match.hora);
  const st    = String(match.status||'').toUpperCase();

  if (['FT','AET','PEN'].includes(st)) {
    let msg = `${hF} <b>${h} ${match.goles_local} - ${match.goles_visitante} ${a}</b> ${aF}\n`;
    msg += `✅ ${st} · ${fecha}\n`;
    msg += `🏟️ ${match.estadio || ''}\n`;
    // Goleadores si hay espn_id
    const espnId = match.espn_id || match.espn_event_id;
    if (espnId) {
      try {
        const summary = fetchEspnSummary_(espnId);
        const events  = parseEspnMatchEvents_(summary);
        ['home','away'].forEach((side, idx) => {
          const nombre = idx === 0 ? h : a;
          if (events[side].goles.length) msg += `⚽ ${nombre}: ${events[side].goles.join(', ')}\n`;
        });
        // H2H si está disponible
      } catch (e_) {}
    }
    return msg.trim();
  }

  // Partido futuro
  let msg = `${hF} <b>${h}</b> vs <b>${a}</b> ${aF}\n`;
  msg += `📅 ${fecha} · ⏰ ${hora} (hora Chile)\n`;
  msg += `🏟️ ${match.estadio || ''}, ${match.ciudad || ''}\n`;
  msg += `\n<i>Usa /prediccion ${h.toLowerCase()} para análisis IA</i>`;
  return msg.trim();
}

/**
 * /alertas on|off — Activa o desactiva alertas de goles/rojas para el usuario.
 */
function buildAlertasToggleText_(args, chatId) {
  if (!chatId) return 'Comando no disponible en este contexto.';
  const on = !args || args.toLowerCase().includes('on') || args.toLowerCase().includes('activar');
  const sheet = getSheet_('Suscriptores');
  const values = sheet.getDataRange().getValues();
  const headers = values[0];
  const chatCol = headers.indexOf('chat_id');
  const alertCol = headers.indexOf('alertas');

  if (chatCol === -1) return '⚠️ Error interno: columna chat_id no encontrada.';

  let found = false;
  for (let i = 1; i < values.length; i++) {
    if (String(values[i][chatCol]) === String(chatId)) {
      if (alertCol !== -1) sheet.getRange(i+1, alertCol+1).setValue(on ? '1' : '0');
      found = true;
      break;
    }
  }
  if (!found) {
    // Registrar nuevo suscriptor con alertas activadas
    sheet.appendRow([chatId, '', new Date(), on ? '1' : '0']);
  }

  return on
    ? '🔔 <b>Alertas activadas.</b>\n\nTe notificaré cuando haya goles, tarjetas rojas o VAR en partidos del Mundial.'
    : '🔕 <b>Alertas desactivadas.</b>\n\nNo recibirás notificaciones automáticas. Usa /alertas on para reactivar.';
}

/**
 * /eliminados — Muestra qué equipos siguen en el torneo y cuáles fueron eliminados.
 */
function buildEliminadosText_() {
  const clas = readAll_('Clasificacion');
  const partidos = readAll_(CONFIG.SHEETS.PARTIDOS);

  // Un equipo está eliminado si ya jugó 3 partidos de grupo con 0 posibilidades matemáticas
  // Simplificación: si tiene 3PJ y no puede alcanzar al 2do del grupo
  const byGroup = {};
  clas.forEach(r => {
    const g = r.grupo;
    if (!byGroup[g]) byGroup[g] = [];
    byGroup[g].push({ equipo: r.equipo, pj: Number(r.pj||0), puntos: Number(r.puntos||0), gd: Number(r.gd||0) });
  });

  const eliminados = [], enCarrera = [];

  Object.entries(byGroup).forEach(([grupo, equipos]) => {
    const sorted = equipos.sort((a,b) => b.puntos - a.puntos || b.gd - a.gd);
    const segundoPuntos = sorted[1] ? sorted[1].puntos : 0;
    equipos.forEach(eq => {
      const partidosRestantes = 3 - eq.pj;
      const maxPuntosAlcanzables = eq.puntos + partidosRestantes * 3;
      if (eq.pj >= 2 && maxPuntosAlcanzables < segundoPuntos) {
        eliminados.push({ ...eq, grupo });
      } else {
        enCarrera.push({ ...eq, grupo });
      }
    });
  });

  // Si no hay suficientes partidos jugados aún, mostrar solo los que tienen 0 posibilidades
  let msg = '🏆 <b>Estado del Torneo — Mundial 2026</b>\n\n';
  msg += `🟢 <b>En carrera: ${enCarrera.length} equipos</b>\n`;
  msg += `🔴 <b>Eliminados: ${eliminados.length} equipos</b>\n\n`;

  if (eliminados.length) {
    msg += '<b>❌ Fuera del torneo:</b>\n';
    eliminados
      .sort((a,b) => a.grupo.localeCompare(b.grupo))
      .forEach(e => { msg += `${teamFlag_(e.equipo)} ${e.equipo} (${e.grupo})\n`; });
  } else {
    msg += '<i>Aún no hay equipos eliminados matemáticamente.</i>\n';
  }

  const totalJugados = partidos.filter(r => ['FT','AET','PEN'].includes(String(r.status||'').toUpperCase())).length;
  msg += `\n<i>Partidos jugados: ${totalJugados}/104</i>`;
  return msg.trim();
}
