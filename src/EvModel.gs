/**
 * EvModel.gs
 *
 * Calcula Expected Value (EV) y Kelly Criterion para cada mercado de un partido.
 *
 * Lee cuotas y probabilidades ya guardadas en OddsApuestas (no llama APIs externas).
 * Las probabilidades en OddsApuestas vienen de The Odds API con vig removal aplicado.
 *
 * Fórmulas:
 *   EV   = (prob_modelo × cuota_decimal) − 1
 *          > 0 = apuesta de valor positivo
 *   Edge = prob_modelo − prob_implicita_mercado
 *          = ventaja real vs lo que paga el mercado
 *   Kelly_raw = (prob × cuota − 1) / (cuota − 1)
 *   Kelly     = max(0, min(Kelly_raw / KELLY_DIVISOR, KELLY_MAX_FRACTION))
 *          Fracción del bankroll a apostar (Kelly fraccionario conservador)
 *
 * Uso:
 *   - calculateEvForFixture_(fixture) → array de oportunidades
 *   - saveAndAlertEvOpportunities_(fixture, opportunities) → guarda + alerta Telegram
 *   - buildEvSummaryText_() → texto para /ev
 */

const EV_POSITIVE_THRESHOLD  = 0.05;  // EV > 5% = oportunidad
const EDGE_MIN_THRESHOLD     = 0.03;  // Edge mínimo para alertar (3%)
const KELLY_MAX_FRACTION     = 0.10;  // Nunca más del 10% del bankroll
const KELLY_DIVISOR          = 4;     // Fractional Kelly conservador (Kelly/4)

// ─── Cálculo de EV ────────────────────────────────────────────────────────────

/**
 * Calcula EV y Kelly para todos los mercados de un fixture.
 * Usa probabilidades del modelo Poisson como estimación independiente.
 * Las cuotas vienen de The Odds API (fuente real del mercado).
 *
 * El EV es real (edge genuino) porque Poisson ≠ mercado.
 *
 * @param {Object} fixture  Objeto fixture de API-Football o mínimo {fixture:{id:N}, teams:{home:{name}, away:{name}}}
 * @returns {Array} Oportunidades ordenadas por EV desc
 */
