/**
 * PoissonModel.gs
 *
 * Modelo Poisson bivariado con corrección Dixon-Coles.
 *
 * A partir de los resultados reales del torneo en curso calcula:
 *   - Fuerza atacante y defensiva de cada equipo
 *   - Distribución conjunta P(goles_home = i, goles_away = j)
 *   - Probabilidades derivadas para TODOS los mercados de apuestas
 *
 * Sin APIs externas. Solo matemática sobre los datos ya en la hoja Partidos.
 *
 * Mercados soportados:
 *   1X2, Double Chance, Over/Under (cualquier línea), BTTS,
 *   Asian Handicap (cualquier línea), Resultado exacto
 *
 * Flujo de uso:
 *   1. buildPoissonStrengths_()  →  fuerza de cada equipo
 *   2. predictMatch_(home, away) →  matriz de probabilidades
 *   3. deriveMarkets_(matrix)    →  objeto con todos los mercados
 *   4. savePoissonOdds_(fixture) →  guarda en PoissonOdds sheet
 */

// ─── Parámetros del modelo ────────────────────────────────────────────────────

const POISSON_HOME_ADV   = 1.15;   // ventaja de local (histórico mundiales)
const POISSON_MAX_GOALS  = 8;      // goles máximos a considerar por lado
const POISSON_MIN_GAMES  = 1;      // partidos mínimos para incluir equipo en modelo
const POISSON_ELO_BLEND  = 0.4;    // peso del ELO cuando hay pocos partidos (0=solo Poisson, 1=solo ELO)

// Corrección Dixon-Coles para resultados bajos (sobre/sub representados en fútbol)
const DC_RHO = -0.13;

// ─── Función de distribución Poisson ─────────────────────────────────────────

function poissonPmf_(lambda, k) {
  if (k < 0 || lambda <= 0) return 0;
  let logP = -lambda + k * Math.log(lambda);
  for (let i = 1; i <= k; i++) logP -= Math.log(i);
  return Math.exp(logP);
}

// Corrección Dixon-Coles τ(i,j,λh,λa,ρ)
function dcCorrection_(i, j, lh, la, rho) {
  if (i === 0 && j === 0) return 1 - lh * la * rho;
  if (i === 1 && j === 0) return 1 + la * rho;
  if (i === 0 && j === 1) return 1 + lh * rho;
  if (i === 1 && j === 1) return 1 - rho;
  return 1;
}

// ─── Construcción del modelo: fuerza por equipo ───────────────────────────────

/**
 * Lee todos los partidos FT del torneo y calcula los parámetros del modelo:
 *   mu (media de goles), fuerza atacante y defensiva por equipo.
 *
 * Retorna un objeto { mu, ataque: {equipo: coef}, defensa: {equipo: coef} }
 * listo para alimentar predictMatch_.
 *
 * Se puede llamar cada vez que se necesite (es rápido: solo lee la Sheet).
 */
function buildPoissonStrengths_() {
  const partidos = readAll_(CONFIG.SHEETS.PARTIDOS)
    .filter(r => String(r.status || '').toUpperCase() === 'FT')
    .filter(r => r.goles_local !== '' && r.goles_visitante !== '');

  if (partidos.length === 0) return null;

  // Suma de goles y partidos por equipo (local y visitante por separado)
  const data = {};
  const ensure = (eq) => {
    if (!data[eq]) data[eq] = { gfH: 0, gcH: 0, pjH: 0, gfA: 0, gcA: 0, pjA: 0 };
  };

  let totalGoals = 0, totalGames = 0;

  partidos.forEach(r => {
    const h  = teamNameToSpanish_(r.local      || '');
    const a  = teamNameToSpanish_(r.visitante  || '');
    const gh = parseInt(r.goles_local     || 0, 10);
    const ga = parseInt(r.goles_visitante || 0, 10);
    if (isNaN(gh) || isNaN(ga)) return;

    ensure(h); ensure(a);
    data[h].gfH += gh; data[h].gcH += ga; data[h].pjH++;
    data[a].gfA += ga; data[a].gcA += gh; data[a].pjA++;
    totalGoals += gh + ga;
    totalGames++;
  });

  const mu = totalGames > 0 ? totalGoals / (2 * totalGames) : 1.3; // fallback histórico mundiales

  // Iteración: estimar fuerza atacante/defensiva (método de máxima verosimilitud simplificado)
  // Con pocos partidos (WC) 2 iteraciones son suficientes
  const teams = Object.keys(data);
  const atkR  = {}, defR = {}; // ratio vs media
  teams.forEach(eq => {
    const d = data[eq];
    const pj = d.pjH + d.pjA;
    if (pj < POISSON_MIN_GAMES) { atkR[eq] = 1; defR[eq] = 1; return; }
    const gfRate = (d.gfH + d.gfA) / pj;
    const gcRate = (d.gcH + d.gcA) / pj;
    atkR[eq] = gfRate / mu;
    defR[eq] = gcRate / mu;
  });

  // Normalizar para que la media de los ratios sea 1
  const normalize = (obj) => {
    const vals = Object.values(obj);
    const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
    const out  = {};
    Object.keys(obj).forEach(k => out[k] = obj[k] / mean);
    return out;
  };

  return {
    mu,
    ataque:  normalize(atkR),
    defensa: normalize(defR),
    equipos: teams,
    partidos: partidos.length
  };
}

