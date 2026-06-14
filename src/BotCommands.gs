function doPost(e) {
  const update = JSON.parse(e.postData.contents);

  if (!update.message || !update.message.text) {
    return ContentService.createTextOutput('ok');
  }

  const chatId = update.message.chat.id;
  const text = update.message.text.trim();

  const response = handleTelegramCommand_(text);

  sendTelegramMessageToChat_(chatId, response);

  return ContentService.createTextOutput('ok');
}

function handleTelegramCommand_(text) {
  const parts = text.split(' ');
  const command = parts[0].toLowerCase();

  if (command === '/hoy') {
    return buildTodayCommandResponse_();
  }

  if (command === '/ayer') {
    return buildYesterdayCommandResponse_();
  }

  if (command === '/seleccion') {
    const team = parts.slice(1).join(' ');
    return buildTeamCommandResponse_(team);
  }

  if (command === '/ayuda') {
    return buildHelpCommandResponse_();
  }

  return 'Comando no reconocido. Usa /ayuda';
}

function sendTelegramMessageToChat_(chatId, message) {
  const token = getTelegramBotToken_();
  const url = `${CONFIG.TELEGRAM.BASE_URL}${token}/sendMessage`;

  UrlFetchApp.fetch(url, {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify({
      chat_id: chatId,
      text: message,
      parse_mode: 'HTML',
      disable_web_page_preview: true
    }),
    muteHttpExceptions: true
  });
}

function buildHelpCommandResponse_() {
  return [
    '🏆 <b>Comandos Mundial 2026</b>',
    '',
    '/hoy - Partidos de hoy',
    '/ayer - Resultados de ayer',
    '/seleccion Corea - Historial y próximos partidos',
    '/ayuda - Ver comandos'
  ].join('\n');
}

function buildTodayCommandResponse_() {
  const date = todayChile_();
  const partidos = getTodayFixturesForReport_(date);

  if (!partidos.length) return `No encontré partidos para hoy ${date}.`;

  let msg = `📅 <b>Partidos de hoy ${date}</b>\n`;

  partidos.forEach(p => {
    msg += `\n⚽ ${p.local} vs ${p.visitante}`;
    msg += `\n🕒 ${p.hora_chile}`;
    msg += `\n🏟️ ${p.estadio || 'Sin estadio'}\n`;
  });

  return msg;
}

function buildYesterdayCommandResponse_() {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  const date = Utilities.formatDate(d, CONFIG.TIMEZONE, 'yyyy-MM-dd');

  const rows = readAll_(CONFIG.SHEETS.PARTIDOS).filter(r => String(r.fecha) === date);

  if (!rows.length) return `No encontré resultados para ayer ${date}.`;

  let msg = `📊 <b>Resultados ${date}</b>\n`;

  rows.forEach(r => {
    msg += `\n${r.local} ${r.goles_local || ''} - ${r.goles_visitante || ''} ${r.visitante}`;
  });

  return msg;
}

function buildTeamCommandResponse_(team) {
  if (!team) return 'Uso: /seleccion Corea';

  const rows = readAll_(CONFIG.SHEETS.PARTIDOS).filter(r => {
    const local = String(r.local || '').toLowerCase();
    const visitante = String(r.visitante || '').toLowerCase();
    const q = team.toLowerCase();

    return local.includes(q) || visitante.includes(q);
  });

  if (!rows.length) return `No encontré partidos para: ${team}`;

  let msg = `🔎 <b>Partidos de ${team}</b>\n`;

  rows.slice(-10).forEach(r => {
    msg += `\n${r.fecha} - ${r.local} ${r.goles_local || ''} vs ${r.visitante} ${r.goles_visitante || ''}`;
  });

  return msg;
}