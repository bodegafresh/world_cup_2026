/**
 * BettingHistory.gs
 *
 * Registro de apuestas y calibración del modelo predictivo.
 *
 * Permite:
 *  - Registrar apuestas manualmente (registerBet_) o desde bot
 *  - Marcar resultado al finalizar el partido (settleBet_)
 *  - Ver P&L y ROI acumulados (/historial)
 *  - Calibrar el modelo comparando predicciones IA vs resultados reales (/calibrar)
 *
 * La calibración usa:
 *  - Brier Score: error cuadrático medio de las probabilidades (menor = mejor)
 *  - Accuracy: % de veces que el resultado predicho (mayor probabilidad) fue correcto
 */

const BET_HEADERS = [
  'bet_id','fixture_id','fecha','equipo_local','equipo_visitante',
  'mercado','seleccion','cuota','prob_modelo','ev',
  'kelly_fraction','stake','resultado','profit_loss','roi_acum','notas'
];

const CALIBRATION_HEADERS = [
  'fecha','partidos_evaluados','accuracy','brier_score','interpretacion','updated_at'
];

// ─── Registro de apuestas ─────────────────────────────────────────────────────

/**
 * Registra una apuesta en la hoja BettingHistory.
 * Asocia automáticamente los datos de EV del modelo si están disponibles.
 *
 * @param {string|number} fixtureId  ID del fixture (API-Football)
 * @param {string}        mercado    '1X2' | 'Over/Under 2.5' | 'Ambos anotan'
 * @param {string}        seleccion  Nombre del equipo, 'Empate', 'Over 2.5', etc.
 * @param {number}        cuota      Cuota decimal obtenida en la casa de apuestas
 * @param {number}        stake      Monto apostado (en la unidad que uses: $, UF, u)
 * @param {string}        [notas]    Texto libre (opcional)
 * @returns {string}  bet_id único para usar en settleBet_
 */
function registerBet_(fixtureId, mercado, seleccion, cuota, stake, notas) {
  const fid = String(fixtureId);

  // Buscar datos del modelo para este fixture/mercado/selección
  let probModelo = null;
  let ev         = null;
  let kelly      = null;

  try {
    const evRow = readAll_(CONFIG.SHEETS.EV_OPPORTUNITIES).find(r =>
      String(r.fixture_id) === fid &&
      String(r.mercado)    === String(mercado) &&
      String(r.seleccion)  === String(seleccion)
    );
    if (evRow) {
      probModelo = Number(evRow.prob_modelo);
      ev         = Number(evRow.ev);
      kelly      = Number(evRow.kelly);
    }
  } catch (e) { /* sin datos de EV disponibles */ }

  // Si no hay ev guardado, calcular desde cuota y probabilidad
  if (ev === null && probModelo !== null && cuota) {
    ev    = (probModelo * cuota) - 1;
    kelly = Math.max(0, Math.min((probModelo * cuota - 1) / (cuota - 1) / KELLY_DIVISOR, KELLY_MAX_FRACTION));
  }

  // Buscar nombre de equipos en Partidos
  let local = '';
  let visitante = '';
  try {
    const matchRow = readAll_(CONFIG.SHEETS.PARTIDOS)
      .find(r => String(r.fixture_id_af || '') === fid);
    if (matchRow) { local = matchRow.local || ''; visitante = matchRow.visitante || ''; }
  } catch (e) { /* sin datos */ }

  const betId = Utilities.getUuid().substring(0, 8).toUpperCase();

  getOrCreateSheet_(CONFIG.SHEETS.BETTING_HISTORY, BET_HEADERS);
  appendRows_(CONFIG.SHEETS.BETTING_HISTORY, [[
    betId,
    fid,
    nowChile_(),
    local,
    visitante,
    mercado,
    seleccion,
    cuota,
    safe_(probModelo),
    safe_(ev !== null ? Math.round(ev * 10000) / 10000 : null),
    safe_(kelly !== null ? Math.round(kelly * 10000) / 10000 : null),
    stake,
    'PENDIENTE',
    '',
    '',
    notas || ''
  ]]);

  Logger.log(`Apuesta registrada: ${betId} — ${seleccion} @ ${cuota} (stake: ${stake})`);
  return betId;
}