// ─── Predicción de partido ────────────────────────────────────────────────────

/**
 * Calcula la matriz de probabilidades P(i,j) para un partido.
 *
 * @param {string} homeTeam
 * @param {string} awayTeam
 * @param {Object} [strengths]  resultado de buildPoissonStrengths_(); si null, lo construye
 * @returns {{ matrix: number[][], lambdaH: number, lambdaA: number, strengths: Object }}
 */
function predictMatch_(homeTeam, awayTeam, strengths) {
  if (!strengths) strengths = buildPoissonStrengths_();

  const home = teamNameToSpanish_(homeTeam);
  const away = teamNameToSpanish_(awayTeam);

  const mu = strengths ? strengths.mu : 1.3;
  const atkH = (strengths && strengths.ataque[home])  || 1;
  const defH = (strengths && strengths.defensa[home]) || 1;
  const atkA = (strengths && strengths.ataque[away])  || 1;
  const defA = (strengths && strengths.defensa[away]) || 1;

  const lambdaH = mu * atkH * defA * POISSON_HOME_ADV;
  const lambdaA = mu * atkA * defH;

  // Blend con ELO cuando hay pocos datos
  const eloBlend = _getEloPoissonBlend_(home, away, strengths, lambdaH, lambdaA);
  const lH = eloBlend.lH;
  const lA = eloBlend.lA;

  // Construir matriz N×N con corrección Dixon-Coles
  const N = POISSON_MAX_GOALS + 1;
  const matrix = [];
  let total = 0;

  for (let i = 0; i < N; i++) {
    matrix[i] = [];
    for (let j = 0; j < N; j++) {
      const p = poissonPmf_(lH, i) * poissonPmf_(lA, j) * dcCorrection_(i, j, lH, lA, DC_RHO);
      matrix[i][j] = Math.max(0, p);
      total += matrix[i][j];
    }
  }

  // Renormalizar para que sumen 1
  if (total > 0) {
    for (let i = 0; i < N; i++)
      for (let j = 0; j < N; j++)
        matrix[i][j] /= total;
  }

  return { matrix, lambdaH: lH, lambdaA: lA, strengths };
}

/**
 * Cuando el equipo tiene pocos partidos, blendea con ELO.
 * Con 0 partidos → 100% ELO. Con 3+ partidos → 100% Poisson.
 */
function _getEloPoissonBlend_(home, away, strengths, lH, lA) {
  const pjH = _teamGamesPlayed_(home, strengths);
  const pjA = _teamGamesPlayed_(away, strengths);
  const minPj = Math.min(pjH, pjA);
  // Peso ELO decrece linealmente: 3 partidos = 0 peso ELO
  const eloWeight = Math.max(0, POISSON_ELO_BLEND * (1 - minPj / 3));

  if (eloWeight === 0) return { lH, lA };

  // Obtener λ implícitas desde ELO si existe EloRating.gs
  try {
    const eloProbs = getEloProbabilities_(home, away);
    if (eloProbs && eloProbs.home > 0) {
      // Invertir prob ELO a λ usando que P(home > away) ≈ Σ P(H>A)
      // Aproximación: λ_elo via P(draw) ≈ P(Poisson match) con λ ajustado
      // En la práctica, ajustamos la media manteniendo la relación λH/λA
      const eloRatio = eloProbs.home / Math.max(eloProbs.away, 0.01);
      const mu = (lH + lA) / 2;
      const eloLH = mu * Math.sqrt(eloRatio);
      const eloLA = mu / Math.sqrt(eloRatio);
      return {
        lH: lH * (1 - eloWeight) + eloLH * eloWeight,
        lA: lA * (1 - eloWeight) + eloLA * eloWeight
      };
    }
  } catch (e_) {}

  return { lH, lA };
}

