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
    case '/ayuda':      return buildHelpCommandResponse_();
    default:            return null;
  }
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
    '/seleccion Brasil — Historial de un equipo',
    '/tabla — Tabla de posiciones por grupo',
    '/stats Argentina — Estadísticas del equipo',
    '/jugador Messi — Stats del jugador en el torneo',
    '/clima Miami — Clima del estadio',
    '/h2h España vs Francia — Historial cara a cara',
    '/prediccion Argentina — Predicción IA del próximo partido',
    '/noticias Brasil — Últimas noticias del equipo',
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

  const rows = readAll_(CONFIG.SHEETS.PARTIDOS).filter(r => String(r.fecha) === date);

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
    const rows = allRows.filter(r => String(r.fecha) === date);
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
      const fecha = String(r.fecha || '').substring(0, 10);
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
