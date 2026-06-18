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
  'kelly_fraction','stake','resultado','profit_loss','roi_acum','notas',
  'closing_cuota','clv'  // Closing Line Value: CLV = (cuota_apostada / cuota_cierre) - 1
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

  // Closing Line Value: buscar cuota de cierre en OddsApuestas al momento de liquidar
  // La cuota de cierre es la mejor aproximación disponible de la "probabilidad real"
  if (idx('closing_cuota') !== -1 && idx('clv') !== -1) {
    try {
      const betLocal  = String(r[idx('equipo_local')]  || '');
      const betAway   = String(r[idx('equipo_visitante')] || '');
      const betMkt    = String(r[idx('mercado')]  || '').toLowerCase();
      const betSel    = String(r[idx('seleccion')] || '').toLowerCase();
      const normT     = s => String(s||'').toLowerCase()
        .replace(/[áàä]/g,'a').replace(/[éèë]/g,'e').replace(/[íìï]/g,'i')
        .replace(/[óòö]/g,'o').replace(/[úùü]/g,'u').replace(/ñ/g,'n').replace(/[^a-z0-9]/g,'');
      const oddsRows  = readAll_(CONFIG.SHEETS.ODDS).filter(od => {
        return (normT(od.home_team) === normT(betLocal) && normT(od.away_team) === normT(betAway)) ||
               (normT(od.home_team) === normT(betAway)  && normT(od.away_team) === normT(betLocal));
      }).filter(od => String(od.mercado||'').toLowerCase().includes(betMkt.split('/')[0].trim()) &&
                      normT(od.seleccion||'').includes(normT(betSel.split(' ')[0])));
      if (oddsRows.length) {
        const closing = Number(oddsRows[0].cuota || 0);
        if (closing > 1) {
          const betCuota = Number(r[idx('cuota')] || 0);
          const clv = betCuota > 0 ? ((betCuota / closing) - 1) : 0;
          sheet.getRange(sheetRow, idx('closing_cuota') + 1).setValue(closing.toFixed(2));
          sheet.getRange(sheetRow, idx('clv')           + 1).setValue((clv * 100).toFixed(2) + '%');
        }
      }
    } catch (e_) { /* CLV no crítico */ }
  }

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

  // Agregar tabla de calibración por buckets si hay datos
  try {
    const tablaCal = buildCalibrationBucketTable_();
    if (tablaCal) msg += '\n\n' + tablaCal;
  } catch (e) { /* no crítico */ }

  return msg;
}

/**
 * Tabla de calibración por buckets: ¿Cuando el modelo dice X%, ocurre X%?
 * Agrupa probabilidades predichas del resultado real en rangos de 10pp y compara con frecuencia observada.
 */
function buildCalibrationBucketTable_() {
  let aiRows, matchRows;
  try {
    aiRows    = readAll_(CONFIG.SHEETS.AI_ANALYSIS);
    matchRows = readAll_(CONFIG.SHEETS.PARTIDOS);
  } catch (e) { return null; }

  // Construir pares (prob_predicha_del_resultado_real, ocurrió)
  const pairs = [];
  aiRows.forEach(ai => {
    if (!ai.prob_local) return;
    const match = matchRows.find(m => String(m.fixture_id_af||'') === String(ai.fixture_id));
    if (!match || !isFinishedStatus_(match.status)) return;
    const goalsH = Number(match.goles_local     ?? -1);
    const goalsA = Number(match.goles_visitante ?? -1);
    if (goalsH < 0 || goalsA < 0) return;

    const probHome = Number(ai.prob_local     || 0);
    const probDraw = Number(ai.prob_empate    || 0);
    const probAway = Number(ai.prob_visitante || 0);

    // Cada partido genera 3 pares (uno por outcome)
    pairs.push({ prob: probHome, ocurrió: goalsH > goalsA ? 1 : 0 });
    pairs.push({ prob: probDraw, ocurrió: goalsH === goalsA ? 1 : 0 });
    pairs.push({ prob: probAway, ocurrió: goalsH < goalsA ? 1 : 0 });
  });

  if (pairs.length < 9) return null; // mínimo 3 partidos

  // Agrupar en buckets de 10pp
  const buckets = {};
  const limits  = [0, 0.10, 0.20, 0.30, 0.40, 0.50, 0.60, 0.70, 0.80, 0.90, 1.01];
  for (let i = 0; i < limits.length - 1; i++) {
    const lo = limits[i], hi = limits[i + 1];
    const label = `${Math.round(lo*100)}–${Math.round(hi*100)}%`;
    const inBucket = pairs.filter(p => p.prob >= lo && p.prob < hi);
    if (!inBucket.length) continue;
    const realRate = inBucket.filter(p => p.ocurrió).length / inBucket.length;
    const midpoint = (lo + hi) / 2;
    const bias = realRate - midpoint; // positivo = subestima, negativo = sobreestima
    buckets[label] = { n: inBucket.length, predicha: midpoint, real: realRate, bias };
  }

  if (!Object.keys(buckets).length) return null;

  let tbl = `\n📐 <b>Calibración por bucket</b>\n`;
  tbl += `<i>(predicha → real | bias)</i>\n`;
  Object.entries(buckets).forEach(([label, b]) => {
    const biasStr = b.bias >= 0 ? `+${(b.bias*100).toFixed(0)}pp` : `${(b.bias*100).toFixed(0)}pp`;
    const biasIcon = Math.abs(b.bias) < 0.05 ? '✅' : Math.abs(b.bias) < 0.10 ? '⚠️' : '🔴';
    tbl += `  ${label}: ${(b.real*100).toFixed(0)}% real (n=${b.n}) ${biasIcon} ${biasStr}\n`;
  });
  return tbl;
}