function calculateEvForFixture_(fixture) {
  const fixtureId = String(fixture.fixture.id);
  const home = fixture.teams.home.name;
  const away = fixture.teams.away.name;

  // 1. Obtener cuotas de mercado (The Odds API)
  // Matching por nombre de equipo porque fixture_id de The Odds API (UUID)
  // difiere del fixture_id de API-Football (numérico)
  const normT = s => String(s || '').toLowerCase()
    .replace(/[áàä]/g,'a').replace(/[éèë]/g,'e').replace(/[íìï]/g,'i')
    .replace(/[óòö]/g,'o').replace(/[úùü]/g,'u').replace(/ñ/g,'n')
    .replace(/[^a-z]/g,'');
  const homeNorm = normT(home);
  const awayNorm = normT(away);
  let allOddsRows;
  try {
    // Primero intentar desde caché/API en tiempo real
    const liveOdds = getAllOddsFromCacheOrApi_();
    if (liveOdds && liveOdds.length) {
      const ev = liveOdds.find(e =>
        (normT(e.home_team) === homeNorm && normT(e.away_team) === awayNorm) ||
        (normT(e.home_team) === awayNorm && normT(e.away_team) === homeNorm)
      );
      if (ev) {
        const parsed = parseOddsEventWithPinnacle_(ev);
        if (parsed && parsed.odd_local) {
          allOddsRows = [{ home_team: ev.home_team, away_team: ev.away_team,
            odd_local: parsed.odd_local, odd_empate: parsed.odd_empate, odd_visitante: parsed.odd_visitante,
            prob_local: parsed.prob_local, prob_empate: parsed.prob_empate, prob_visitante: parsed.prob_visitante,
            over25_prob: parsed.over25_prob, btts_prob: parsed.btts_prob,
            bookmakers_count: parsed.bookmakers_count, fuente: 'THE_ODDS_API' }];
        }
      }
    }
    // Fallback: leer hoja OddsApuestas por nombre de equipo
    if (!allOddsRows || !allOddsRows.length) {
      allOddsRows = readAll_(CONFIG.SHEETS.ODDS).filter(r => {
        const rH = normT(r.home_team || '');
        const rA = normT(r.away_team || '');
        return (rH === homeNorm && rA === awayNorm) ||
               (rH === awayNorm && rA === homeNorm);
      });
    }
  } catch (e) {
    console.warn(`calculateEvForFixture_ ${fixtureId}: ${e.message}`);
    return [];
  }
  const oddsRows = allOddsRows || [];
  if (!oddsRows.length) return [];

  // 2. Obtener probabilidades del modelo Poisson (independiente del mercado)
  let poisson = null;
  try { poisson = getPoissonOdds_(home, away); } catch (e_) {}

  // 3. Fallback: si Poisson no tiene datos, usar ELO
  let eloProbs = null;
  if (!poisson) {
    try { eloProbs = getEloProbabilities_(home, away); } catch (e_) {}
  }

  /**
   * Retorna la probabilidad de nuestro modelo para un mercado+selección dados.
   * Convierte en [0,1], retorna null si no hay dato.
   */
  function modelProb(mercado, seleccion) {
    const sel = String(seleccion || '').toLowerCase();
    const mkt = String(mercado  || '').toLowerCase();

    // Resultado 1X2
    if (mkt === '1x2' || mkt === 'h2h' || mkt === 'match winner') {
      // Normalizar selección y nombres de equipo (sin tildes, solo a-z)
      const selN  = normT(sel);
      const hNorm = normT(teamNameToSpanish_(home));
      const aNorm = normT(teamNameToSpanish_(away));
      // Primero detectar empate explícitamente para evitar falsos positivos
      const isDraw = selN === 'draw' || selN === 'empate' || selN === 'x' || selN === 'tie';
      const isHome = !isDraw && (selN === 'home' || selN === '1' ||
                     selN.includes(hNorm) || hNorm.includes(selN) ||
                     normT(home).includes(selN) || selN.includes(normT(home)));
      const isAway = !isDraw && !isHome && (selN === 'away' || selN === '2' ||
                     selN.includes(aNorm) || aNorm.includes(selN) ||
                     normT(away).includes(selN) || selN.includes(normT(away)));
      if (poisson) {
        if (isHome) return poisson.prob_home / 100;
        if (isAway) return poisson.prob_away / 100;
        return poisson.prob_draw / 100;
      }
      if (eloProbs) {
        if (isHome) return eloProbs.home;
        if (isAway) return eloProbs.away;
        return eloProbs.draw;
      }
    }

    // Over/Under
    if (mkt.includes('total') || mkt.includes('over') || mkt.includes('under')) {
      if (!poisson) return null;
      const lineMatch = mkt.match(/(\d+\.?\d*)/);
      const line = lineMatch ? parseFloat(lineMatch[1]) : 2.5;
      // Usamos 2.5 como aproximación si no hay línea exacta
      const lineKey = line === 1.5 ? 'over_1_5' : line === 3.5 ? 'over_3_5' : 'over_2_5';
      if (sel.includes('over')) return (poisson[lineKey] || poisson.over_2_5) / 100;
      if (sel.includes('under')) return (poisson[`under_${lineKey.replace('over_','')}`] || poisson.under_2_5) / 100;
    }

    // BTTS
    if (mkt.includes('btts') || mkt.includes('both teams')) {
      if (!poisson) return null;
      if (sel === 'yes' || sel === 'si' || sel === 'ambos') return poisson.prob_btts_si / 100;
      return poisson.prob_btts_no / 100;
    }

    return null;
  }

  const opportunities = [];

  oddsRows.forEach(row => {
    const cuota = Number(row.cuota);
    if (!cuota || cuota < 1.01) return;

    const prob = modelProb(row.mercado, row.seleccion);
    if (!prob || prob <= 0 || prob >= 1) return;

    const probImplicita = 1 / cuota;
    const ev   = (prob * cuota) - 1;
    const edge = prob - probImplicita;

    const kellyRaw = (prob * cuota - 1) / (cuota - 1);
    const kelly    = Math.max(0, Math.min(kellyRaw / KELLY_DIVISOR, KELLY_MAX_FRACTION));

    // Confianza basada en fuente del modelo
    const confianza = poisson
      ? (poisson.source === 'poisson_cache' ? 'ALTA' : 'MEDIA')
      : (eloProbs ? 'MEDIA' : 'BAJA');

    opportunities.push({
      fixture_id:       fixtureId,
      equipo_local:     home,
      equipo_visitante: away,
      mercado:          String(row.mercado   || ''),
      seleccion:        String(row.seleccion || ''),
      cuota,
      prob_modelo:      prob,
      prob_implicita:   probImplicita,
      ev,
      edge,
      kelly,
      confianza,
      fuente_modelo:    poisson ? 'POISSON' : (eloProbs ? 'ELO' : 'N/A'),
      es_positivo:      ev > EV_POSITIVE_THRESHOLD && edge > EDGE_MIN_THRESHOLD
    });
  });

  return opportunities.sort((a, b) => b.ev - a.ev);
}

