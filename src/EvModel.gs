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

function getOfficialModelProbabilities_(homeTeam, awayTeam, matchKey) {
  const home = teamNameToSpanish_(homeTeam || '');
  const away = teamNameToSpanish_(awayTeam || '');
  const cap = (p, lo, hi) => Math.min(Math.max(Number(p), lo), hi);
  const withQuality = (model) => {
    if (!model) return null;
    const h = Number(model.prob_home || 0);
    const d = Number(model.prob_draw || 0);
    const a = Number(model.prob_away || 0);
    const lH = Number(model.lambda_h || 0);
    const lA = Number(model.lambda_a || 0);
    const source = String(model.source || '').toUpperCase();
    const reasons = [];

    if (![h, d, a].every(p => isFinite(p) && p > 0 && p < 1)) {
      reasons.push('INVALID_PROB');
    }

    // Patron típico de saturación generado por clamp: 92/4/4 o 4/4/92.
    if ((h >= 0.915 && d <= 0.045 && a <= 0.045) ||
        (a >= 0.915 && d <= 0.045 && h <= 0.045)) {
      reasons.push('SATURATED_92_4_4');
    }

    // Fallback neutro sospechoso: local y visita casi iguales, empate artificialmente favorito.
    if (Math.abs(h - a) <= 0.01 && d >= 0.34 && d > h && d > a) {
      reasons.push('DRAW_FAVORITE_SYMMETRIC_FALLBACK');
    }

    // Distribución casi neutra de Poisson: útil como placeholder, no como señal apostable.
    if (source === 'POISSON' && Math.abs(h - a) <= 0.015 && d >= 0.29 && d <= 0.36) {
      reasons.push('NEUTRAL_POISSON_FALLBACK');
    }

    // Lambdas de fútbol internacional de 90' con >5 goles esperados para un equipo son demasiado frágiles para EV.
    if (source === 'POISSON' && (lH >= 5 || lA >= 5)) {
      reasons.push('EXTREME_POISSON_LAMBDA');
    }

    // Si una fuente aparece como alta confianza pero es fallback/calculada, degradar y bloquear EV.
    const confidence = String(model.confidence || '').toUpperCase();
    if (confidence === 'ALTA' && /FALLBACK|CACHE|POISSON/.test(String(model.source || '').toUpperCase())) {
      model.confidence = 'BAJA';
      if (source !== 'POISSON') reasons.push('HIGH_CONFIDENCE_FALLBACK');
    }

    model.model_quality = reasons.length ? 'INVALID_MODEL' : 'OK';
    model.invalid_reasons = reasons.join('|');
    model.is_valid_model = reasons.length === 0;
    return model;
  };
  const normalize = (h, d, a) => {
    let pH = Number(h), pD = Number(d), pA = Number(a);
    if (![pH, pD, pA].every(p => isFinite(p) && p > 0)) return null;
    pH = cap(pH, 0.04, 0.92);
    pD = cap(pD, 0.04, 0.60);
    pA = cap(pA, 0.04, 0.92);
    const s = pH + pD + pA;
    if (!s || s < 0.5 || s > 1.5) return null;
    return { home: pH / s, draw: pD / s, away: pA / s };
  };

  let ai = null;
  try {
    const today = todayChile_();
    const aiRows = readAll_(CONFIG.SHEETS.AI_ANALYSIS);
    const row = aiRows.find(r => {
      const byFixture = matchKey && String(r.fixture_id || r.match_key || '') === String(matchKey);
      const byTeams = teamNameMatches_(r.equipo_local || '', home) &&
        teamNameMatches_(r.equipo_visitante || '', away);
      const fresh = !r.updated_at || String(r.updated_at || '').substring(0, 10) === today;
      return fresh && (byFixture || byTeams);
    });
    if (row && Number(row.prob_local) > 0) {
      const p = normalize(Number(row.prob_local), Number(row.prob_empate), Number(row.prob_visitante));
      if (p) ai = {
        prob_home: p.home,
        prob_draw: p.draw,
        prob_away: p.away,
        over25: Number(row.prob_over25 || row.over_2_5 || 0) || null,
        btts: Number(row.prob_btts || row.btts || 0) || null,
        source: String(row.fuente || 'IA_AJUSTADA').toUpperCase(),
        confidence: String(row.confianza || 'MEDIA').toUpperCase()
      };
    }
  } catch(e_) {}
  if (ai) return withQuality(ai);

  let poisson = null;
  try { poisson = getPoissonOdds_(homeTeam, awayTeam, matchKey); } catch(e_) {}
  if (!poisson) { try { poisson = getPoissonOdds_(home, away, matchKey); } catch(e_) {} }
  if (poisson) {
    const rawH = poisson.prob_home != null ? Number(poisson.prob_home) / 100 :
      (poisson.markets && poisson.markets['1'] != null ? Number(poisson.markets['1']) : null);
    const rawD = poisson.prob_draw != null ? Number(poisson.prob_draw) / 100 :
      (poisson.markets && poisson.markets['X'] != null ? Number(poisson.markets['X']) : null);
    const rawA = poisson.prob_away != null ? Number(poisson.prob_away) / 100 :
      (poisson.markets && poisson.markets['2'] != null ? Number(poisson.markets['2']) : null);
    const p = normalize(rawH, rawD, rawA);
    if (p) return withQuality({
      prob_home: p.home,
      prob_draw: p.draw,
      prob_away: p.away,
      over25: poisson.over_2_5 != null ? Number(poisson.over_2_5) / 100 :
        (poisson.markets && poisson.markets['over_2.5'] != null ? Number(poisson.markets['over_2.5']) : null),
      btts: poisson.prob_btts_si != null ? Number(poisson.prob_btts_si) / 100 :
        (poisson.markets && poisson.markets.btts_yes != null ? Number(poisson.markets.btts_yes) : null),
      lambda_h: Number(poisson.lambda_home || poisson.lambdaH || 0),
      lambda_a: Number(poisson.lambda_away || poisson.lambdaA || 0),
      source: 'POISSON',
      confidence: poisson.source === 'poisson_cache' ? 'ALTA' : 'MEDIA'
    });
  }

  let elo = null;
  try { elo = getEloProbabilities_(homeTeam, awayTeam); } catch(e_) {}
  if (!elo) { try { elo = getEloProbabilities_(home, away); } catch(e_) {} }
  if (elo) {
    const p = normalize(elo.home_win || elo.home, elo.draw, elo.away_win || elo.away);
    if (p) return withQuality({
      prob_home: p.home,
      prob_draw: p.draw,
      prob_away: p.away,
      source: 'ELO',
      confidence: 'MEDIA',
      elo_home: Number(elo.elo_home || 0),
      elo_away: Number(elo.elo_away || 0)
    });
  }

  return null;
}

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

  const official = getOfficialModelProbabilities_(home, away, fixtureId);
  if (!official) return [];
  if (official.is_valid_model === false) {
    Logger.log(`🚫 ${home} vs ${away}: modelo inválido para EV (${official.invalid_reasons || 'INVALID_MODEL'})`);
    return [];
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

      if (isHome) return official.prob_home;
      if (isAway) return official.prob_away;
      return official.prob_draw;
    }

    // Over/Under — IA tiene over_2_5, fallback Poisson
    if (mkt.includes('total') || mkt.includes('over') || mkt.includes('under')) {
      const lineMatch = mkt.match(/(\d+\.?\d*)/);
      const line = lineMatch ? parseFloat(lineMatch[1]) : 2.5;
      if (line === 2.5) {
        if (official.over25) {
          return sel.includes('over') ? official.over25 : (1 - official.over25);
        }
      }
      return null;
    }

    // BTTS — IA tiene btts_yes, fallback Poisson
    if (mkt.includes('btts') || mkt.includes('both teams')) {
      if (official.btts) {
        return (sel === 'yes' || sel === 'si' || sel === 'ambos') ? official.btts : (1 - official.btts);
      }
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
    const fuenteModelo = official.source || 'N/A';
    const confianza = official.confidence || 'MEDIA';

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

  let totalOpps = 0;
  const now = nowChile_();
  const newRows = [];

  oddsEvents.forEach(ev => {
    const homeEn = ev.home_team || '';
    const awayEn = ev.away_team || '';
    const homeEs = teamNameToSpanish_(homeEn);
    const awayEs = teamNameToSpanish_(awayEn);

    // Solo bloque operativo de hoy: hoy Chile + partidos 00:00 Chile del día siguiente.
    const commenceChileDate = oddsCommenceDateChile_(ev.commence_time);
    const commenceChileTime = oddsCommenceTimeChile_(ev.commence_time);
    const isTodayBlock = commenceChileDate === today ||
      (commenceChileDate === tomorrow && commenceChileTime === '00:00');
    if (!isTodayBlock) return;
    if (new Date(ev.commence_time).getTime() <= Date.now()) {
      Logger.log(`⏱️  ${homeEs} vs ${awayEs}: partido ya iniciado/cerrado — EV omitido`);
      return;
    }

    let oddsInvertidas = false; // La API puede devolver el partido con equipos invertidos

    let official = getOfficialModelProbabilities_(homeEs, awayEs);
    if (!official) official = getOfficialModelProbabilities_(homeEn, awayEn);
    if (!official) {
      const inverted = getOfficialModelProbabilities_(awayEs, homeEs) || getOfficialModelProbabilities_(awayEn, homeEn);
      if (inverted) {
        oddsInvertidas = true;
        official = {
          prob_home: inverted.prob_away,
          prob_draw: inverted.prob_draw,
          prob_away: inverted.prob_home,
          over25: inverted.over25,
          btts: inverted.btts,
          source: inverted.source,
          confidence: inverted.confidence,
          lambda_h: inverted.lambda_a,
          lambda_a: inverted.lambda_h,
          model_quality: inverted.model_quality,
          invalid_reasons: inverted.invalid_reasons,
          is_valid_model: inverted.is_valid_model
        };
      }
    }
    if (!official) {
      Logger.log(`⚠️  Sin modelo para ${homeEs} vs ${awayEs}`);
      return;
    }
    if (official.is_valid_model === false) {
      Logger.log(`🚫 ${homeEs} vs ${awayEs}: EV bloqueado por modelo inválido (${official.invalid_reasons || 'INVALID_MODEL'})`);
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

    const fuente = official.source || 'N/A';
    const confianza = official.confidence || 'MEDIA';

    const mkKey = `${normT(homeEs)}_vs_${normT(awayEs)}_${commenceChileDate}`;

    const cH = official.prob_home;
    const cD = official.prob_draw;
    const cA = official.prob_away;
    const pOver25 = official.over25;
    const pBtts = official.btts;

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
        fecha:         commenceChileDate,
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

function oddsCommenceDateChile_(commenceTime) {
  try {
    return Utilities.formatDate(new Date(commenceTime), CONFIG.TIMEZONE, 'yyyy-MM-dd');
  } catch (e) {
    return String(commenceTime || '').substring(0, 10);
  }
}

function oddsCommenceTimeChile_(commenceTime) {
  try {
    return Utilities.formatDate(new Date(commenceTime), CONFIG.TIMEZONE, 'HH:mm');
  } catch (e) {
    return '';
  }
}

/**
 * Auditoría manual: detecta patrones repetidos o saturados en el modelo oficial
 * para los próximos partidos. No consume APIs; lee Partidos/PoissonOdds/AnalisisIA.
 */
function auditOfficialModelPatterns() {
  const today = todayChile_();
  const rows = readAll_('Partidos')
    .filter(r => normalizeFecha_(r.fecha) >= today)
    .filter(r => !['FT','AET','PEN'].includes(String(r.status || '').toUpperCase()));

  const byPattern = {};
  const issues = [];

  rows.forEach(r => {
    const home = r.local || '';
    const away = r.visitante || '';
    const official = getOfficialModelProbabilities_(home, away, r.match_key || r.fixture_id_api_football || '');
    if (!official) {
      issues.push([normalizeFecha_(r.fecha), home, away, 'NO_MODEL', '', '', '']);
      return;
    }

    const pattern = [
      Math.round(Number(official.prob_home || 0) * 1000),
      Math.round(Number(official.prob_draw || 0) * 1000),
      Math.round(Number(official.prob_away || 0) * 1000),
      Number(official.lambda_h || 0).toFixed(2),
      Number(official.lambda_a || 0).toFixed(2)
    ].join('/');

    if (!byPattern[pattern]) byPattern[pattern] = [];
    byPattern[pattern].push(`${home} vs ${away}`);

    if (official.is_valid_model === false) {
      issues.push([
        normalizeFecha_(r.fecha),
        home,
        away,
        official.model_quality || 'INVALID_MODEL',
        official.invalid_reasons || '',
        `${(official.prob_home * 100).toFixed(1)}/${(official.prob_draw * 100).toFixed(1)}/${(official.prob_away * 100).toFixed(1)}`,
        `${Number(official.lambda_h || 0).toFixed(2)}-${Number(official.lambda_a || 0).toFixed(2)}`
      ]);
    }
  });

  Object.keys(byPattern).forEach(pattern => {
    if (byPattern[pattern].length < 2) return;
    issues.push(['', '', '', 'REPEATED_MODEL_PATTERN', pattern, byPattern[pattern].join(' | '), '']);
  });

  Logger.log('auditOfficialModelPatterns: ' + issues.length + ' hallazgos');
  issues.forEach(i => Logger.log(i.join(' | ')));
  return issues;
}

function isEvRowForClosedMatch_(evRow, partidos) {
  const finalStatuses = ['FT','AET','PEN','CANC','PST','ABD'];
  const liveStatuses = ['1H','2H','HT','ET','BT','P','LIVE'];
  const fecha = normalizeFecha_(evRow.fecha || evRow.date || '');
  const today = todayChile_();
  const local = normalizeTeamNameStrong_(teamNameToSpanish_(evRow.local || evRow.home_team || ''));
  const visitante = normalizeTeamNameStrong_(teamNameToSpanish_(evRow.visitante || evRow.away_team || ''));

  if (!fecha || fecha < today) return true;

  const match = partidos.find(function(p) {
    const pf = normalizeFecha_(p.fecha || p.fecha_chile || '');
    if (pf !== fecha) return false;
    const pl = normalizeTeamNameStrong_(teamNameToSpanish_(p.local || ''));
    const pv = normalizeTeamNameStrong_(teamNameToSpanish_(p.visitante || ''));
    return (pl === local && pv === visitante) || (pl === visitante && pv === local);
  });

  if (!match) return false;
  const status = String(match.status || match.estado || '').toUpperCase();
  if (finalStatuses.indexOf(status) !== -1 || liveStatuses.indexOf(status) !== -1) return true;
  if (match.goles_local !== '' && match.goles_local !== null && match.goles_local !== undefined &&
      match.goles_visitante !== '' && match.goles_visitante !== null && match.goles_visitante !== undefined) {
    return true;
  }

  const hora = typeof safeHoraChile_ === 'function' ? safeHoraChile_(match.hora_chile || match.hora) : '';
  if (fecha === today && hora) {
    const nowTime = nowChile_().substring(11, 16);
    if (hora <= nowTime) return true;
  }
  return false;
}

/**
 * Limpia EvOpportunities eliminando filas de partidos cerrados, en vivo o ya iniciados.
 * No toca AnalisisIA ni modelos históricos; solo quita oportunidades que ya no son apostables.
 */
function cleanupClosedEvOpportunities() {
  const ss = SpreadsheetApp.openById(getSpreadsheetId_());
  const sheet = ss.getSheetByName(CONFIG.SHEETS.EV_OPPORTUNITIES);
  if (!sheet) {
    Logger.log('cleanupClosedEvOpportunities: hoja EvOpportunities no existe');
    return { deleted: 0 };
  }

  const values = sheet.getDataRange().getValues();
  if (values.length <= 1) return { deleted: 0 };

  const headers = values[0].map(String);
  const idx = {};
  headers.forEach((h, i) => idx[h] = i);
  const partidos = readAll_(CONFIG.SHEETS.PARTIDOS);
  const rowsToDelete = [];
  const rowsToArchive = [];

  for (let i = 1; i < values.length; i++) {
    const obj = {};
    headers.forEach((h, c) => obj[h] = values[i][c]);
    if (isEvRowForClosedMatch_(obj, partidos)) {
      rowsToDelete.push(i + 1);
      rowsToArchive.push(obj);
    }
  }

  if (rowsToArchive.length && typeof snapshotEvRows_ === 'function') {
    try {
      snapshotEvRows_(rowsToArchive, todayChile_());
      Logger.log('cleanupClosedEvOpportunities: archivadas ' + rowsToArchive.length + ' fila(s) en EvHistorico');
    } catch(e) {
      Logger.log('cleanupClosedEvOpportunities: no se pudo archivar en EvHistorico: ' + e.message);
      throw e;
    }
  }

  rowsToDelete.reverse().forEach(rowNum => sheet.deleteRow(rowNum));
  Logger.log('cleanupClosedEvOpportunities: eliminadas ' + rowsToDelete.length + ' fila(s)');
  return { deleted: rowsToDelete.length, archived: rowsToArchive.length };
}