// ─── F5.1 — Auto-liquidación de apuestas ─────────────────────────────────────

/**
 * Busca apuestas PENDIENTES para un fixture terminado y las liquida automáticamente.
 * Llamar desde loadWorldCupDay_() después de updateEloAfterMatch_.
 *
 * @param {Object} fixture  Objeto fixture API-Football (fixture.fixture.id, fixture.goals)
 */
function autoSettleBetsForFixture_(fixture) {
  const fid    = String(fixture.fixture.id || '');
  const status = String((fixture.fixture.status || {}).short || '');
  if (!fid || !['FT','AET','PEN'].includes(status)) return;

  const goalsH = fixture.goals ? Number(fixture.goals.home ?? -1) : -1;
  const goalsA = fixture.goals ? Number(fixture.goals.away ?? -1) : -1;
  if (goalsH < 0 || goalsA < 0) return;

  let rows;
  try { rows = readAll_(CONFIG.SHEETS.BETTING_HISTORY); } catch (e) { return; }

  const pending = rows.filter(r =>
    String(r.fixture_id) === fid && String(r.resultado || '').toUpperCase() === 'PENDIENTE'
  );
  if (!pending.length) return;

  pending.forEach(bet => {
    try {
      const resultado = resolveBetOutcome_(bet, goalsH, goalsA);
      if (resultado) {
        settleBet_(bet.bet_id, resultado);
        Logger.log(`Auto-settled ${bet.bet_id}: ${resultado} (${goalsH}-${goalsA})`);
      }
    } catch (e) {
      console.warn(`autoSettleBetsForFixture_ ${bet.bet_id}:`, e.message);
    }
  });
}

/**
 * Determina si una apuesta se ganó o perdió según el resultado real.
 * Soporta mercados: 1X2, Over/Under 2.5, BTTS (Ambos Anotan).
 * Retorna null si el mercado no es reconocido (no auto-resolver).
 *
 * @param {Object} bet     Fila de BettingHistory
 * @param {number} goalsH  Goles del equipo local
 * @param {number} goalsA  Goles del equipo visitante
 * @returns {'GANADA'|'PERDIDA'|null}
 */
function resolveBetOutcome_(bet, goalsH, goalsA) {
  const mercado   = String(bet.mercado   || '').toUpperCase();
  const seleccion = String(bet.seleccion || '').toLowerCase();
  const totalGols = goalsH + goalsA;

  // 1X2
  if (mercado === '1X2' || mercado.includes('MATCH WINNER') || mercado.includes('RESULTADO')) {
    const homeTeam = String(bet.equipo_local     || '').toLowerCase();
    const awayTeam = String(bet.equipo_visitante || '').toLowerCase();

    const isHomeWin = goalsH > goalsA;
    const isAwayWin = goalsA > goalsH;
    const isDraw    = goalsH === goalsA;

    const selIsHome = homeTeam && seleccion.includes(homeTeam.substring(0, 4));
    const selIsAway = awayTeam && seleccion.includes(awayTeam.substring(0, 4));
    const selIsDraw = seleccion.includes('empate') || seleccion.includes('draw') || seleccion === 'x';

    if (selIsDraw) return isDraw    ? 'GANADA' : 'PERDIDA';
    if (selIsHome) return isHomeWin ? 'GANADA' : 'PERDIDA';
    if (selIsAway) return isAwayWin ? 'GANADA' : 'PERDIDA';
  }

  // Over/Under 2.5
  if (mercado.includes('OVER') || mercado.includes('UNDER') ||
      mercado.includes('2.5')  || mercado.includes('GOLES')) {
    const isOver = seleccion.includes('over')  || seleccion.includes('más')  || seleccion.includes('+2.5');
    const isUnder= seleccion.includes('under') || seleccion.includes('menos')|| seleccion.includes('-2.5');
    if (isOver)  return totalGols > 2.5 ? 'GANADA' : 'PERDIDA';
    if (isUnder) return totalGols < 2.5 ? 'GANADA' : 'PERDIDA';
  }

  // BTTS — Ambos Anotan
  if (mercado.includes('BTTS') || mercado.includes('AMBOS') || mercado.includes('BOTH')) {
    const bothScored = goalsH > 0 && goalsA > 0;
    const selYes = seleccion.includes('sí') || seleccion.includes('si') || seleccion.includes('yes');
    const selNo  = seleccion.includes('no');
    if (selYes) return bothScored  ? 'GANADA' : 'PERDIDA';
    if (selNo)  return !bothScored ? 'GANADA' : 'PERDIDA';
  }

  return null; // mercado no reconocido — no auto-resolver
}

