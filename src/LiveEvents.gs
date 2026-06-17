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
  if (!liveFixtures.length) return;

  liveFixtures.forEach(fixture => {
    try {
      const fixtureId    = fixture.fixture_id_af || fixture.match_id || fixture.fixture_id || '';
      const espnId       = fixture.espn_id || fixture.espn_event_id || '';
      const matchKey     = fixture.match_key || `${fixture.local}_${fixture.visitante}`;

      // ── Fuente primaria: ESPN (sin cuota) ───────────────────────────────────
      if (espnId) {
        _monitorEspnEvents_(fixture, espnId, matchKey);
        Utilities.sleep(500);
        return;
      }

      // ── Fuente fallback: API-Football (consume cuota) ────────────────────────
      if (fixtureId) {
        _monitorApiFootballEvents_(fixture, fixtureId);
      }

      Utilities.sleep(800);
    } catch (e) {
      console.warn(`Live monitor error [${fixture.local} vs ${fixture.visitante}]: ${e.message}`);
    }
  });
}

/**
 * Monitorea eventos en vivo usando ESPN summary (sin cuota de API).
 * Detecta goles, tarjetas rojas y VAR desde keyEvents / scoringPlays / header details.
 */
function _monitorEspnEvents_(fixture, espnId, matchKey) {
  const summary  = fetchEspnSummary_(espnId);
  const alerted  = getAlertedEventIds_();

  // Marcador actual desde ESPN
  const comp       = ((summary.header || {}).competitions || [])[0] || {};
  const competitors = comp.competitors || [];
  const homeComp   = competitors.find(c => c.homeAway === 'home') || competitors[0] || {};
  const awayComp   = competitors.find(c => c.homeAway === 'away') || competitors[1] || {};
  const scoreHome  = parseInt(homeComp.score || 0);
  const scoreAway  = parseInt(awayComp.score || 0);
  const score      = { home: scoreHome, away: scoreAway };

  // Recolectar eventos importantes desde todas las fuentes ESPN disponibles
  const espnEvents = _extractEspnAlertEvents_(summary);

  espnEvents.forEach(ev => {
    const eventId = `espn_${espnId}_${ev.type}_${ev.minute}_${ev.athleteId || ev.teamId || ''}`;
    if (alerted[eventId]) return;

    const msg = _formatEspnEventMessage_(fixture, ev, score);
    if (msg) {
      broadcastTelegramMessage_(msg);
      // Registrar como alertado
      appendRows_(CONFIG.SHEETS.ALERTAS, [[
        eventId, espnId, ev.type, ev.detail || '', ev.teamName || '', ev.athleteName || '',
        ev.minute || '', '', nowChile_(), 'ESPN'
      ]]);
    }
  });
}

/**
 * Extrae eventos alertables desde un ESPN summary:
 * goles (scoringPlays / header details) y tarjetas rojas (keyEvents).
 */
function _extractEspnAlertEvents_(summary) {
  const events = [];
  const comp   = ((summary.header || {}).competitions || [])[0] || {};

  // Goles desde header details (más confiable en FIFA World Cup)
  (comp.details || []).forEach(d => {
    const typeText = String((d.type || {}).text || '').toLowerCase();
    if (!typeText.includes('goal') && !typeText.includes('penalty - scored')) return;
    const athlete  = (d.athletesInvolved || [])[0] || {};
    const minute   = (d.clock || {}).displayValue || '';
    const ownGoal  = typeText.includes('own');
    const penalty  = typeText.includes('penalty');
    events.push({
      type:        'Goal',
      detail:      ownGoal ? 'Own Goal' : penalty ? 'Penalty' : 'Normal Goal',
      athleteId:   String(athlete.id || ''),
      athleteName: athlete.shortName || athlete.displayName || '',
      teamId:      String((d.team || {}).id || ''),
      teamName:    (d.team || {}).displayName || '',
      minute
    });
  });

  // Tarjetas rojas desde keyEvents
  (summary.keyEvents || []).forEach(e => {
    const typeText = String((e.type || {}).text || (e.type || {}).name || '').toLowerCase();
    if (!typeText.includes('red') && !typeText.includes('roja')) return;
    const athlete  = (e.athlete || {});
    const minute   = (e.clock || {}).displayValue || '';
    events.push({
      type:        'Card',
      detail:      'Red Card',
      athleteId:   String(athlete.id || ''),
      athleteName: athlete.shortName || athlete.displayName || '',
      teamId:      String((e.team || {}).id || ''),
      teamName:    (e.team || {}).displayName || '',
      minute
    });
  });

  return events;
}