// ─── Guardado y alertas ───────────────────────────────────────────────────────

/**
 * Guarda oportunidades EV en la hoja EvOpportunities y envía alerta si hay EV+.
 * Hace upsert por fixture_id (elimina filas previas del mismo fixture antes de insertar).
 */
function saveAndAlertEvOpportunities_(fixture, opportunities) {
  if (!opportunities || !opportunities.length) return;

  const fixtureId = String(fixture.fixture.id);

  // Dedup: eliminar filas existentes para este fixture
  try {
    const ss    = SpreadsheetApp.openById(getSpreadsheetId_());
    const sheet = ss.getSheetByName(CONFIG.SHEETS.EV_OPPORTUNITIES);
    if (sheet && sheet.getLastRow() > 1) {
      const vals   = sheet.getDataRange().getValues();
      const fidIdx = vals[0].indexOf('fixture_id');
      if (fidIdx !== -1) {
        for (let i = vals.length - 1; i >= 1; i--) {
          if (String(vals[i][fidIdx]) === fixtureId) sheet.deleteRow(i + 1);
        }
      }
    }
  } catch (e) { /* hoja no existe aún, se crea abajo */ }

  getOrCreateSheet_(CONFIG.SHEETS.EV_OPPORTUNITIES, [
    'fixture_id','timestamp','mercado','seleccion','cuota',
    'prob_modelo','ev','edge','kelly','ev_positivo','confianza'
  ]);

  const rows = opportunities.map(o => [
    fixtureId,
    nowChile_(),
    o.mercado,
    o.seleccion,
    o.cuota,
    o.prob_modelo,
    Math.round(o.ev    * 10000) / 10000,
    Math.round(o.edge  * 10000) / 10000,
    Math.round(o.kelly * 10000) / 10000,
    o.es_positivo ? 'SI' : 'NO',
    o.confianza
  ]);

  appendRows_(CONFIG.SHEETS.EV_OPPORTUNITIES, rows);

  // Alerta solo si hay EV+ con datos de mercado real
  const positivas = opportunities.filter(o => o.es_positivo && o.confianza !== 'BAJA');
  if (positivas.length) {
    try { sendEvAlert_(fixture, positivas);      } catch (e) { console.warn('EV alert:', e.message); }
    try { autoRegisterBets_(fixture, positivas); } catch (e) { console.warn('AutoBet:', e.message); }
  }
}

// ─── F5.2 — Auto-registro de apuestas EV+ ────────────────────────────────────

/**
 * Registra automáticamente las oportunidades EV+ que superan el threshold.
 * Solo actúa si Script Property AUTO_BET_BASE_STAKE está configurada (> 0).
 * Máximo 2 bets por fixture para evitar sobreexposición.
 * Flag 'AUTO' en notas para distinguirlas de apuestas manuales.
 */
function autoRegisterBets_(fixture, opportunities) {
  const baseStake = Number(
    PropertiesService.getScriptProperties().getProperty('AUTO_BET_BASE_STAKE') || '0'
  );
  if (baseStake <= 0) return; // auto-bets desactivadas si la property no está configurada

  const threshold = Number(
    PropertiesService.getScriptProperties().getProperty('AUTO_BET_EV_THRESHOLD') || '0.08'
  );

  const candidates = opportunities
    .filter(o => o.ev > threshold && o.kelly > 0)
    .sort((a, b) => b.ev - a.ev)
    .slice(0, 2); // máx 2 por fixture

  if (!candidates.length) return;

  const fid = String(fixture.fixture.id);

  // Cargar existentes para dedup
  let existing;
  try { existing = readAll_(CONFIG.SHEETS.BETTING_HISTORY); } catch (e) { existing = []; }

  candidates.forEach(o => {
    const already = existing.some(b =>
      String(b.fixture_id) === fid &&
      b.mercado    === o.mercado &&
      b.seleccion  === o.seleccion &&
      String(b.notas || '').includes('AUTO')
    );
    if (already) return;

    const stake = Math.round(baseStake * o.kelly * 0.5 * 100) / 100;
    if (stake < 0.01) return; // stake demasiado pequeño para registrar

    try {
      const betId = registerBet_(
        fid,
        o.mercado,
        o.seleccion,
        o.cuota,
        stake,
        `AUTO|ev=${o.ev.toFixed(4)}|threshold=${threshold}`
      );
      Logger.log(`Auto-bet: ${betId} — ${o.seleccion} @ ${o.cuota} EV=${(o.ev*100).toFixed(1)}%`);
    } catch (e) {
      console.warn(`autoRegisterBets_ ${o.seleccion}:`, e.message);
    }
  });
}