/**
 * Marca el resultado de una apuesta y calcula P&L + ROI acumulado.
 *
 * @param {string} betId      ID devuelto por registerBet_
 * @param {string} resultado  'GANADA' | 'PERDIDA' | 'VOID'
 */
function settleBet_(betId, resultado) {
  const sheet = SpreadsheetApp.openById(getSpreadsheetId_())
    .getSheetByName(CONFIG.SHEETS.BETTING_HISTORY);
  if (!sheet || sheet.getLastRow() <= 1) {
    throw new Error('BettingHistory está vacío o no existe.');
  }

  const vals    = sheet.getDataRange().getValues();
  const headers = vals[0];
  const idx     = f => headers.indexOf(f);

  const rowIdx = vals.slice(1).findIndex(r => String(r[idx('bet_id')]) === betId);
  if (rowIdx === -1) throw new Error(`Apuesta ${betId} no encontrada.`);

  const sheetRow = rowIdx + 2;
  const r        = vals[rowIdx + 1];
  const stake    = Number(r[idx('stake')]  || 0);
  const cuota    = Number(r[idx('cuota')]  || 1);

  let pl = 0;
  if (resultado === 'GANADA') pl =  stake * (cuota - 1);
  if (resultado === 'PERDIDA') pl = -stake;
  // VOID: pl = 0 (devuelve stake)

  // Calcular ROI acumulado sobre todas las apuestas resueltas
  const completadas = vals.slice(1).filter(row => {
    const res = String(row[idx('resultado')] || '');
    return res === 'GANADA' || res === 'PERDIDA';
  });

  const totalPL    = completadas.reduce((s, row) => s + Number(row[idx('profit_loss')] || 0), 0) + pl;
  const totalStake = completadas.reduce((s, row) => s + Number(row[idx('stake')]       || 0), 0) + stake;
  const roi        = totalStake > 0 ? (totalPL / totalStake * 100).toFixed(2) : '0.00';

  sheet.getRange(sheetRow, idx('resultado')   + 1).setValue(resultado);
  sheet.getRange(sheetRow, idx('profit_loss') + 1).setValue(pl.toFixed(2));
  sheet.getRange(sheetRow, idx('roi_acum')    + 1).setValue(`${roi}%`);

  Logger.log(`Apuesta ${betId} resuelta: ${resultado} | P&L: ${pl.toFixed(2)} | ROI acum: ${roi}%`);
}

// ─── Texto para bot ───────────────────────────────────────────────────────────

/**
 * Resumen de P&L para el comando /historial.
 */
