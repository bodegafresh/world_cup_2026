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

const EV_POSITIVE_THRESHOLD  = (typeof CONFIG !== 'undefined' && CONFIG.BETTING) ? CONFIG.BETTING.EV_POSITIVE_THRESHOLD : 0.05;
const EDGE_MIN_THRESHOLD     = (typeof CONFIG !== 'undefined' && CONFIG.BETTING) ? CONFIG.BETTING.EDGE_MIN_THRESHOLD : 0.03;
const KELLY_MAX_FRACTION     = (typeof CONFIG !== 'undefined' && CONFIG.BETTING) ? CONFIG.BETTING.KELLY_MAX_FRACTION : 0.025;
const KELLY_DIVISOR          = (typeof CONFIG !== 'undefined' && CONFIG.BETTING) ? CONFIG.BETTING.KELLY_DIVISOR : 4;
const EV_SUSPICIOUS_THRESHOLD = (typeof CONFIG !== 'undefined' && CONFIG.BETTING) ? CONFIG.BETTING.EV_SUSPICIOUS_THRESHOLD : 0.25;
const EV_OUTLIER_THRESHOLD   = (typeof CONFIG !== 'undefined' && CONFIG.BETTING) ? CONFIG.BETTING.EV_OUTLIER_THRESHOLD : 0.30;
const EV_MAX_CREDIBLE        = (typeof CONFIG !== 'undefined' && CONFIG.BETTING) ? CONFIG.BETTING.EV_MAX_CREDIBLE : 0.50;
const PROB_SUM_TOLERANCE     = (typeof CONFIG !== 'undefined' && CONFIG.BETTING) ? CONFIG.BETTING.PROB_SUM_TOLERANCE : 0.05;

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

  // 2. Probabilidades del modelo — prioridad: IA ajustada > Poisson > ELO
  let poisson   = null;
  let eloProbs  = null;
  let iaProbs   = null; // probabilidades ajustadas por IA (AnalisisIA fresco de hoy)

  // 2a. AnalisisIA: si hay análisis de hoy con fuente ia_ajustada, úsarlo como primario
  try {
    const today   = Utilities.formatDate(new Date(), CONFIG.TIMEZONE, 'yyyy-MM-dd');
    const aiRows  = readAll_(CONFIG.SHEETS.AI_ANALYSIS);
    const aiRow   = aiRows.find(r => {
      const updatedToday = String(r.updated_at || '').substring(0, 10) === today;
      const matchesHome  = teamNameMatches_(r.equipo_local    || '', home);
      const matchesAway  = teamNameMatches_(r.equipo_visitante|| '', away);
      return updatedToday && matchesHome && matchesAway;
    });
    if (aiRow && aiRow.prob_local && Number(aiRow.prob_local) > 0) {
      const pH = Number(aiRow.prob_local);
      const pD = Number(aiRow.prob_empate);
      const pA = Number(aiRow.prob_visitante);
      const s  = pH + pD + pA;
      if (s > 0.5 && s < 1.5) { // sanity check: suma razonable
        iaProbs = {
          home_win: pH / s,
          draw:     pD / s,
          away_win: pA / s,
          over_2_5: Number(aiRow.over_2_5) || null,
          btts_yes: Number(aiRow.btts)     || null,
          fuente:   String(aiRow.fuente    || 'ia_ajustada'),
          confianza: String(aiRow.confianza || 'media')
        };
      }
    }
  } catch (e_) { console.warn('EvModel IA probs:', e_.message); }

  // 2b. Poisson y ELO siempre se cargan como respaldo
  try { poisson = getPoissonOdds_(home, away); } catch (e_) {}
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
      const selN  = normT(sel);
      const hNorm = normT(teamNameToSpanish_(home));
      const aNorm = normT(teamNameToSpanish_(away));
      const isDraw = selN === 'draw' || selN === 'empate' || selN === 'x' || selN === 'tie';
      const isHome = !isDraw && (selN === 'home' || selN === '1' ||
                     selN.includes(hNorm) || hNorm.includes(selN) ||
                     normT(home).includes(selN) || selN.includes(normT(home)));
      const isAway = !isDraw && !isHome && (selN === 'away' || selN === '2' ||
                     selN.includes(aNorm) || aNorm.includes(selN) ||
                     normT(away).includes(selN) || selN.includes(normT(away)));

      const capP = (p, lo, hi) => Math.min(Math.max(p, lo), hi);

      // Prioridad: IA ajustada → Poisson → ELO
      if (iaProbs) {
        if (isHome) return capP(iaProbs.home_win, 0.04, 0.92);
        if (isAway) return capP(iaProbs.away_win, 0.04, 0.92);
        return capP(iaProbs.draw, 0.04, 0.60);
      }
      if (poisson) {
        let pH = capP(poisson.prob_home/100, 0.04, 0.92);
        let pD = capP(poisson.prob_draw/100, 0.04, 0.60);
        let pA = capP(poisson.prob_away/100, 0.04, 0.92);
        const s = pH + pD + pA; pH/=s; pD/=s; pA/=s;
        if (isHome) return pH;
        if (isAway) return pA;
        return pD;
      }
      if (eloProbs) {
        let pH = capP(eloProbs.home, 0.04, 0.92);
        let pD = capP(eloProbs.draw, 0.04, 0.60);
        let pA = capP(eloProbs.away, 0.04, 0.92);
        const s = pH + pD + pA; pH/=s; pD/=s; pA/=s;
        if (isHome) return pH;
        if (isAway) return pA;
        return pD;
      }
    }

    // Over/Under — IA tiene over_2_5, fallback Poisson
    if (mkt.includes('total') || mkt.includes('over') || mkt.includes('under')) {
      const lineMatch = mkt.match(/(\d+\.?\d*)/);
      const line = lineMatch ? parseFloat(lineMatch[1]) : 2.5;
      if (line === 2.5) {
        if (iaProbs && iaProbs.over_2_5) {
          return sel.includes('over') ? iaProbs.over_2_5 : (1 - iaProbs.over_2_5);
        }
      }
      if (!poisson) return null;
      const lineKey = line === 1.5 ? 'over_1_5' : line === 3.5 ? 'over_3_5' : 'over_2_5';
      if (sel.includes('over')) return (poisson[lineKey] || poisson.over_2_5) / 100;
      if (sel.includes('under')) return (poisson[`under_${lineKey.replace('over_','')}`] || poisson.under_2_5) / 100;
    }

    // BTTS — IA tiene btts_yes, fallback Poisson
    if (mkt.includes('btts') || mkt.includes('both teams')) {
      if (iaProbs && iaProbs.btts_yes) {
        return (sel === 'yes' || sel === 'si' || sel === 'ambos') ? iaProbs.btts_yes : (1 - iaProbs.btts_yes);
      }
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

    const metrics = bettingMetrics_(prob, cuota);
    const ev   = metrics.ev_pct;
    const edge = metrics.edge_pp;
    const kelly = Math.max(0, Math.min(metrics.kelly_25_pct, KELLY_MAX_FRACTION));

    // Confianza y fuente: IA ajustada > Poisson > ELO
    const fuenteModelo = iaProbs
      ? (iaProbs.fuente === 'ia_ajustada' ? 'IA_AJUSTADA' : ('IA_' + String(iaProbs.fuente).toUpperCase()))
      : (poisson ? 'POISSON' : (eloProbs ? 'ELO' : 'N/A'));
    const confianza = iaProbs
      ? (iaProbs.confianza === 'alta' ? 'ALTA' : iaProbs.confianza === 'baja' ? 'BAJA' : 'MEDIA')
      : (poisson ? (poisson.source === 'poisson_cache' ? 'ALTA' : 'MEDIA') : (eloProbs ? 'MEDIA' : 'BAJA'));

    opportunities.push({
      fixture_id:       fixtureId,
      equipo_local:     home,
      equipo_visitante: away,
      mercado:          String(row.mercado   || ''),
      seleccion:        String(row.seleccion || ''),
      cuota,
      prob_modelo:      prob,
      prob_implicita:   metrics.market_probability,
      cuota_justa:      metrics.fair_odds,
      overlay:          metrics.overlay_pct,
      kelly_full:       metrics.kelly_full_pct,
      kelly_25:         metrics.kelly_25_pct,
      kelly_50:         metrics.kelly_50_pct,
      ev,
      edge,
      kelly,
      confianza,
      fuente_modelo:    fuenteModelo,
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
    'fixture_id','local','visitante','fecha','timestamp',
    'mercado','seleccion','cuota','cuota_justa',
    'prob_modelo','ev','edge','kelly','ev_positivo',
    'confianza','fuente_modelo','sospechoso','outlier'
  ]);

  const rows = opportunities.map(o => {
    const cuotaJusta = o.cuota_justa ? Math.round(o.cuota_justa*100)/100 : '';
    const ev = Math.round(o.ev   * 10000) / 10000;
    const sospechoso = !o.outlier && ev > EV_SUSPICIOUS_THRESHOLD;
    const outlier    = ev > EV_OUTLIER_THRESHOLD;
    return [
      fixtureId,
      o.equipo_local    || fixture.teams.home.name,
      o.equipo_visitante|| fixture.teams.away.name,
      String(fixture.fixture.date || '').substring(0,10),
      nowChile_(),
      o.mercado,
      o.seleccion,
      o.cuota,
      cuotaJusta,
      o.prob_modelo,
      ev,
      Math.round(o.edge  * 10000) / 10000,
      Math.round(o.kelly * 10000) / 10000,
      o.es_positivo ? 'SI' : 'NO',
      o.confianza,
      o.fuente_modelo || '',
      sospechoso ? 'SI' : 'NO',
      outlier    ? 'SI' : 'NO'
    ];
  });

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
  let allRows;
  try {
    allRows = readAll_(CONFIG.SHEETS.EV_OPPORTUNITIES);
  } catch (e) {
    return '📊 Sin datos de EV. Ejecuta cronOddsCalc primero.';
  }

  // Deduplicar por partido+mercado+selección (mantener el más reciente)
  const dedupMap = {};
  allRows.forEach(r => {
    const k = `${r.local}|${r.visitante}|${r.mercado}|${r.seleccion}`;
    if (!dedupMap[k] || String(r.timestamp) > String(dedupMap[k].timestamp)) dedupMap[k] = r;
  });

  const isOutlier    = r => Number(r.ev||0) > EV_OUTLIER_THRESHOLD;
  const isSospechoso = r => Number(r.ev||0) > EV_SUSPICIOUS_THRESHOLD && !isOutlier(r);
  const isCreible    = r => {
    const evOk = Number(r.ev||0) > EV_POSITIVE_THRESHOLD && Number(r.ev||0) <= EV_SUSPICIOUS_THRESHOLD;
    const evPositivo = String(r.ev_positivo).toUpperCase() === 'TRUE' || r.ev_positivo === true || r.ev_positivo === 'SI';
    return evOk && evPositivo;
  };

  const rows       = Object.values(dedupMap).filter(isCreible).sort((a,b) => Number(b.ev||0)-Number(a.ev||0));
  const sospechosos = Object.values(dedupMap).filter(isSospechoso).sort((a,b) => Number(b.ev||0)-Number(a.ev||0));
  const outliers    = Object.values(dedupMap).filter(isOutlier).sort((a,b) => Number(b.ev||0)-Number(a.ev||0));

  if (!rows.length && !sospechosos.length && !outliers.length) {
    return '📊 Sin oportunidades EV+ detectadas para los próximos partidos.\n\n<i>Las cuotas de mercado no muestran valor estadístico en este momento.</i>';
  }

  const byFixture = {};
  rows.forEach(r => {
    const k = `${r.local}_vs_${r.visitante}`;
    if (!byFixture[k]) byFixture[k] = { local: r.local, visitante: r.visitante, fecha: r.fecha, timestamp: r.timestamp, rows: [] };
    byFixture[k].rows.push(r);
  });

  const ts = rows.length ? rows[0].timestamp : (sospechosos.length ? sospechosos[0].timestamp : (outliers.length ? outliers[0].timestamp : ''));
  let msg = `📊 <b>Oportunidades EV+ — Mundial 2026</b>\n`;
  msg    += `<i>Cuotas: ${ts || 'desconocido'}</i>\n\n`;

  // Tier 1: Creíbles +5%–25%
  if (rows.length) {
    msg += `<b>✅ Creíbles (EV +5% a +25%)</b>\n`;
    Object.values(byFixture).slice(0, 5).forEach(group => {
      msg += `\n⚽ <b>${group.local} vs ${group.visitante}</b>\n`;
      group.rows.slice(0, 3).forEach(o => {
        const evPct    = (Number(o.ev)    * 100).toFixed(1);
        const kellyPct = (Number(o.kelly) * 100).toFixed(1);
        const probPct  = (Number(o.prob_modelo) * 100).toFixed(1);
        const cjusta   = o.cuota_justa ? `Justa: ${Number(o.cuota_justa).toFixed(2)} · ` : '';
        const conf     = String(o.confianza || '');
        const confEmoji = conf === 'ALTA' ? '🟢' : conf === 'MEDIA' ? '🟡' : '🔴';
        msg += `  ✅ ${o.seleccion} @ ${Number(o.cuota).toFixed(2)}\n`;
        msg += `     Modelo: ${probPct}% | ${cjusta}EV <code>+${evPct}%</code> | Kelly <code>${kellyPct}%</code> ${confEmoji}\n`;
      });
    });
  }

  // Tier 2: Sospechosos +25%–30%
  if (sospechosos.length) {
    msg += `\n⚠️ <b>Sospechosos (EV +25% a +30%) — verificar en 2+ casas</b>\n`;
    sospechosos.slice(0, 3).forEach(o => {
      const evPct = (Number(o.ev) * 100).toFixed(1);
      const cjusta = o.cuota_justa ? ` · Justa: ${Number(o.cuota_justa).toFixed(2)}` : '';
      msg += `  • ${o.local} vs ${o.visitante} | ${o.seleccion} @ ${Number(o.cuota).toFixed(2)}${cjusta} — EV <code>+${evPct}%</code>\n`;
    });
  }

  // Tier 3: Outliers +30%–50%
  if (outliers.length) {
    msg += `\n🚨 <b>OUTLIERS (EV +30% a +50%) — NO apostar sin confirmación múltiple</b>\n`;
    outliers.slice(0, 2).forEach(o => {
      const evPct = (Number(o.ev) * 100).toFixed(1);
      msg += `  ⛔ ${o.local} vs ${o.visitante} | ${o.seleccion} @ ${Number(o.cuota).toFixed(2)} — EV <code>+${evPct}%</code>\n`;
    });
    msg += `<i>Posible mercado ilíquido, cuota stale o bug de mapeo.</i>\n`;
  }

  msg += `\n<i>EV >50% descartado automáticamente. Kelly máx 2.5% bankroll.</i>`;
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
                      'cuota_justa','prob_modelo','ev','edge','kelly','ev_positivo','confianza','fuente_modelo','sospechoso','outlier'];

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

  // Cargar AnalisisIA para usar como fuente primaria de probabilidades
  let aiRows = [];
  try { aiRows = readAll_(CONFIG.SHEETS.AI_ANALYSIS) || []; } catch(e_) {}

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

    // 0. AnalisisIA como fuente primaria (misma fuente que el panel de análisis)
    let iaProbs = null;
    const aiRow = aiRows.find(r => {
      const updatedToday = String(r.updated_at||'').substring(0,10) === today;
      return updatedToday && teamNameMatches_(r.equipo_local||'', homeEs) && teamNameMatches_(r.equipo_visitante||'', awayEs);
    });
    if (aiRow && Number(aiRow.prob_local) > 0) {
      const pH = Number(aiRow.prob_local), pD = Number(aiRow.prob_empate), pA = Number(aiRow.prob_visitante);
      const s = pH + pD + pA;
      if (s > 0.5 && s < 1.5) {
        iaProbs = { home_win: pH/s, draw: pD/s, away_win: pA/s,
                    over_2_5: Number(aiRow.prob_over25||0) || null,
                    btts_yes:  Number(aiRow.prob_btts||0)  || null };
        Logger.log(`🧠 calcularEV IA probs: ${homeEs} ${(iaProbs.home_win*100).toFixed(1)}% / ${(iaProbs.draw*100).toFixed(1)}% / ${(iaProbs.away_win*100).toFixed(1)}%`);
      }
    }

    // Obtener probabilidades del modelo (Poisson/ELO como fallback)
    let poisson = null;
    let eloProbs = null;
    let oddsInvertidas = false; // La API puede devolver el partido con equipos invertidos

    try { poisson = getPoissonOdds_(homeEn, awayEn); } catch(e_) {}
    if (!poisson) { try { poisson = getPoissonOdds_(homeEs, awayEs); } catch(e_) {} }
    // Intentar con equipos invertidos (API tiene away/home al revés)
    if (!poisson) {
      try { poisson = getPoissonOdds_(awayEn, homeEn); oddsInvertidas = !!poisson; } catch(e_) {}
    }
    if (!poisson) {
      try { poisson = getPoissonOdds_(awayEs, homeEs); oddsInvertidas = !!poisson; } catch(e_) {}
    }
    if (!poisson) {
      try { eloProbs = getEloProbabilities_(homeEn, awayEn); } catch(e_) {}
      if (!eloProbs) { try { eloProbs = getEloProbabilities_(awayEn, homeEn); oddsInvertidas = !!eloProbs; } catch(e_) {} }
    }
    if (!poisson && !eloProbs) {
      Logger.log(`⚠️  Sin modelo para ${homeEs} vs ${awayEs}`);
      return;
    }

    const parsed = parseOddsEventWithPinnacle_(ev);
    if (!parsed) return;

    // Si encontramos el modelo con equipos invertidos, invertir también las cuotas del mercado
    // para que local del modelo == local del mercado
    if (oddsInvertidas) {
      [parsed.odd_local, parsed.odd_visitante] = [parsed.odd_visitante, parsed.odd_local];
      [parsed.prob_local, parsed.prob_visitante] = [parsed.prob_visitante, parsed.prob_local];
      Logger.log(`🔄 Equipos invertidos detectados: ${homeEs} vs ${awayEs} — cuotas corregidas`);
    }

    // Determinar fuente y confianza (IA primero, luego Poisson/ELO)
    const fuente = iaProbs ? 'IA_AJUSTADA' : (poisson ? 'POISSON' : 'ELO');
    const confianza = iaProbs ? 'ALTA'
      : (poisson ? (poisson.source === 'poisson_cache' ? 'ALTA' : 'MEDIA') : 'MEDIA');

    const mkKey = `${normT(homeEs)}_vs_${normT(awayEs)}_${commence}`;

    // Cap de probabilidades: ningún resultado puede ser < 3% ni > 92% en fútbol real
    const capProb = (p, min, max) => p == null ? null : Math.min(Math.max(p, min), max);

    // IA probs como primaria; si no, Poisson; si no, ELO
    const rawHome = iaProbs ? iaProbs.home_win : (poisson ? poisson.prob_home/100 : (eloProbs ? eloProbs.home : null));
    const rawDraw = iaProbs ? iaProbs.draw      : (poisson ? poisson.prob_draw/100 : (eloProbs ? eloProbs.draw : null));
    const rawAway = iaProbs ? iaProbs.away_win  : (poisson ? poisson.prob_away/100 : (eloProbs ? eloProbs.away : null));

    // Aplicar cap y renormalizar para que sumen 1
    let cH = capProb(rawHome, 0.04, 0.92);
    let cD = capProb(rawDraw, 0.04, 0.60);
    let cA = capProb(rawAway, 0.04, 0.92);
    if (cH != null && cD != null && cA != null) {
      const s = cH + cD + cA;
      cH = cH/s; cD = cD/s; cA = cA/s;
    }

    // Prob over_2_5 y BTTS: IA primero, luego Poisson
    const pOver25 = iaProbs && iaProbs.over_2_5
      ? capProb(iaProbs.over_2_5, 0.05, 0.90)
      : (poisson ? capProb((poisson.over_2_5||poisson['over_2.5']||0)/100, 0.05, 0.90) : null);
    const pBtts = iaProbs && iaProbs.btts_yes
      ? capProb(iaProbs.btts_yes, 0.05, 0.90)
      : (poisson ? capProb((poisson.prob_btts_si||poisson.btts_yes||0)/100, 0.05, 0.90) : null);

    // Calcular EV para cada mercado disponible
    const mercados = [
      { mercado: '1X2', seleccion: homeEs,   cuota: parsed.odd_local,     prob: cH },
      { mercado: '1X2', seleccion: 'Empate', cuota: parsed.odd_empate,    prob: cD },
      { mercado: '1X2', seleccion: awayEs,   cuota: parsed.odd_visitante, prob: cA },
      { mercado: 'OVER/UNDER 2.5', seleccion: 'Over 2.5',
        cuota: parsed.over25_cuota || null,
        prob: pOver25 },
      { mercado: 'BTTS', seleccion: 'Sí',
        cuota: parsed.btts_cuota || null,
        prob: pBtts }
    ];

    // Validación 1X2: suma de probabilidades del modelo debe ser ~100%
    const probHome = cH || 0;
    const probDraw = cD || 0;
    const probAway = cA || 0;
    const probSum  = probHome + probDraw + probAway;
    const probSumOk = Math.abs(probSum - 1) <= PROB_SUM_TOLERANCE;
    if (!probSumOk) {
      Logger.log(`⚠️  ${homeEs} vs ${awayEs}: suma probs ${(probSum*100).toFixed(1)}% (esperado ~100%) — descartado`);
      return;
    }

    mercados.forEach(m => {
      if (!m.cuota || m.cuota < 1.01 || !m.prob || m.prob <= 0 || m.prob >= 1) return;
      const metrics = bettingMetrics_(m.prob, m.cuota);
      const ev_val = metrics.ev_pct;

      // Validación: descartar EV imposibles (bug de mapeo o cuota stale)
      if (ev_val > EV_MAX_CREDIBLE) {
        Logger.log(`🚫 ${homeEs} vs ${awayEs} ${m.seleccion}: EV ${(ev_val*100).toFixed(0)}% > ${EV_MAX_CREDIBLE*100}% — descartado`);
        return;
      }

      const kelly       = Math.max(0, Math.min(metrics.kelly_25_pct, KELLY_MAX_FRACTION));
      const sospechoso  = ev_val > EV_SUSPICIOUS_THRESHOLD;
      const esOutlier   = ev_val > EV_OUTLIER_THRESHOLD;
      const cuotaJusta  = metrics.fair_odds;
      const confFinal   = esOutlier ? 'PELIGRO' : (sospechoso ? 'BAJA' : confianza);

      newRows.push({
        fixture_id:    mkKey,
        timestamp:     now,
        fecha:         commence,
        local:         homeEs,
        visitante:     awayEs,
        mercado:       m.mercado,
        seleccion:     m.seleccion,
        cuota:         m.cuota,
        cuota_justa:   cuotaJusta,
        prob_modelo:   m.prob,
        ev:            ev_val,
        edge:          metrics.edge_pp,
        kelly:         kelly,
        ev_positivo:   ev_val > EV_POSITIVE_THRESHOLD && !sospechoso,
        confianza:     confFinal,
        fuente_modelo: fuente,
        sospechoso:    sospechoso,
        outlier:       esOutlier
      });
      totalOpps++;
    });
  });

  if (newRows.length) {
    const headers = ['fixture_id','timestamp','fecha','local','visitante','mercado','seleccion','cuota',
                     'cuota_justa','prob_modelo','ev','edge','kelly','ev_positivo','confianza','fuente_modelo','sospechoso','outlier'];
    const rowArrays = newRows.map(r => headers.map(h => r[h] !== undefined ? r[h] : ''));
    appendRows_(CONFIG.SHEETS.EV_OPPORTUNITIES, rowArrays);
  }
  try { snapshotEvRows_(newRows, today); } catch(e_) { Logger.log('snapshotEvRows_: ' + e_.message); }
  const sospechosos = newRows.filter(r => r.sospechoso && !r.outlier).length;
  const outliers    = newRows.filter(r => r.outlier).length;
  const descartados = newRows.filter(r => r.ev > EV_MAX_CREDIBLE).length;
  Logger.log(`✅ calcularEV: ${totalOpps} mercados | ${newRows.filter(r=>r.ev_positivo).length} EV+ válidos | ${sospechosos} sospechosos (>25%) | ${outliers} outliers (>30%) | descartados EV>${EV_MAX_CREDIBLE*100}%: ${descartados}`);
}