function _teamGamesPlayed_(teamName, strengths) {
  if (!strengths) return 0;
  const d = (strengths.ataque || {})[teamName];
  return d ? 2 : 0; // si tiene dato, asumimos al menos 2 partidos (simplificado)
}

// ─── Derivación de mercados ───────────────────────────────────────────────────

/**
 * Deriva todas las probabilidades de apuestas desde la matriz Poisson.
 *
 * @param {number[][]} matrix  — resultado de predictMatch_().matrix
 * @param {number} lambdaH
 * @param {number} lambdaA
 * @returns {PoissonMarkets}
 */
function deriveMarkets_(matrix, lambdaH, lambdaA) {
  const N = matrix.length;
  let pH = 0, pD = 0, pA = 0;
  let btts = 0;
  const totals = {}; // { '0.5': {over, under}, ... }
  const scores = {}; // { '0-0': prob, ... }
  const ah     = {}; // { '-0.5': {home, away}, ... }

  // Líneas Over/Under estándar
  [0.5, 1.5, 2.5, 3.5, 4.5].forEach(line => {
    totals[line] = { over: 0, under: 0 };
  });

  // Líneas Asian Handicap
  [-2.5, -2, -1.5, -1, -0.5, 0, 0.5, 1, 1.5, 2, 2.5].forEach(line => {
    ah[line] = { home: 0, away: 0, push: 0 };
  });

  for (let i = 0; i < N; i++) {
    for (let j = 0; j < N; j++) {
      const p = matrix[i][j];
      if (p < 1e-10) continue;

      // 1X2
      if (i > j) pH += p;
      else if (i === j) pD += p;
      else pA += p;

      // BTTS
      if (i > 0 && j > 0) btts += p;

      // Over/Under
      const goles = i + j;
      Object.keys(totals).forEach(line => {
        const l = parseFloat(line);
        if (goles > l) totals[line].over += p;
        else           totals[line].under += p;
      });

      // Marcador exacto (top 15 más probables)
      const key = `${i}-${j}`;
      scores[key] = (scores[key] || 0) + p;

      // Asian Handicap: home gana por diff = i - j
      // AH line k: bet on home wins si i-j > k (si k es entero, empate → push)
      const diff = i - j;
      Object.keys(ah).forEach(lineStr => {
        const line = parseFloat(lineStr);
        if (diff > line) ah[lineStr].home += p;
        else if (diff < line) ah[lineStr].away += p;
        else ah[lineStr].push += p; // solo pasa en líneas enteras
      });
    }
  }

  // Ordenar marcadores por probabilidad
  const topScores = Object.entries(scores)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 15)
    .map(([score, prob]) => ({ score, prob: Math.round(prob * 1000) / 10 }));

  // Double chance
  const dc1X = pH + pD;
  const dcX2 = pD + pA;
  const dc12 = pH + pA;

  // Cuotas justas (1/prob, sin margen)
  const fair = (p) => p > 0.001 ? Math.round((1 / p) * 100) / 100 : null;

  return {
    // Match result
    prob_home:     Math.round(pH * 10000) / 100,
    prob_draw:     Math.round(pD * 10000) / 100,
    prob_away:     Math.round(pA * 10000) / 100,
    cuota_fair_h:  fair(pH),
    cuota_fair_d:  fair(pD),
    cuota_fair_a:  fair(pA),

    // Double chance
    dc_1X:  Math.round(dc1X * 10000) / 100,
    dc_X2:  Math.round(dcX2 * 10000) / 100,
    dc_12:  Math.round(dc12 * 10000) / 100,

    // BTTS
    prob_btts_si:  Math.round(btts * 10000) / 100,
    prob_btts_no:  Math.round((1 - btts) * 10000) / 100,

    // Over/Under (todas las líneas)
    totals: Object.fromEntries(
      Object.entries(totals).map(([line, v]) => [line, {
        over:  Math.round(v.over  * 10000) / 100,
        under: Math.round(v.under * 10000) / 100,
        cuota_over:  fair(v.over),
        cuota_under: fair(v.under)
      }])
    ),

    // Asian Handicap
    asian_handicap: Object.fromEntries(
      Object.entries(ah).map(([line, v]) => [line, {
        home:  Math.round(v.home  * 10000) / 100,
        away:  Math.round(v.away  * 10000) / 100,
        push:  Math.round(v.push  * 10000) / 100,
        cuota_home: fair(v.home),
        cuota_away: fair(v.away)
      }])
    ),

    // Marcadores exactos
    top_scores: topScores,

    // Medias del modelo
    lambda_home:  Math.round(lambdaH * 100) / 100,
    lambda_away:  Math.round(lambdaA * 100) / 100,
    goles_esperados: Math.round((lambdaH + lambdaA) * 100) / 100
  };
}

