// ─── Suscriptores multi-usuario ───────────────────────────────────────────────

/**
 * Registra un chat_id la primera vez que el usuario escribe al bot.
 * Guarda en la hoja Suscriptores (chat_id único).
 */
function registerSubscriber_(chatId, username) {
  const existing = getKnownChatIds_();
  if (existing.includes(String(chatId))) return;

  getOrCreateSheet_(CONFIG.SHEETS.SUSCRIPTORES, ['chat_id', 'username', 'registered_at']);
  appendRows_(CONFIG.SHEETS.SUSCRIPTORES, [[String(chatId), username || '', nowChile_()]]);
}

/**
 * Devuelve todos los chat_ids registrados.
 * Fallback: TELEGRAM_CHAT_ID en Script Properties si la hoja está vacía.
 */
function getKnownChatIds_() {
  try {
    const ss = SpreadsheetApp.openById(getSpreadsheetId_());
    const sheet = ss.getSheetByName(CONFIG.SHEETS.SUSCRIPTORES);
    if (sheet && sheet.getLastRow() > 1) {
      const rows = readAll_(CONFIG.SHEETS.SUSCRIPTORES);
      const ids = rows.map(r => String(r.chat_id)).filter(Boolean);
      if (ids.length) return ids;
    }
  } catch (e) {
    console.warn('getKnownChatIds_:', e.message);
  }
  const fallback = PropertiesService.getScriptProperties().getProperty('TELEGRAM_CHAT_ID');
  return fallback ? [fallback] : [];
}

/**
 * Envía un mensaje a TODOS los suscriptores.
 * Usar en crons y reportes matutinos.
 */
function broadcastTelegramMessage_(message) {
  const chatIds = getKnownChatIds_();
  if (!chatIds.length) {
    console.warn('broadcastTelegramMessage_: sin suscriptores registrados');
    return;
  }
  chatIds.forEach(id => sendTelegramMessageToSingleChat_(id, message));
}

/**
 * Envía un mensaje a un chat específico.
 */
function sendTelegramMessageToSingleChat_(chatId, message) {
  const token = getTelegramBotToken_();
  const url = `${CONFIG.TELEGRAM.BASE_URL}${token}/sendMessage`;
  const chunks = splitTelegramMessage_(message, 4096);

  chunks.forEach(chunk => {
    UrlFetchApp.fetch(url, {
      method: 'post',
      contentType: 'application/json',
      payload: JSON.stringify({
        chat_id: chatId,
        text: chunk,
        parse_mode: 'HTML',
        disable_web_page_preview: true
      }),
      muteHttpExceptions: true
    });
  });
}

/**
 * Alias para compatibilidad hacia atrás — envía broadcast.
 */
function sendTelegramMessage_(message) {
  broadcastTelegramMessage_(message);
}