/** Formatea el mensaje Telegram para un evento ESPN. */
function _formatEspnEventMessage_(fixture, ev, score) {
  const home     = teamNameToSpanish_(fixture.local || '');
  const away     = teamNameToSpanish_(fixture.visitante || '');
  const scoreStr = `${home} <b>${score.home} - ${score.away}</b> ${away}`;

  if (ev.type === 'Goal') {
    const tag = ev.detail === 'Own Goal' ? '🔴 Autogol' : ev.detail === 'Penalty' ? '⚽(P)' : '⚽';
    return [
      `${tag} <b>GOL! ${ev.minute}'</b>`,
      scoreStr,
      `📌 ${ev.teamName} — ${ev.athleteName}`
    ].join('\n');
  }

  if (ev.type === 'Card' && ev.detail === 'Red Card') {
    return [
      `🟥 <b>TARJETA ROJA ${ev.minute}'</b>`,
      scoreStr,
      `📌 ${ev.teamName} — ${ev.athleteName}`
    ].join('\n');
  }

  return null;
}

/** Monitorea eventos usando API-Football (fallback cuando no hay espn_id). */
function _monitorApiFootballEvents_(fixture, fixtureId) {
  const eventsData = fetchEventsByFixture_(fixtureId);
  const events     = eventsData.response || [];
  const newEvents  = detectNewImportantEvents_(fixtureId, events);

  if (!newEvents.length) return;

  saveEvents_(fixtureId, events, 'API-Football live');

  newEvents.forEach(event => {
    const score   = getLiveScore_(fixtureId, events);
    const textMsg = formatImportantEventMessage_(fixture, event, score);
    broadcastTelegramMessage_(textMsg);
    markEventAsAlerted_(fixtureId, event);

    if (event.type === 'Goal' || (event.type === 'Card' && event.detail === 'Red Card')) {
      try {
        const liveStats = fetchLiveStatistics_(fixtureId);
        if (liveStats) {
          const fxObj = buildFixtureFromSheetRow_(fixture);
          if (score) fxObj.goals = { home: score.home, away: score.away };
          const chartUrl = buildLiveScoreChartUrl_(fxObj, liveStats, event.time ? event.time.elapsed : null);
          if (chartUrl) {
            broadcastTelegramPhoto_(chartUrl, `${fixture.local || ''} ${score ? score.home + '-' + score.away : ''} ${fixture.visitante || ''}`);
          }
        }
      } catch (imgErr) {
        console.warn(`Live chart ${fixtureId}:`, imgErr.message);
      }
    }
  });
}