// ─── Punto de entrada principal ───────────────────────────────────────────────

/**
 * Calcula y retorna todos los mercados para un partido.
 *
 * @param {string} homeTeam
 * @param {string} awayTeam
 * @param {Object} [strengths]  pasar si ya lo construiste para ahorrar tiempo
 * @returns {PoissonMarkets}
 */
function poissonPredictMarkets_(homeTeam, awayTeam, strengths) {
  if (!strengths) strengths = buildPoissonStrengths_();
  const { matrix, lambdaH, lambdaA } = predictMatch_(homeTeam, awayTeam, strengths);
  return deriveMarkets_(matrix, lambdaH, lambdaA);
}

// ─── Guardado en hoja PoissonOdds ────────────────────────────────────────────

/**
 * Calcula y guarda las probabilidades Poisson para un fixture.
 * Upsert por match_key.
 *
 * @param {Object} fixture  row de la hoja Partidos
 * @param {Object} [strengths]
 */
function savePoissonOdds_(fixture, strengths) {
  const home = fixture.local     || fixture.homeTeam || '';
  const away = fixture.visitante || fixture.awayTeam || '';
  if (!home || !away) return;

  const markets = poissonPredictMarkets_(home, away, strengths);
  const matchKey = fixture.match_key || `${normalizeFecha_(fixture.fecha)}_${norm_(home)}_${norm_(away)}`;

  const row = [
    matchKey,
    normalizeFecha_(fixture.fecha),
    teamNameToSpanish_(home),
    teamNameToSpanish_(away),
    markets.prob_home,
    markets.prob_draw,
    markets.prob_away,
    markets.cuota_fair_h,
    markets.cuota_fair_d,
    markets.cuota_fair_a,
    markets.dc_1X,
    markets.dc_X2,
    markets.dc_12,
    markets.prob_btts_si,
    markets.prob_btts_no,
    (markets.totals['2.5'] || {}).over,
    (markets.totals['2.5'] || {}).under,
    (markets.totals['1.5'] || {}).over,
    (markets.totals['3.5'] || {}).over,
    (markets.asian_handicap['-0.5'] || {}).home,
    (markets.asian_handicap['-0.5'] || {}).away,
    (markets.asian_handicap['-1.5'] || {}).home,
    (markets.asian_handicap['-1.5'] || {}).away,
    (markets.asian_handicap['0.5']  || {}).home,
    (markets.asian_handicap['0.5']  || {}).away,
    markets.lambda_home,
    markets.lambda_away,
    markets.goles_esperados,
    (markets.top_scores[0] || {}).score,
    (markets.top_scores[0] || {}).prob,
    JSON.stringify(markets.top_scores.slice(0, 10)),
    nowChile_()
  ];

  const sheetName = 'PoissonOdds';
  const headers = [
    'match_key','fecha','local','visitante',
    'prob_home','prob_draw','prob_away',
    'cuota_fair_h','cuota_fair_d','cuota_fair_a',
    'dc_1X','dc_X2','dc_12',
    'prob_btts_si','prob_btts_no',
    'over_2_5','under_2_5','over_1_5','over_3_5',
    'ah_home_minus05','ah_away_minus05',
    'ah_home_minus15','ah_away_minus15',
    'ah_home_plus05','ah_away_plus05',
    'lambda_home','lambda_away','goles_esperados',
    'score_probable','score_prob_pct','top_scores_json',
    'updated_at'
  ];

  const sheet  = getOrCreateSheet_(sheetName, headers);
  const values = sheet.getDataRange().getValues();
  const mkIdx  = values[0].indexOf('match_key');
  const existing = values.slice(1).findIndex(r => r[mkIdx] === matchKey);

  if (existing >= 0) {
    sheet.getRange(existing + 2, 1, 1, row.length).setValues([row]);
  } else {
    sheet.appendRow(row);
  }
}

