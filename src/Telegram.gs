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
  let msg = `🏆 <b>Mundial 2026 - Reporte ${date}</b>\n\n`;

  if (!partidos.length) {
    msg += `No encontré partidos del Mundial para hoy.\n`;
    return msg;
  }

  msg += `📅 <b>Partidos de hoy</b>\n`;

  partidos.forEach(p => {
    msg += `\n⚽ ${p.local} vs ${p.visitante}`;
    msg += `\n🕒 ${p.hora_chile || 'hora pendiente'}`;
    msg += `\n🏟️ ${p.estadio || 'estadio pendiente'}\n`;
  });

  if (aiReports.length) {
    msg += `\n🧠 <b>Lectura IA</b>\n`;

    aiReports.forEach(r => {
      msg += `\n${r.home} vs ${r.away}`;
      msg += `\n${r.mensaje_telegram || r.resumen_previa || 'Sin resumen'}\n`;
    });
  }

  msg += `\n⚠️ No es recomendación financiera ni promesa de resultado. Es análisis para diversión y aprendizaje.`;

  return msg;
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