function buildBettingHistoryText_() {
  let rows;
  try { rows = readAll_(CONFIG.SHEETS.BETTING_HISTORY); } catch (e) { rows = []; }

  if (!rows.length) {
    return [
      '💰 <b>Historial de Apuestas</b>',
      '',
      'Sin apuestas registradas aún.',
      '',
      '<i>Para registrar: ejecuta registerBet_() en Apps Script con los datos del partido.</i>'
    ].join('\n');
  }

  const completadas = rows.filter(r => r.resultado === 'GANADA' || r.resultado === 'PERDIDA');
  const pendientes  = rows.filter(r => r.resultado === 'PENDIENTE');
  const voids       = rows.filter(r => r.resultado === 'VOID');

  const totalStake  = completadas.reduce((s, r) => s + Number(r.stake || 0), 0);
  const totalPL     = completadas.reduce((s, r) => s + Number(r.profit_loss || 0), 0);
  const ganadas     = completadas.filter(r => r.resultado === 'GANADA').length;
  const roi         = totalStake > 0 ? (totalPL / totalStake * 100).toFixed(1) : '0.0';
  const plSign      = totalPL >= 0 ? '+' : '';

  let msg = `💰 <b>Historial de Apuestas</b>\n\n`;

  // Resumen
  const roiEmoji = Number(roi) > 0 ? '📈' : Number(roi) < 0 ? '📉' : '➡️';
  msg += `${roiEmoji} ROI: <code>${roi}%</code>  P&L: <code>${plSign}${totalPL.toFixed(2)}</code>\n`;
  msg += `✅ Ganadas: ${ganadas}/${completadas.length}`;
  if (voids.length) msg += `  🔄 Void: ${voids.length}`;
  msg += `  ⏳ Pendientes: ${pendientes.length}\n`;

  if (completadas.length > 0) {
    const winRate = (ganadas / completadas.length * 100).toFixed(0);
    msg += `📊 Win rate: ${winRate}%  Stake total: ${totalStake.toFixed(2)}\n`;
  }

  // Pendientes
  if (pendientes.length) {
    msg += `\n<b>⏳ Pendientes (${pendientes.length}):</b>\n`;
    pendientes.slice(0, 4).forEach(r => {
      const ev = r.ev ? ` EV ${(Number(r.ev)*100).toFixed(1)}%` : '';
      msg += `• ${r.equipo_local} vs ${r.equipo_visitante}\n`;
      msg += `  ${r.seleccion} @ ${r.cuota} — stake: ${r.stake}${ev}\n`;
    });
    if (pendientes.length > 4) msg += `  ... y ${pendientes.length - 4} más\n`;
  }

  // Últimas 3 completadas
  if (completadas.length) {
    msg += `\n<b>Últimas resueltas:</b>\n`;
    completadas.slice(-3).reverse().forEach(r => {
      const icon = r.resultado === 'GANADA' ? '✅' : '❌';
      msg += `${icon} ${r.seleccion} @ ${r.cuota} → ${r.resultado} (${r.profit_loss >= 0 ? '+' : ''}${r.profit_loss})\n`;
    });
  }

  return msg.trim();
}

// ─── Calibración del modelo ───────────────────────────────────────────────────

/**
 * Compara las predicciones del modelo (AnalisisIA) vs los resultados reales (Partidos).
 * Calcula Brier Score y accuracy para los partidos ya terminados.
 *
 * Brier Score: error cuadrático medio de probabilidades predichas
 *   Rango [0, 1] — menor es mejor
 *   < 0.15: excelente | 0.15-0.22: bueno | > 0.22: mejorable
 *   Referencia: modelo aleatorio uniforme → Brier ≈ 0.222
 *
 * @returns {Object|null}
 */