/**
 * Recalcula PoissonOdds para todos los partidos pendientes (status ≠ FT).
 * Llamar desde cronDailySetup o manualmente.
 */
function recalcularPoissonOdds() {
  const strengths = buildPoissonStrengths_();
  if (!strengths || strengths.partidos < 2) {
    Logger.log('recalcularPoissonOdds: pocos partidos para calibrar el modelo (' + (strengths ? strengths.partidos : 0) + ')');
    return;
  }

  Logger.log(`recalcularPoissonOdds: modelo calibrado con ${strengths.partidos} partidos, μ=${strengths.mu.toFixed(3)}`);

  const todos = readAll_(CONFIG.SHEETS.PARTIDOS)
    .filter(r => String(r.status || '').toUpperCase() !== 'FT');

  todos.forEach(r => {
    try {
      savePoissonOdds_(r, strengths);
    } catch (e) {
      console.warn(`savePoissonOdds_ ${r.match_key}:`, e.message);
    }
    Utilities.sleep(50);
  });

  Logger.log(`recalcularPoissonOdds: ${todos.length} partidos calculados`);
}

// ─── Integración con EV ───────────────────────────────────────────────────────

/**
 * Retorna las probabilidades Poisson para un partido dado su match_key.
 * Usa la hoja PoissonOdds como cache; recalcula si no existe.
 *
 * @param {string} homeTeam
 * @param {string} awayTeam
 * @param {string} [matchKey]
 * @returns {Object}  mercados con prob_home/draw/away, totals, btts, ah
 */
function getPoissonOdds_(homeTeam, awayTeam, matchKey) {
  // 1. Buscar en PoissonOdds
  try {
    const rows = readAll_('PoissonOdds');
    const normN = s => String(s||'').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g,'').replace(/[^a-z]/g,'');
    const qH = normN(homeTeam), qA = normN(awayTeam);
    const row = rows.find(r => {
      if (matchKey && r.match_key === matchKey) return true;
      return normN(r.local||'').includes(qH) && normN(r.visitante||'').includes(qA);
    });
    if (row && row.prob_home) {
      return {
        prob_home: parseFloat(row.prob_home),
        prob_draw: parseFloat(row.prob_draw),
        prob_away: parseFloat(row.prob_away),
        over_2_5:  parseFloat(row.over_2_5),
        under_2_5: parseFloat(row.under_2_5),
        over_1_5:  parseFloat(row.over_1_5),
        prob_btts_si: parseFloat(row.prob_btts_si),
        prob_btts_no: parseFloat(row.prob_btts_no),
        lambda_home: parseFloat(row.lambda_home),
        lambda_away: parseFloat(row.lambda_away),
        goles_esperados: parseFloat(row.goles_esperados),
        score_probable: row.score_probable,
        source: 'poisson_cache'
      };
    }
  } catch (e_) {}

  // 2. Calcular en tiempo real si no existe
  try {
    const markets = poissonPredictMarkets_(homeTeam, awayTeam);
    return {
      prob_home:    markets.prob_home,
      prob_draw:    markets.prob_draw,
      prob_away:    markets.prob_away,
      over_2_5:     (markets.totals['2.5'] || {}).over,
      under_2_5:    (markets.totals['2.5'] || {}).under,
      over_1_5:     (markets.totals['1.5'] || {}).over,
      prob_btts_si: markets.prob_btts_si,
      prob_btts_no: markets.prob_btts_no,
      lambda_home:  markets.lambda_home,
      lambda_away:  markets.lambda_away,
      goles_esperados: markets.goles_esperados,
      score_probable: (markets.top_scores[0] || {}).score,
      source: 'poisson_realtime'
    };
  } catch (e) {
    console.warn('getPoissonOdds_:', e.message);
    return null;
  }
}

