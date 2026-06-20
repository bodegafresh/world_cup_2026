// ─── Suscriptores multi-usuario ───────────────────────────────────────────────

/**
 * Registra un chat_id la primera vez que el usuario escribe al bot.
 * Guarda en la hoja Suscriptores (chat_id único).
 */
function registerSubscriber_(chatId, username) {
  const existing = getKnownChatIds_();
  if (existing.includes(String(chatId))) return;

  const sheet = getOrCreateSheet_(CONFIG.SHEETS.SUSCRIPTORES, ['chat_id', 'username', 'registered_at']);
  sheet.appendRow([String(chatId), username || '', nowChile_()]);
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

/**
 * Reporte matutino: texto + imagen de probabilidades por partido.
 * Llamado desde cronDailySetup(). Usa Poisson como fuente primaria de probs.
 */
function broadcastMorningReport_() {
  const date     = todayChile_();
  const partidos = getTodayFixturesForReport_(date);
  if (!partidos.length) return;

  const aiReports = getTodayAiReports_();
  const message   = buildMorningTelegramMessage_(date, partidos, aiReports);
  broadcastTelegramMessage_(message);

  Utilities.sleep(800);
  partidos.forEach((p, i) => {
    try {
      const home = p.local || '', away = p.visitante || '';
      if (!home || !away) return;

      // Prioridad: Poisson > IA > ELO
      let probHome = 0.33, probDraw = 0.34, probAway = 0.33;
      const poisson = getPoissonOdds_(home, away, p.match_key);
      if (poisson && poisson.prob_home) {
        probHome = poisson.prob_home / 100;
        probDraw = poisson.prob_draw / 100;
        probAway = poisson.prob_away / 100;
      } else {
        const aiRows = readAll_(CONFIG.SHEETS.AI_ANALYSIS).filter(r =>
          norm_(r.local||r.home||'').includes(norm_(home).substring(0,4)) ||
          norm_(r.visitante||r.away||'').includes(norm_(away).substring(0,4))
        );
        if (aiRows.length) {
          const lat = aiRows[aiRows.length - 1];
          if (lat.prob_local) { probHome = Number(lat.prob_local); probDraw = Number(lat.prob_empate); probAway = Number(lat.prob_visitante); }
        } else {
          const eloP = getEloProbabilities_(home, away);
          if (eloP) { probHome = eloP.home; probDraw = eloP.draw; probAway = eloP.away; }
        }
      }

      const src = poisson ? 'Poisson' : 'ELO';
      const chartUrl = buildProbabilityChartUrl_(home, away, probHome, probDraw, probAway);
      const caption  = [
        `📐 ${src}: ${teamNameToSpanish_(home)} vs ${teamNameToSpanish_(away)}`,
        `${Math.round(probHome*100)}% · ${Math.round(probDraw*100)}% · ${Math.round(probAway*100)}%`,
        p.hora_chile ? `🕒 ${p.hora_chile} Chile` : ''
      ].filter(Boolean).join('\n').substring(0, 1024);

      broadcastTelegramPhoto_(chartUrl, caption);
      if (i < partidos.length - 1) Utilities.sleep(600);
    } catch (e_) { console.warn('broadcastMorningReport_ photo:', e_.message); }
  });
}

function cronMorningTelegramReport() {
  throw new Error('DEPRECATED: esta función fue consolidada en cronDailySetup(). Elimina el trigger si existe.');

  const partidos  = getTodayFixturesForReport_(date);
  const aiReports = getTodayAiReports_();

  const message = buildMorningTelegramMessage_(date, partidos, aiReports);
  broadcastTelegramMessage_(message);

  // Imagen de probabilidades por cada partido del día
  if (partidos.length) {
    Utilities.sleep(800);
    partidos.forEach((p, i) => {
      try {
        const home = p.local     || '';
        const away = p.visitante || '';
        if (!home || !away) return;

        // Preferir probs de AI Analysis; fallback a ELO
        const aiRows = readAll_(CONFIG.SHEETS.AI_ANALYSIS).filter(r =>
          String(r.local || r.home || '').toLowerCase().includes(home.toLowerCase().substring(0, 4)) ||
          String(r.visitante || r.away || '').toLowerCase().includes(away.toLowerCase().substring(0, 4))
        );

        let probHome = 0.33, probDraw = 0.34, probAway = 0.33;
        if (aiRows.length) {
          const lat = aiRows[aiRows.length - 1];
          if (lat.prob_local && lat.prob_empate && lat.prob_visitante) {
            probHome = Number(lat.prob_local);
            probDraw = Number(lat.prob_empate);
            probAway = Number(lat.prob_visitante);
          } else {
            const eloP = getEloProbabilities_(home, away);
            if (eloP) { probHome = eloP.home; probDraw = eloP.draw; probAway = eloP.away; }
          }
        } else {
          const eloP = getEloProbabilities_(home, away);
          if (eloP) { probHome = eloP.home; probDraw = eloP.draw; probAway = eloP.away; }
        }

        const chartUrl = buildProbabilityChartUrl_(home, away, probHome, probDraw, probAway);
        const caption  = [
          `📊 ${home} vs ${away}`,
          `${home}: ${Math.round(probHome * 100)}% | Empate: ${Math.round(probDraw * 100)}% | ${away}: ${Math.round(probAway * 100)}%`,
          p.hora_chile ? `🕒 ${p.hora_chile}` : ''
        ].filter(Boolean).join('\n').substring(0, 1024);

        broadcastTelegramPhoto_(chartUrl, caption);
        if (i < partidos.length - 1) Utilities.sleep(600);
      } catch (e_) {
        console.warn(`cronMorningTelegramReport photo [${p.local}]:`, e_.message);
      }
    });
  }

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

  return rows.filter(r => isOperationalReportDate_(r, date))
    .map(r => ({
      fixture_id:     r.match_key || r.fixture_id_af || '',
      fecha:          normalizeFecha_(r.fecha),
      operational_next_day: isOperationalNextDayFixture_(r, date),
      local:          r.local        || '',
      visitante:      r.visitante    || '',
      hora_chile:     normalizeHora_(r.hora_chile),
      estadio:        r.estadio      || '',
      ciudad:         r.ciudad       || '',
      goles_local:    r.goles_local,
      goles_visitante: r.goles_visitante,
      status:         String(r.status || '').toUpperCase(),
      grupo:          r.grupo        || '',
      ronda:          r.ronda        || ''
    }))
    .sort((a, b) => {
      if (!!a.operational_next_day !== !!b.operational_next_day) return a.operational_next_day ? 1 : -1;
      return (a.hora_chile || '').localeCompare(b.hora_chile || '');
    });
}

function getTodayAiReports_() {
  const rows = readAll_(CONFIG.SHEETS.AI_ANALYSIS);
  const today = todayChile_();

  return rows.filter(r => String(r.fecha_hora_chile || '').startsWith(today));
}

// ─── Envío de imágenes (Telegram sendPhoto) ────────────────────────────────────

/**
 * Envía una imagen a un chat específico.
 * `photoUrl` puede ser una URL pública (QuickChart.io) o un file_id de Telegram.
 * Caption máximo: 1024 chars (límite Telegram para fotos).
 *
 * @param {string} chatId
 * @param {string} photoUrl   URL pública de la imagen
 * @param {string} [caption]  Texto bajo la imagen (HTML admitido)
 */
function sendPhotoToSingleChat_(chatId, photoUrl, caption) {
  if (!chatId || !photoUrl) return;

  const token = getTelegramBotToken_();
  const url   = `${CONFIG.TELEGRAM.BASE_URL}${token}/sendPhoto`;

  const payload = { chat_id: String(chatId), photo: photoUrl };
  if (caption) {
    payload.caption    = String(caption).substring(0, 1024);
    payload.parse_mode = 'HTML';
  }

  try {
    const resp = UrlFetchApp.fetch(url, {
      method:            'post',
      contentType:       'application/json',
      payload:           JSON.stringify(payload),
      muteHttpExceptions: true
    });

    const code = resp.getResponseCode();
    if (code < 200 || code >= 300) {
      console.warn(`sendPhotoToSingleChat_ ${chatId}: HTTP ${code} — ${resp.getContentText().substring(0, 200)}`);
    }
  } catch (e) {
    console.warn(`sendPhotoToSingleChat_ ${chatId}:`, e.message);
  }
}

/**
 * Envía una imagen a TODOS los suscriptores registrados.
 * Agrega un pequeño delay entre envíos para no saturar la Telegram Bot API.
 *
 * @param {string} photoUrl   URL pública de la imagen
 * @param {string} [caption]  Texto bajo la imagen (HTML admitido)
 */
function broadcastTelegramPhoto_(photoUrl, caption) {
  if (!photoUrl) return;

  const chatIds = getKnownChatIds_();
  chatIds.forEach((chatId, i) => {
    sendPhotoToSingleChat_(chatId, photoUrl, caption);
    if (i < chatIds.length - 1) Utilities.sleep(350); // respetar rate limit Telegram
  });
}