function getFixturesLikelyLive_() {
  const rows  = readAll_(CONFIG.SHEETS.PARTIDOS);
  const now   = new Date();
  const today = todayChile_();

  return rows.filter(r => {
    const fecha = normalizeFecha_(r.fecha);
    const hora  = normalizeHora_(r.hora_chile || r.hora);

    // Solo partidos de hoy o ayer (por si hay partido de madrugada Chile)
    if (fecha !== today) {
      const ayer = Utilities.formatDate(new Date(now.getTime() - 86400000), CONFIG.TIMEZONE, 'yyyy-MM-dd');
      if (fecha !== ayer) return false;
    }

    if (!hora || hora.length < 4) return false;

    // Construir datetime completo: fecha + hora en timezone Chile
    const [hh, mm]    = hora.split(':').map(Number);
    const [yy, mo, dd] = fecha.split('-').map(Number);
    // Crear fecha en UTC desde componentes Chile (America/Santiago = UTC-4 o UTC-3 según DST)
    // Usamos un string ISO que Apps Script parsea como hora local del script (que es UTC)
    // En cambio, calculamos el offset manualmente: Chile en junio = UTC-4
    const CHILE_OFFSET_MS = -4 * 60 * 60 * 1000; // UTC-4 en junio (sin horario de verano)
    const kickoffUtc = Date.UTC(yy, mo - 1, dd, hh, mm) - CHILE_OFFSET_MS;
    const kickoff    = new Date(kickoffUtc);

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
/**
 * Construye el texto de partidos en vivo usando ESPN como fuente primaria.
 * ESPN no tiene límite de cuota y refleja el estado en tiempo real.
 * Fallback a hoja Partidos si ESPN falla.
 */
function buildLiveMatchesText_() {
  const ESPN_LIVE = {
    STATUS_FIRST_HALF:    '⏱ 1° Tiempo',
    STATUS_HALFTIME:      '⏸ Descanso',
    STATUS_SECOND_HALF:   '⏱ 2° Tiempo',
    STATUS_EXTRA_TIME:    '⏱ Prórroga',
    STATUS_BREAK_TIME:    '⏸ Descanso Prórroga',
    STATUS_PENALTY:       '🥅 Penales',
    STATUS_IN_PROGRESS:   '🔴 En curso',
    STATUS_DELAYED:       '⏳ Demorado',
    STATUS_SUSPENDED:     '⚠️ Suspendido',
    STATUS_INTERRUPTED:   '⚠️ Interrumpido'
  };

  // 1. Intentar ESPN (tiempo real, sin cuota)
  let espnEvents = [];
  try {
    const data = espnGet_('/scoreboard');
    espnEvents = (data.events || []).filter(e => {
      const statusName = ((e.competitions || [])[0] || {}).status?.type?.name || '';
      return Object.keys(ESPN_LIVE).includes(statusName);
    });
  } catch (e) {
    console.warn('buildLiveMatchesText_: ESPN falló, usando hoja:', e.message);
  }

  if (espnEvents.length) {
    let msg = `🔴 <b>En vivo — ${espnEvents.length} partido${espnEvents.length > 1 ? 's' : ''}</b>\n\n`;

    // Cache de clima por estadio — se llama Open-Meteo si no está en EstadiosClima
    const climaCache_ = {};
    const getClimaForVenue_ = (venueName) => {
      if (!venueName) return null;
      if (climaCache_[venueName] !== undefined) return climaCache_[venueName];
      // 1. Buscar en hoja EstadiosClima por nombre de estadio
      try {
        const normV = s => String(s || '').toLowerCase().trim();
        const row = readAll_(CONFIG.SHEETS.ESTADIOS_CLIMA).find(r =>
          normV(r.estadio) === normV(venueName)
        );
        if (row && row.temperatura_c !== '' && row.temperatura_c !== null) {
          climaCache_[venueName] = row;
          return row;
        }
      } catch (e_) { /* ignorar */ }
      // 2. Fallback: Open-Meteo en tiempo real usando VenueCatalog
      try {
        const info = getVenueInfo_(venueName, '');
        if (info && info.lat && info.lon) {
          const today = Utilities.formatDate(new Date(), 'UTC', 'yyyy-MM-dd');
          const data  = callOpenMeteo_(info.lat, info.lon, today);
          const w     = extractHourlyWeather_(data, new Date().toISOString(), null);
          const result = {
            estadio:      venueName,
            temperatura_c: w.temperature_c,
            humedad:       w.humidity,
            prob_lluvia:   w.rain_probability,
            condicion:     classifyCondition_(w)
          };
          climaCache_[venueName] = result;
          return result;
        }
      } catch (e_) { console.warn('Clima ESPN fallback:', e_.message); }
      climaCache_[venueName] = null;
      return null;
    };

    espnEvents.forEach(ev => {
      const comp   = ev.competitions[0];
      const comps  = comp.competitors || [];
      const home   = comps.find(c => c.homeAway === 'home') || comps[0] || {};
      const away   = comps.find(c => c.homeAway === 'away') || comps[1] || {};
      const status = comp.status || {};
      const clock  = status.displayClock || '';
      const label  = ESPN_LIVE[status.type?.name] || '🔴 En curso';

      const homeNombre = teamNameToSpanish_((home.team || {}).displayName || '?');
      const awayNombre = teamNameToSpanish_((away.team || {}).displayName || '?');
      const homeScore  = home.score !== undefined ? home.score : '?';
      const awayScore  = away.score !== undefined ? away.score : '?';
      const venue      = (comp.venue || {}).fullName || '';

      msg += `⚽ <b>${homeNombre} ${homeScore} - ${awayScore} ${awayNombre}</b>\n`;
      msg += `   ${label}${clock ? ' ' + clock : ''}`;
      if (venue) msg += ` | 🏟️ ${venue}`;
      msg += '\n';

      // Hora local del estadio
      try {
        const venueInfo = getVenueInfo_(venue, (comp.venue || {}).address && comp.venue.address.city || '');
        if (venueInfo && venueInfo.timezone_estadio) {
          const horaLocal = Utilities.formatDate(new Date(), venueInfo.timezone_estadio, 'HH:mm');
          msg += `   🕐 Hora local: ${horaLocal}\n`;
        }
      } catch (e_) { /* sin timezone */ }

      // Clima del estadio (EstadiosClima o Open-Meteo directo)
      const clima = getClimaForVenue_(venue);
      if (clima && clima.temperatura_c !== null && clima.temperatura_c !== '') {
        const lluvia = Number(clima.prob_lluvia) > 30 ? ` ☔${clima.prob_lluvia}%` : '';
        msg += `   🌡️ ${clima.temperatura_c}°C, ${clima.humedad}% hum${lluvia}\n`;
      }

      // Stats + alineaciones desde ESPN summary
      try {
        const summary = fetchEspnSummary_(ev.id);
        const bsTeams = (summary.boxscore || {}).teams || [];
        const hEntry  = bsTeams.find(t => t.homeAway === 'home');
        const aEntry  = bsTeams.find(t => t.homeAway === 'away');
        if (hEntry && aEntry) {
          const hs = parseEspnTeamStats_(hEntry);
          const as_ = parseEspnTeamStats_(aEntry);
          const v  = (h, a) => `${h || '?'}-${a || '?'}`;
          msg += `   ⚽ Pos: ${v(hs.possessionPct, as_.possessionPct)}%`;
          msg += ` | 🎯 Tiros: ${v(hs.totalShots, as_.totalShots)} (arco: ${v(hs.shotsOnTarget, as_.shotsOnTarget)})\n`;
          msg += `   🔄 Corners: ${v(hs.cornerKicks, as_.cornerKicks)}`;
          msg += ` | ⚠️ Faltas: ${v(hs.foulsCommitted, as_.foulsCommitted)}`;
          msg += ` | 🟨 ${v(hs.yellowCards, as_.yellowCards)}`;
          const hr = Number(hs.redCards || 0), ar = Number(as_.redCards || 0);
          if (hr || ar) msg += ` | 🟥 ${v(hr, ar)}`;
          msg += '\n';
        }

        // Alineaciones titulares con goleadores marcados
        const rosters = summary.rosters || [];
        if (rosters.length) {
          // Intentar scoringPlays → keyEvents → header.competitions[0].details (más robusto)
          let scorersMap = parseEspnScorers_(summary.scoringPlays || [], summary.keyEvents || []);
          if (scorersMap.size === 0) scorersMap = parseEspnScorersFromHeader_(summary);
          const hLineup = parseEspnLineup_(rosters, 'home');
          const aLineup = parseEspnLineup_(rosters, 'away');
          msg += formatEspnLineupText_(homeNombre, hLineup, scorersMap);
          msg += formatEspnLineupText_(awayNombre, aLineup, scorersMap);
        }
      } catch (e_) { /* sin stats/alineación */ }

      msg += '\n';
    });

    return msg.trim();
  }

  // 2. Fallback: leer de hoja Partidos (puede estar desactualizado)
  const liveStatuses = ['1H', 'HT', '2H', 'ET', 'BT', 'P', 'LIVE', 'INT'];
  let rows = [];
  try {
    rows = readAll_(CONFIG.SHEETS.PARTIDOS).filter(r =>
      liveStatuses.includes(String(r.status || '').toUpperCase())
    );
  } catch (e) { rows = []; }

  if (!rows.length) {
    return '⚽ <b>En vivo ahora</b>\n\nNo hay partidos en curso.\n\n<i>Usa /hoy para ver el horario de hoy.</i>';
  }

  let msg = `🔴 <b>En vivo — ${rows.length} partido${rows.length > 1 ? 's' : ''}</b> <i>(datos de hoja)</i>\n\n`;
  rows.forEach(r => {
    const home = teamNameToSpanish_(r.local || '?');
    const away = teamNameToSpanish_(r.visitante || '?');
    const gl   = r.goles_local ?? '?';
    const gv   = r.goles_visitante ?? '?';
    msg += `⚽ <b>${home} ${gl} - ${gv} ${away}</b>\n   ${r.estadio || ''}\n\n`;
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