// ─── Texto para el bot ────────────────────────────────────────────────────────

/**
 * Construye el texto formateado de predicción Poisson para el bot Telegram.
 * Incluye todos los mercados principales.
 */
function buildPoissonPredictionText_(homeTeam, awayTeam) {
  const strengths = buildPoissonStrengths_();
  if (!strengths || strengths.partidos < 1) {
    return '⚠️ Modelo Poisson sin datos suficientes aún (necesita al menos 1 partido FT).';
  }

  const { matrix, lambdaH, lambdaA } = predictMatch_(homeTeam, awayTeam, strengths);
  const m = deriveMarkets_(matrix, lambdaH, lambdaA);
  const hFlag = teamFlag_(homeTeam), aFlag = teamFlag_(awayTeam);
  const hName = teamNameToSpanish_(homeTeam), aName = teamNameToSpanish_(awayTeam);

  const pct   = (v) => `${(Number(v)||0).toFixed(1)}%`;
  const cuota = (v) => v ? `(${v.toFixed(2)})` : '';
  const bar   = (v) => {
    const n = Math.round((Number(v)||0) / 5);
    return '█'.repeat(Math.min(n,20)) + '░'.repeat(Math.max(0,20-n));
  };

  let txt = `📐 <b>Modelo Poisson — ${hFlag}${hName} vs ${aFlag}${aName}</b>\n`;
  txt += `<i>Calibrado con ${strengths.partidos} partidos del torneo · μ=${strengths.mu.toFixed(2)} goles/partido</i>\n\n`;

  txt += `⚽ <b>Goles esperados:</b> ${hName} <b>${m.lambda_home}</b> – <b>${m.lambda_away}</b> ${aName}\n`;
  txt += `🎯 <b>Marcador más probable:</b> ${m.top_scores[0]?.score || 'N/A'} (${m.top_scores[0]?.prob?.toFixed(1)}%)\n\n`;

  txt += `<b>Resultado final</b>\n`;
  txt += `${hFlag} Local  ${bar(m.prob_home)} ${pct(m.prob_home)} ${cuota(m.cuota_fair_h)}\n`;
  txt += `➖ Empate ${bar(m.prob_draw)} ${pct(m.prob_draw)} ${cuota(m.cuota_fair_d)}\n`;
  txt += `${aFlag} Visita ${bar(m.prob_away)} ${pct(m.prob_away)} ${cuota(m.cuota_fair_a)}\n\n`;

  txt += `<b>Over/Under</b>\n`;
  const ouLines = ['1.5','2.5','3.5'];
  ouLines.forEach(line => {
    const v = m.totals[line] || {};
    txt += `  O/U ${line}: Over ${pct(v.over)} ${cuota(v.cuota_over)} · Under ${pct(v.under)} ${cuota(v.cuota_under)}\n`;
  });

  txt += `\n<b>BTTS</b>\n`;
  txt += `  Sí ${pct(m.prob_btts_si)} · No ${pct(m.prob_btts_no)}\n\n`;

  txt += `<b>Double Chance</b>\n`;
  txt += `  1X ${pct(m.dc_1X)} · X2 ${pct(m.dc_X2)} · 12 ${pct(m.dc_12)}\n\n`;

  txt += `<b>Asian Handicap</b>\n`;
  const ahLines = ['-1.5','-0.5','0.5','1.5'];
  ahLines.forEach(line => {
    const v = m.asian_handicap[line] || {};
    const push = v.push > 0.01 ? ` · Empate ${pct(v.push)}` : '';
    txt += `  AH ${line}: ${hName} ${pct(v.home)} · ${aName} ${pct(v.away)}${push}\n`;
  });

  txt += `\n<b>Top 5 marcadores</b>\n`;
  m.top_scores.slice(0, 5).forEach(s => {
    txt += `  ${s.score} → ${s.prob?.toFixed(1)}%\n`;
  });

  txt += `\n<i>⚠️ Cuotas justas sin margen de casa. Compara con cuotas reales para detectar valor.</i>`;
  return txt;
}