function calculateModelCalibration_() {
  let aiRows, matchRows;
  try {
    aiRows    = readAll_(CONFIG.SHEETS.AI_ANALYSIS);
    matchRows = readAll_(CONFIG.SHEETS.PARTIDOS);
  } catch (e) {
    return null;
  }

  if (!aiRows.length || !matchRows.length) return null;

  const calibData = [];

  aiRows.forEach(ai => {
    if (!ai.prob_local) return;

    const match = matchRows.find(m =>
      String(m.fixture_id_af || '') === String(ai.fixture_id)
    );
    if (!match || !isFinishedStatus_(match.status)) return;

    const goalsH = Number(match.goles_local     || 0);
    const goalsA = Number(match.goles_visitante || 0);
    if (match.goles_local === '' || match.goles_visitante === '') return;

    const probHome = Number(ai.prob_local      || 0);
    const probDraw = Number(ai.prob_empate     || 0);
    const probAway = Number(ai.prob_visitante  || 0);

    const realHome = goalsH > goalsA ? 1 : 0;
    const realDraw = goalsH === goalsA ? 1 : 0;
    const realAway = goalsH < goalsA ? 1 : 0;

    // Brier Score multiclase (suma de errores cuadráticos por outcome / 3)
    const brier = (
      Math.pow(probHome - realHome, 2) +
      Math.pow(probDraw - realDraw, 2) +
      Math.pow(probAway - realAway, 2)
    ) / 3;

    // ¿El resultado con mayor probabilidad fue el correcto?
    const predicted = probHome > probDraw && probHome > probAway ? 'home'
                    : probAway > probHome && probAway > probDraw ? 'away' : 'draw';
    const real      = realHome ? 'home' : realAway ? 'away' : 'draw';

    calibData.push({ brier, correct: predicted === real });
  });

  if (!calibData.length) return null;

  const n        = calibData.length;
  const avgBrier = calibData.reduce((s, d) => s + d.brier, 0) / n;
  const accuracy = calibData.filter(d => d.correct).length / n;

  const interpretacion = avgBrier < 0.15 ? 'Excelente'
                       : avgBrier < 0.22 ? 'Bueno'
                       : 'Mejorable';

  // Guardar resultado en ModelCalibration
  try {
    getOrCreateSheet_(CONFIG.SHEETS.MODEL_CALIBRATION, CALIBRATION_HEADERS);
    appendRows_(CONFIG.SHEETS.MODEL_CALIBRATION, [[
      todayChile_(),
      n,
      Math.round(accuracy * 100) + '%',
      avgBrier.toFixed(4),
      interpretacion,
      nowChile_()
    ]]);
  } catch (e) { console.warn('ModelCalibration save:', e.message); }

  return {
    partidos_evaluados: n,
    accuracy:           Math.round(accuracy * 100) + '%',
    brier_score:        avgBrier.toFixed(4),
    interpretacion
  };
}

/**
 * Texto de calibración para el comando /calibrar.
 */
function buildCalibrationText_() {
  // Intentar leer calibración guardada (más rápido que recalcular)
  let calib = null;
  try {
    const rows = readAll_(CONFIG.SHEETS.MODEL_CALIBRATION);
    if (rows.length) {
      const last = rows[rows.length - 1];
      calib = {
        partidos_evaluados: last.partidos_evaluados,
        accuracy:           last.accuracy,
        brier_score:        last.brier_score,
        interpretacion:     last.interpretacion,
        fecha:              last.fecha
      };
    }
  } catch (e) { /* calcular en vivo */ }

  if (!calib) calib = calculateModelCalibration_();

  if (!calib) {
    return [
      '🎯 <b>Calibración del Modelo</b>',
      '',
      'Aún no hay suficientes partidos terminados para calibrar.',
      '',
      '<i>El modelo se calibra automáticamente con cada partido finalizado.</i>'
    ].join('\n');
  }

  const biasEmoji = calib.interpretacion === 'Excelente' ? '🟢'
                  : calib.interpretacion === 'Bueno'     ? '🟡' : '🔴';

  let msg = `🎯 <b>Calibración del Modelo Predictivo</b>\n\n`;
  msg    += `Partidos evaluados: <b>${calib.partidos_evaluados}</b>`;
  if (calib.fecha) msg += ` (actualizado ${calib.fecha})`;
  msg    += '\n\n';

  msg += `📊 Accuracy: <code>${calib.accuracy}</code>\n`;
  msg += `   (% de veces que el resultado predicho fue correcto)\n\n`;

  msg += `📉 Brier Score: <code>${calib.brier_score}</code>\n`;
  msg += `   Rango: 0 = perfecto | 0.222 = aleatorio | 1 = pésimo\n\n`;

  msg += `${biasEmoji} Calidad del modelo: <b>${calib.interpretacion}</b>\n\n`;

  msg += `<i>Un Brier Score &lt; 0.15 es excelente. El modelo aleatorio puro obtiene 0.222.</i>`;

  return msg;
}