/**
 * Envía alerta de EV+ por Telegram a todos los suscriptores.
 */
function sendEvAlert_(fixture, positivas) {
  const label = `${fixture.teams.home.name} vs ${fixture.teams.away.name}`;
  const fecha  = toChileDateTime_(fixture.fixture.date || '').substring(0, 16);

  let msg = `📊 <b>Oportunidad EV+ detectada</b>\n`;
  msg    += `⚽ ${label}\n`;
  if (fecha) msg += `🕐 ${fecha}\n`;
  msg    += '\n';

  positivas.slice(0, 3).forEach(o => {
    const evPct    = (o.ev    * 100).toFixed(1);
    const edgePct  = (o.edge  * 100).toFixed(1);
    const kellyPct = (o.kelly * 100).toFixed(1);
    const emoji    = o.ev > 0.15 ? '🔥' : o.ev > 0.08 ? '✅' : '⚠️';

    msg += `${emoji} <b>${o.seleccion}</b> (${o.mercado})\n`;
    msg += `  Cuota: <code>${o.cuota.toFixed(2)}</code>  `;
    msg += `EV: <code>+${evPct}%</code>  `;
    msg += `Edge: <code>+${edgePct}%</code>\n`;
    msg += `  Prob modelo: <code>${pct_(o.prob_modelo)}</code>  `;
    msg += `Kelly: <code>${kellyPct}%</code>\n\n`;
  });

  msg += `<i>⚠️ Análisis informativo. Apuesta responsablemente.</i>`;

  broadcastTelegramMessage_(msg);

  // Adjuntar imagen de probabilidades si disponible
  try {
    const home = fixture.teams.home.name;
    const away = fixture.teams.away.name;
    const probs = getEloProbabilities_(home, away);
    if (probs) {
      const chartUrl = buildProbabilityChartUrl_(home, away, probs.home, probs.draw, probs.away);
      const caption  = `📊 ELO: ${home} ${Math.round(probs.home * 100)}% | Empate ${Math.round(probs.draw * 100)}% | ${away} ${Math.round(probs.away * 100)}%`;
      broadcastTelegramPhoto_(chartUrl, caption);
    }
  } catch (e_) { console.warn('sendEvAlert_ chart:', e_.message); }
}

// ─── Texto para bot ───────────────────────────────────────────────────────────

/**
 * Resumen de oportunidades EV+ para el comando /ev.
 */
function buildEvSummaryText_() {
  let rows;
  try {
    rows = readAll_(CONFIG.SHEETS.EV_OPPORTUNITIES)
      .filter(r => String(r.ev_positivo) === 'SI')
      .sort((a, b) => Number(b.ev || 0) - Number(a.ev || 0));
  } catch (e) {
    return '📊 Sin datos de EV. Ejecuta cronEvCalculation o cronTomorrowPreview primero.';
  }

  if (!rows.length) {
    return '📊 Sin oportunidades EV+ detectadas para los próximos partidos.\n\n<i>Las cuotas de mercado no muestran valor estadístico en este momento.</i>';
  }

  // Agrupar por fixture (un fixture puede tener múltiples mercados EV+)
  const byFixture = {};
  rows.forEach(r => {
    const k = String(r.fixture_id);
    if (!byFixture[k]) byFixture[k] = { rows: [] };
    byFixture[k].rows.push(r);
  });

  let msg = `📊 <b>Oportunidades EV+ — Mundial 2026</b>\n`;
  msg    += `<i>Actualizado: ${rows[0].timestamp || ''}</i>\n\n`;

  Object.values(byFixture).slice(0, 6).forEach(group => {
    const first = group.rows[0];
    msg += `⚽ Fixture ${first.fixture_id}\n`;

    group.rows.slice(0, 3).forEach(o => {
      const evPct    = (Number(o.ev)    * 100).toFixed(1);
      const kellyPct = (Number(o.kelly) * 100).toFixed(1);
      const emoji    = Number(o.ev) > 0.12 ? '🔥' : '✅';
      msg += `  ${emoji} ${o.seleccion} @ ${Number(o.cuota).toFixed(2)} — EV +${evPct}% | Kelly ${kellyPct}%\n`;
    });

    msg += '\n';
  });

  msg += `<i>⚠️ Solo informativo. Apuesta responsablemente.</i>`;
  return msg.trim();
}