function splitTelegramMessage_(text, maxLen) {
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

function cronMorningTelegramReport() {
  const date = todayChile_();

  const partidos = getTodayFixturesForReport_(date);
  const aiReports = getTodayAiReports_();

  const message = buildMorningTelegramMessage_(date, partidos, aiReports);

  broadcastTelegramMessage_(message);

  appendRows_(CONFIG.SHEETS.MORNING_REPORTS, [[
    hash_(date + message),
    date,
    nowChile_(),
    message,
    'ENVIADO'
  ]]);
}

function buildMorningTelegramMessage_(date, partidos, aiReports) {
  let msg = `🏆 <b>Mundial 2026 — ${date}</b>\n`;

  if (!partidos.length) {
    msg += `\nNo hay partidos del Mundial para hoy.\n`;
    return msg;
  }

  const weatherByFixture = buildWeatherMap_();
  const oddsByFixture    = buildOddsMap_();

  msg += `\n📅 <b>Partidos de hoy</b>\n`;

  partidos.forEach(p => {
    msg += `\n⚽ <b>${p.local} vs ${p.visitante}</b>`;
    msg += `\n🕒 ${p.hora_chile || 'hora pendiente'}`;
    msg += `\n🏟️ ${p.estadio || ''}`;

    const w = weatherByFixture[String(p.fixture_id)];
    if (w && w.temperatura_c !== null && w.temperatura_c !== '') {
      const rainStr = w.prob_lluvia ? ` | 🌧 ${w.prob_lluvia}%` : '';
      msg += `\n🌡 ${w.temperatura_c}°C, ${w.condicion || ''}${rainStr}`;
    }

    const odds = oddsByFixture[String(p.fixture_id)];
    if (odds && odds.prob_local) {
      msg += `\n📊 ${p.local} ${pct_(odds.prob_local)} | X ${pct_(odds.prob_empate)} | ${p.visitante} ${pct_(odds.prob_visitante)}`;
    }

    msg += '\n';
  });

  if (aiReports.length) {
    msg += `\n🧠 <b>Análisis IA</b>\n`;
    aiReports.forEach(r => {
      const home = r.local || r.home || '';
      const away = r.visitante || r.away || '';
      if (home || away) msg += `\n<b>${home} vs ${away}</b>\n`;

      const resumen = r.resumen_telegram || r.mensaje_telegram || r.resumen_previa || '';
      if (resumen) msg += `${resumen}\n`;

      const bajas = parseSafeJson_(r.bajas_suspensiones || r.bajas_y_suspensiones, []);
      const altas = bajas.filter(b =>
        b.tipo === 'suspension_confirmada' || b.tipo === 'riesgo_suspension'
      );
      if (altas.length) {
        msg += `🟨 <i>Riesgo suspensión: ${altas.map(b => `${b.jugador} (${b.equipo})`).join(', ')}</i>\n`;
      }

      const ctx = parseSafeJson_(r.contexto_grupo, {});
      if (ctx.que_se_juega_home || ctx.que_se_juega_away) {
        msg += `📌 ${home}: ${ctx.que_se_juega_home || '—'} | ${away}: ${ctx.que_se_juega_away || '—'}\n`;
      }
    });
  }

  msg += `\n⚠️ Análisis para diversión y aprendizaje. No es asesoría financiera.`;

  return msg;
}

function parseSafeJson_(value, fallback) {
  if (!value) return fallback;
  if (typeof value === 'object') return value;
  try { return JSON.parse(value); } catch (e) { return fallback; }
}

function buildWeatherMap_() {
  const map = {};
  try {
    readAll_(CONFIG.SHEETS.ESTADIOS_CLIMA).forEach(r => {
      if (r.fixture_id) map[String(r.fixture_id)] = r;
    });
  } catch (e) {
    console.warn('buildWeatherMap_:', e.message);
  }
  return map;
}

function buildOddsMap_() {
  const map = {};
  try {
    readAll_(CONFIG.SHEETS.ODDS).forEach(r => {
      const fid = String(r.fixture_id || '');
      if (!fid) return;
      if (!map[fid]) map[fid] = {};
      const market = String(r.mercado || '');
      const sel    = String(r.seleccion || '');
      const prob   = Number(r.probabilidad_modelo);
      if (market === '1X2') {
        const key = sel.toLowerCase().includes('empate') ? 'prob_empate'
          : sel.toLowerCase().includes('visitante') || sel === r.away ? 'prob_visitante'
          : 'prob_local';
        map[fid][key] = prob;
      }
    });
  } catch (e) {
    console.warn('buildOddsMap_:', e.message);
  }
  return map;
}

function getTodayFixturesForReport_(date) {
  const rows = readAll_(CONFIG.SHEETS.PARTIDOS);

  return rows.filter(r => {
    return String(r.fecha) === String(date);
  }).map(r => ({
    fixture_id: r.match_id,
    local: r.local,
    visitante: r.visitante,
    hora_chile: r.hora_chile,
    estadio: r.estadio
  }));
}

function getTodayAiReports_() {
  const rows = readAll_(CONFIG.SHEETS.AI_ANALYSIS);
  const today = todayChile_();

  return rows.filter(r => String(r.fecha_hora_chile || '').startsWith(today));
}