// ─── F5.3 — Reporte semanal de rendimiento ────────────────────────────────────

/**
 * Reporte semanal de rendimiento: ROI, Brier Score, picks de la semana.
 * Configurar trigger semanal: domingo 20:00.
 */
function cronWeeklyPerformanceReport() {
  const today   = new Date();
  const weekAgo = new Date(today.getTime() - 7 * 24 * 60 * 60 * 1000);
  const weekStr = Utilities.formatDate(weekAgo, CONFIG.TIMEZONE, 'yyyy-MM-dd');

  let bets;
  try { bets = readAll_(CONFIG.SHEETS.BETTING_HISTORY); } catch (e) { bets = []; }

  const weekBets = bets.filter(r => String(r.fecha || '') >= weekStr);
  const settled  = weekBets.filter(r => r.resultado === 'GANADA' || r.resultado === 'PERDIDA');
  const ganadas  = settled.filter(r => r.resultado === 'GANADA');

  const plSemana   = settled.reduce((s, r) => s + Number(r.profit_loss || 0), 0);
  const stakeSem   = settled.reduce((s, r) => s + Number(r.stake       || 0), 0);
  const roiSemana  = stakeSem > 0 ? (plSemana / stakeSem * 100).toFixed(1) : '0.0';

  const autoBets   = weekBets.filter(r => String(r.notas || '').includes('AUTO'));
  const evProy     = settled.reduce((s, r) => s + Number(r.ev || 0), 0);
  const evRealiz   = stakeSem > 0 ? plSemana / stakeSem : 0;

  const roiEmoji = Number(roiSemana) > 0 ? '📈' : Number(roiSemana) < 0 ? '📉' : '➡️';
  const plSign   = plSemana >= 0 ? '+' : '';

  let msg = `📊 <b>Reporte Semanal — Mundial 2026</b>\n`;
  msg    += `<i>${weekStr} → ${todayChile_()}</i>\n\n`;
  msg    += `${roiEmoji} <b>ROI semana: ${roiSemana}%</b>  P&L: ${plSign}${plSemana.toFixed(2)}\n`;
  msg    += `✅ ${ganadas.length}/${settled.length} apuestas cerradas\n`;
  if (autoBets.length) msg += `🤖 Auto-bets semana: ${autoBets.length}\n`;

  if (settled.length > 0) {
    msg += `\n📐 EV proyectado (media): <code>${(evProy / settled.length * 100).toFixed(1)}%</code>\n`;
    msg += `📐 EV realizado: <code>${(evRealiz * 100).toFixed(1)}%</code>\n`;
  }

  // Calibración del modelo
  try {
    const calib = calculateModelCalibration_();
    if (calib && calib.brier_score) {
      const biasEmoji = calib.interpretacion === 'Excelente' ? '🟢' : calib.interpretacion === 'Bueno' ? '🟡' : '🔴';
      msg += `\n🎯 <b>Modelo esta semana</b>\n`;
      msg += `  ${biasEmoji} Brier Score: <code>${calib.brier_score}</code> (${calib.interpretacion})\n`;
      msg += `  Accuracy: <code>${calib.accuracy}</code>\n`;
    }
  } catch (e_) { /* omitir */ }

  // Mejor pick de la semana
  const topPick = [...ganadas].sort((a, b) =>
    Number(b.profit_loss || 0) - Number(a.profit_loss || 0)
  )[0];
  if (topPick) {
    msg += `\n⭐ <b>Mejor pick:</b> ${topPick.seleccion} @ ${topPick.cuota}`;
    msg += ` → +${Number(topPick.profit_loss).toFixed(2)}\n`;
  }

  if (!settled.length) {
    msg += '\n<i>Sin apuestas cerradas esta semana.</i>\n';
  }

  msg += `\n<i>⚠️ Análisis informativo. Apuesta responsablemente.</i>`;

  broadcastTelegramMessage_(msg);
}

