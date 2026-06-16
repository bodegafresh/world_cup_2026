function sendTelegramMessage_(message) {
  const token = getTelegramBotToken_();
  const chatId = getTelegramChatId_();

  const url = `${CONFIG.TELEGRAM.BASE_URL}${token}/sendMessage`;

  const payload = {
    chat_id: chatId,
    text: message,
    parse_mode: 'HTML',
    disable_web_page_preview: true
  };

  const response = UrlFetchApp.fetch(url, {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  });

  const status = response.getResponseCode();
  if (status < 200 || status >= 300) {
    throw new Error(`Telegram error ${status}: ${response.getContentText()}`);
  }

  return JSON.parse(response.getContentText());
}

function cronMorningTelegramReport() {
  const date = todayChile_();

  const partidos = getTodayFixturesForReport_(date);
  const aiReports = getTodayAiReports_();

  const message = buildMorningTelegramMessage_(date, partidos, aiReports);

  sendTelegramMessage_(message);

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
      const resumen = r.resumen_telegram || r.mensaje_telegram || r.resumen_previa || '';
      if (resumen) msg += `\n${resumen}\n`;
    });
  }

  msg += `\n⚠️ Análisis para diversión y aprendizaje. No es asesoría financiera.`;

  return msg;
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