// ─── Helper para SmartAlerts ──────────────────────────────────────────────────

/**
 * Construye un objeto fixture mínimo a partir de una fila de la hoja Partidos.
 * Necesario porque SmartAlerts trabaja con filas planas, no objetos API-Football.
 *
 * @param {Object} row  Fila de readAll_(CONFIG.SHEETS.PARTIDOS)
 * @returns {Object}    Objeto compatible con calculateEvForFixture_
 */
function buildFixtureFromSheetRow_(row) {
  return {
    fixture: {
      id:   row.fixture_id_af || row.match_key || '',
      date: row.fecha          || '',
      status: { short: row.status || '' }
    },
    teams: {
      home: { name: row.local      || '' },
      away: { name: row.visitante  || '' }
    },
    league: { round: row.ronda || '' },
    goals:  { home: row.goles_local || null, away: row.goles_visitante || null }
  };
}

// ── Función pública para ejecutar desde el editor ─────────────────────────────
/**
 * Calcula EV directamente desde The Odds API + modelo Poisson/ELO.
 * No depende del schema de OddsApuestas — trabaja con los eventos en tiempo real.
 */
function calcularEV() {
  const normT = s => String(s || '').toLowerCase()
    .replace(/[áàä]/g,'a').replace(/[éèë]/g,'e').replace(/[íìï]/g,'i')
    .replace(/[óòö]/g,'o').replace(/[úùü]/g,'u').replace(/ñ/g,'n')
    .replace(/[^a-z]/g,'');

  // 1. Obtener todos los eventos con cuotas
  const oddsEvents = getAllOddsFromCacheOrApi_();
  if (!oddsEvents || !oddsEvents.length) {
    Logger.log('❌ No se obtuvieron eventos de The Odds API. Verifica clave y sport_key.');
    return;
  }
  Logger.log(`✅ ${oddsEvents.length} eventos obtenidos de The Odds API`);

  const today    = todayChile_();
  const tomorrow = tomorrowChile_();

  const EV_HEADERS = ['fixture_id','timestamp','fecha','local','visitante','mercado','seleccion','cuota',
                      'prob_modelo','ev','edge','kelly','ev_positivo','confianza','fuente_modelo'];

  // Asegurar headers correctos y preservar historial de otros días
  try {
    const ss = SpreadsheetApp.openById(getSpreadsheetId_());
    const sheet = ss.getSheetByName(CONFIG.SHEETS.EV_OPPORTUNITIES);
    let toKeep = [];
    if (sheet) {
      const vals = sheet.getDataRange().getValues();
      // Check if first row looks like headers (contains 'fecha' or 'fixture_id')
      const firstRow = vals[0] || [];
      const hasHeaders = firstRow.includes('fecha') || firstRow.includes('fixture_id');
      if (hasHeaders) {
        const hdrs = firstRow;
        const fechaIdx = hdrs.indexOf('fecha');
        toKeep = vals.slice(1).filter(row => {
          const f = String(row[fechaIdx] || '');
          return f && f !== today && f !== tomorrow;
        });
      }
      sheet.clearContents();
      sheet.getRange(1, 1, 1, EV_HEADERS.length).setValues([EV_HEADERS]);
      if (toKeep.length) {
        sheet.getRange(2, 1, toKeep.length, EV_HEADERS.length).setValues(toKeep);
      }
    } else {
      getOrCreateSheet_(CONFIG.SHEETS.EV_OPPORTUNITIES, EV_HEADERS);
    }
  } catch(ec_) { Logger.log('Error preparando hoja EV: ' + ec_.message); }

  let totalOpps = 0;
  const now = nowChile_();
  const newRows = [];

  oddsEvents.forEach(ev => {
    const homeEn = ev.home_team || '';
    const awayEn = ev.away_team || '';
    const homeEs = teamNameToSpanish_(homeEn);
    const awayEs = teamNameToSpanish_(awayEn);

    // Solo partidos de hoy/mañana
    const commence = String(ev.commence_time || '').substring(0, 10);
    if (commence !== today && commence !== tomorrow) return;

    // Obtener probabilidades del modelo
    let poisson = null;
    let eloProbs = null;
    try { poisson  = getPoissonOdds_(homeEn, awayEn); } catch(e_) {}
    if (!poisson) {
      try { poisson = getPoissonOdds_(homeEs, awayEs); } catch(e_) {}
    }
    if (!poisson) {
      try { eloProbs = getEloProbabilities_(homeEn, awayEn); } catch(e_) {}
    }
    if (!poisson && !eloProbs) {
      Logger.log(`⚠️  Sin modelo para ${homeEs} vs ${awayEs}`);
      return;
    }

    const parsed = parseOddsEventWithPinnacle_(ev);
    if (!parsed) return;

    const fuente = poisson ? 'POISSON' : 'ELO';
    const confianza = poisson
      ? (poisson.source === 'poisson_cache' ? 'ALTA' : 'MEDIA')
      : 'MEDIA';

    const mkKey = `${normT(homeEs)}_vs_${normT(awayEs)}_${commence}`;

    // Calcular EV para cada mercado disponible
    const mercados = [
      { mercado: '1X2', seleccion: homeEs,
        cuota: parsed.odd_local,
        prob: poisson ? poisson.prob_home/100 : (eloProbs ? eloProbs.home : null) },
      { mercado: '1X2', seleccion: 'Empate',
        cuota: parsed.odd_empate,
        prob: poisson ? poisson.prob_draw/100 : (eloProbs ? eloProbs.draw : null) },
      { mercado: '1X2', seleccion: awayEs,
        cuota: parsed.odd_visitante,
        prob: poisson ? poisson.prob_away/100 : (eloProbs ? eloProbs.away : null) },
      { mercado: 'OVER/UNDER 2.5', seleccion: 'Over 2.5',
        cuota: parsed.over25_cuota || null,
        prob: poisson ? (poisson.over_2_5||poisson['over_2.5']||0)/100 : null },
      { mercado: 'BTTS', seleccion: 'Sí',
        cuota: parsed.btts_cuota || null,
        prob: poisson ? (poisson.prob_btts_si||poisson.btts_yes||0)/100 : null }
    ];

    mercados.forEach(m => {
      if (!m.cuota || m.cuota < 1.01 || !m.prob || m.prob <= 0 || m.prob >= 1) return;
      const ev_val = (m.prob * m.cuota) - 1;
      const kelly  = Math.max(0, Math.min(((m.prob * m.cuota - 1) / (m.cuota - 1)) / KELLY_DIVISOR, KELLY_MAX_FRACTION));

      newRows.push({
        fixture_id:   mkKey,
        timestamp:    now,
        fecha:        commence,
        local:        homeEs,
        visitante:    awayEs,
        mercado:      m.mercado,
        seleccion:    m.seleccion,
        cuota:        m.cuota,
        prob_modelo:  m.prob,
        ev:           ev_val,
        edge:         m.prob - 1/m.cuota,
        kelly:        kelly,
        ev_positivo:  ev_val > EV_POSITIVE_THRESHOLD,
        confianza:    confianza,
        fuente_modelo: fuente
      });
      totalOpps++;
    });
  });

  if (newRows.length) {
    const headers = ['fixture_id','timestamp','fecha','local','visitante','mercado','seleccion','cuota',
                     'prob_modelo','ev','edge','kelly','ev_positivo','confianza','fuente_modelo'];
    const rowArrays = newRows.map(r => headers.map(h => r[h] !== undefined ? r[h] : ''));
    appendRows_(CONFIG.SHEETS.EV_OPPORTUNITIES, rowArrays);
  }
  Logger.log(`✅ calcularEV completado: ${totalOpps} mercados calculados para ${oddsEvents.length} eventos.`);
}