// ─── F5.4 — Comando /portafolio ───────────────────────────────────────────────

/**
 * Posición actual del portafolio de apuestas.
 * Muestra: posiciones abiertas, P&L realizado, ROI, Brier Score.
 */
function buildPortfolioText_() {
  let bets;
  try { bets = readAll_(CONFIG.SHEETS.BETTING_HISTORY); } catch (e) { bets = []; }

  const pendientes  = bets.filter(r => String(r.resultado || '').toUpperCase() === 'PENDIENTE');
  const completadas = bets.filter(r => r.resultado === 'GANADA' || r.resultado === 'PERDIDA');
  const ganadas     = completadas.filter(r => r.resultado === 'GANADA');

  const plReal    = completadas.reduce((s, r) => s + Number(r.profit_loss || 0), 0);
  const stakeReal = completadas.reduce((s, r) => s + Number(r.stake       || 0), 0);
  const roiReal   = stakeReal > 0 ? (plReal / stakeReal * 100).toFixed(1) : '0.0';

  const stakeEnRiesgo = pendientes.reduce((s, r) => s + Number(r.stake || 0), 0);
  const plEsperado    = pendientes.reduce((s, r) => {
    return s + (Number(r.stake || 0) * Number(r.ev || 0));
  }, 0);

  const roiEmoji = Number(roiReal) > 0 ? '📈' : Number(roiReal) < 0 ? '📉' : '➡️';
  const plSign   = plReal >= 0 ? '+' : '';

  let msg = `💼 <b>Portafolio de Apuestas — Mundial 2026</b>\n\n`;

  msg += `${roiEmoji} <b>P&L realizado: ${plSign}${plReal.toFixed(2)}</b>`;
  msg += `  ROI: <code>${roiReal}%</code>\n`;
  msg += `📊 ${ganadas.length}/${completadas.length} ganadas (${completadas.length ? Math.round(ganadas.length / completadas.length * 100) : 0}%)\n\n`;

  if (pendientes.length) {
    msg += `⏳ <b>Posiciones abiertas (${pendientes.length})</b>\n`;
    msg += `  Stake en riesgo: <code>${stakeEnRiesgo.toFixed(2)}</code>\n`;
    const epSign = plEsperado >= 0 ? '+' : '';
    msg += `  P&L esperado: <code>${epSign}${plEsperado.toFixed(2)}</code>\n\n`;

    pendientes.slice(0, 6).forEach(r => {
      const evStr  = r.ev     ? ` EV${(Number(r.ev) * 100).toFixed(0)}%` : '';
      const autoTag= String(r.notas || '').includes('AUTO') ? ' 🤖' : '';
      msg += `  • ${r.seleccion} @ ${r.cuota} (×${r.stake}${evStr}${autoTag})\n`;
    });
    if (pendientes.length > 6) msg += `  <i>...y ${pendientes.length - 6} más</i>\n`;
  } else {
    msg += `✅ Sin posiciones abiertas\n`;
  }

  // Calibración
  try {
    const calRows = readAll_(CONFIG.SHEETS.MODEL_CALIBRATION);
    if (calRows.length) {
      const last = calRows[calRows.length - 1];
      const biasEmoji = last.interpretacion === 'Excelente' ? '🟢' : last.interpretacion === 'Bueno' ? '🟡' : '🔴';
      msg += `\n🎯 Brier Score: ${biasEmoji} <code>${last.brier_score}</code> (${last.interpretacion})`;
      if (last.partidos_evaluados) msg += ` — ${last.partidos_evaluados} partidos`;
      msg += '\n';
    }
  } catch (e_) { /* omitir */ }

  if (!bets.length) {
    msg += '\n<i>No hay apuestas registradas aún.\nUsa registerBet_() para agregar la primera.</i>';
  }

  return msg.trim();
}

// ─── ROI + Hit rate por mercado + Closing Line Value ──────────────────────────

/**
 * Rendimiento desglosado por mercado: ROI, hit rate, CLV promedio.
 * Comando /rendimiento del bot.
 */
function buildPerformanceByMarket_() {
  let bets;
  try { bets = readAll_(CONFIG.SHEETS.BETTING_HISTORY); } catch (e) { bets = []; }

  const settled = bets.filter(r => r.resultado === 'GANADA' || r.resultado === 'PERDIDA');
  if (!settled.length) {
    return '📊 <b>Rendimiento por mercado</b>\n\nSin apuestas liquidadas aún.';
  }

  // Agrupar por mercado normalizado
  const byMkt = {};
  settled.forEach(r => {
    const mkt = String(r.mercado || 'Otro').split('/')[0].trim().toUpperCase();
    if (!byMkt[mkt]) byMkt[mkt] = { ganadas: 0, total: 0, stake: 0, pl: 0, evSum: 0, evN: 0, clvSum: 0, clvN: 0 };
    const m = byMkt[mkt];
    m.total++;
    m.stake += Number(r.stake || 0);
    m.pl    += Number(r.profit_loss || 0);
    if (r.resultado === 'GANADA') m.ganadas++;
    if (r.ev) { m.evSum += Number(r.ev) * 100; m.evN++; }
    if (r.clv) {
      const clvNum = parseFloat(String(r.clv).replace('%',''));
      if (!isNaN(clvNum)) { m.clvSum += clvNum; m.clvN++; }
    }
  });

  // CLV global
  const clvRows = settled.filter(r => r.clv);
  const avgClvGlobal = clvRows.length
    ? (clvRows.reduce((s, r) => s + parseFloat(String(r.clv).replace('%','')), 0) / clvRows.length).toFixed(1)
    : null;

  // Brier Score
  let brierStr = '';
  try {
    const calRows = readAll_(CONFIG.SHEETS.MODEL_CALIBRATION);
    if (calRows.length) {
      const last = calRows[calRows.length - 1];
      const emoji = last.interpretacion === 'Excelente' ? '🟢' : last.interpretacion === 'Bueno' ? '🟡' : '🔴';
      brierStr = `\n${emoji} Brier Score: <code>${last.brier_score}</code> (${last.interpretacion})`;
    }
  } catch (e_) {}

  const totalStake = settled.reduce((s, r) => s + Number(r.stake || 0), 0);
  const totalPL    = settled.reduce((s, r) => s + Number(r.profit_loss || 0), 0);
  const totalGan   = settled.filter(r => r.resultado === 'GANADA').length;
  const roiGlobal  = totalStake > 0 ? (totalPL / totalStake * 100).toFixed(1) : '0.0';
  const roiEmoji   = Number(roiGlobal) > 0 ? '📈' : Number(roiGlobal) < 0 ? '📉' : '➡️';

  let msg = `📊 <b>Rendimiento por mercado</b>\n\n`;
  msg += `${roiEmoji} ROI global: <code>${roiGlobal}%</code>  P&L: <code>${totalPL >= 0 ? '+' : ''}${totalPL.toFixed(2)}</code>\n`;
  msg += `✅ Hit rate global: <code>${(totalGan / settled.length * 100).toFixed(0)}%</code> (${totalGan}/${settled.length})\n`;
  if (avgClvGlobal !== null) {
    const clvEmoji = Number(avgClvGlobal) > 0 ? '✅' : '⚠️';
    msg += `${clvEmoji} CLV promedio: <code>${avgClvGlobal > 0 ? '+' : ''}${avgClvGlobal}%</code>\n`;
    msg += `<i>CLV positivo = apostaste antes de que el mercado se moviera en tu contra</i>\n`;
  }
  msg += brierStr + '\n';
  msg += '\n<b>Desglose por mercado:</b>\n';

  Object.entries(byMkt)
    .sort((a, b) => b[1].total - a[1].total)
    .forEach(([mkt, m]) => {
      const roi      = m.stake > 0 ? (m.pl / m.stake * 100).toFixed(1) : '0.0';
      const hitRate  = (m.ganadas / m.total * 100).toFixed(0);
      const roiSign  = Number(roi) >= 0 ? '+' : '';
      const avgEv    = m.evN ? (m.evSum / m.evN).toFixed(1) : '–';
      const avgClv   = m.clvN ? (m.clvSum / m.clvN).toFixed(1) : '–';
      const rEmoji   = Number(roi) > 0 ? '✅' : Number(roi) < 0 ? '❌' : '➡️';
      msg += `\n${rEmoji} <b>${mkt}</b> (${m.total} apuestas)\n`;
      msg += `  ROI: <code>${roiSign}${roi}%</code>  Hit: <code>${hitRate}%</code>`;
      if (avgEv !== '–') msg += `  EV prom: <code>+${avgEv}%</code>`;
      if (avgClv !== '–') msg += `  CLV: <code>${Number(avgClv) >= 0 ? '+' : ''}${avgClv}%</code>`;
      msg += '\n';
    });

  return msg.trim();
}
