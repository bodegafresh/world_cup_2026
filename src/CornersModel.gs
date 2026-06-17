/**
 * CornersModel.gs
 *
 * Modelo Poisson de córners para el Mundial 2026.
 *
 * Los córners siguen una distribución Poisson independiente de los goles.
 * Calcula λ_corners_home y λ_corners_away a partir de tasas históricas
 * del torneo y ajusta con datos de posesión de SofaScore cuando están disponibles.
 *
 * Mercados cubiertos:
 *   - Totales O/U (8.5, 9.5, 10.5, 11.5)
 *   - Primer tiempo O/U (4.5, 5.5) — estimando 40% del total
 *   - Por equipo O/U (4.5, 5.5)
 *   - Qué equipo saca más córners
 *
 * Flujo:
 *   1. buildCornersStrengths_()     → calibrar modelo con datos históricos
 *   2. predictCorners_()            → calcular λ del partido
 *   3. deriveCornersMarkets_()      → todas las probabilidades
 *   4. saveCornersOdds_()           → upsert en hoja CornersOdds
 *   5. recalcularCornersOdds()      → procesar todos los partidos pendientes
 */

// ─── Parámetros del modelo ────────────────────────────────────────────────────

const CORNERS_HOME_ADV    = 1.08;  // local saca ~8% más córners
const CORNERS_MAX         = 20;    // córners máximos a modelar por lado
const CORNERS_SOFA_BLEND  = 0.3;  // peso de posesión SofaScore en ajuste
const CORNERS_MU_FALLBACK = 5.0;  // media histórica de córners por equipo (10 total) si no hay datos
const CORNERS_HT_FRACTION = 0.40; // fracción del total esperada en primer tiempo

// Correlación proxy goles→córners cuando no hay stats de córners
const CORNERS_GOALS_CORR  = 0.7;

// ─── Función Poisson univariada (comparte poissonPmf_ de PoissonModel.gs) ────

// poissonPmf_(lambda, k) ya está definida en PoissonModel.gs

// ─── Construcción del modelo de córners ──────────────────────────────────────

/**
 * Lee la hoja Partidos buscando columnas corners_home / corners_away.
 * Si no hay datos de córners, usa proxy basado en λ_goles (correlación 0.7).
 *
 * @param {number|string} [leagueId]  — filtrar por liga; si no se pasa, usa la activa.
 * @returns {{ mu, ataque, defensa, partidos, source }} | null
 */
function buildCornersStrengths_(leagueId) {
  let filtroLeague;
  if (leagueId === null) {
    filtroLeague = null;
  } else {
    try {
      const liga = getActiveLeague_();
      filtroLeague = leagueId !== undefined ? leagueId : liga.id;
    } catch (e_) {
      filtroLeague = 1; // fallback WC2026
    }
  }

  const partidos = readAll_(CONFIG.SHEETS.PARTIDOS)
    .filter(r => String(r.status || '').toUpperCase() === 'FT')
    .filter(r => r.goles_local !== '' && r.goles_visitante !== '')
    .filter(r => {
      if (!filtroLeague) return true;
      if (!r.league_id || r.league_id === '') return true;
      return String(r.league_id) === String(filtroLeague);
    });

  if (partidos.length === 0) return null;

  // Detectar si hay columnas de córners en los datos
  const hasCorners = partidos.some(r =>
    (r.corners_home !== undefined && r.corners_home !== '' && r.corners_home !== null) ||
    (r.corners_local !== undefined && r.corners_local !== '' && r.corners_local !== null)
  );

  const data = {};
  const ensure = (eq) => {
    if (!data[eq]) data[eq] = { cfH: 0, ccH: 0, pjH: 0, cfA: 0, ccA: 0, pjA: 0 };
  };

  let totalCorners = 0, totalGames = 0;
  let source = 'corners_directo';

  if (hasCorners) {
    // ── Modo directo: usar córners reales ────────────────────────────────
    partidos.forEach(r => {
      const h  = teamNameToSpanish_(r.local     || '');
      const a  = teamNameToSpanish_(r.visitante || '');
      // Soporte a distintos nombres de columna
      const ch = parseInt(r.corners_home || r.corners_local    || 0, 10);
      const ca = parseInt(r.corners_away || r.corners_visitante || 0, 10);
      if (isNaN(ch) || isNaN(ca)) return;

      ensure(h); ensure(a);
      data[h].cfH += ch; data[h].ccH += ca; data[h].pjH++;
      data[a].cfA += ca; data[a].ccA += ch; data[a].pjA++;
      totalCorners += ch + ca;
      totalGames++;
    });
  } else {
    // ── Modo proxy: correlacionar goles → córners ─────────────────────
    // Equipos que generan más goles también generan más córners (~0.7 corr)
    // Usar goles_local / goles_visitante como proxy lineal.
    source = 'proxy_goles';
    partidos.forEach(r => {
      const h  = teamNameToSpanish_(r.local     || '');
      const a  = teamNameToSpanish_(r.visitante || '');
      const gh = parseInt(r.goles_local     || 0, 10);
      const ga = parseInt(r.goles_visitante || 0, 10);
      if (isNaN(gh) || isNaN(ga)) return;

      // Proxy: convertir goles a córners esperados
      // Mundiales: ~1.3 goles/eq/partido → ~5 córners/eq/partido
      // ch_proxy = ga * CORNERS_GOALS_CORR * (CORNERS_MU_FALLBACK / 1.3)
      const scale = CORNERS_MU_FALLBACK / 1.3;
      const ch = gh * CORNERS_GOALS_CORR * scale + (1 - CORNERS_GOALS_CORR) * CORNERS_MU_FALLBACK;
      const ca = ga * CORNERS_GOALS_CORR * scale + (1 - CORNERS_GOALS_CORR) * CORNERS_MU_FALLBACK;

      ensure(h); ensure(a);
      data[h].cfH += ch; data[h].ccH += ca; data[h].pjH++;
      data[a].cfA += ca; data[a].ccA += ch; data[a].pjA++;
      totalCorners += ch + ca;
      totalGames++;
    });
  }

  const mu = totalGames > 0 ? totalCorners / (2 * totalGames) : CORNERS_MU_FALLBACK;

  // Calcular ratios de ataque y defensa de córners
  const teams = Object.keys(data);
  const atkR = {}, defR = {};

  teams.forEach(eq => {
    const d  = data[eq];
    const pj = d.pjH + d.pjA;
    if (pj === 0) { atkR[eq] = 1; defR[eq] = 1; return; }
    const cfRate = (d.cfH + d.cfA) / pj; // córners a favor por partido
    const ccRate = (d.ccH + d.ccA) / pj; // córners en contra por partido
    atkR[eq] = cfRate / mu;
    defR[eq] = ccRate / mu;
  });

  // Normalizar para que la media de los ratios sea 1
  const normalize = (obj) => {
    const vals = Object.values(obj);
    if (vals.length === 0) return obj;
    const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
    if (mean === 0) return obj;
    const out = {};
    Object.keys(obj).forEach(k => out[k] = obj[k] / mean);
    return out;
  };

  return {
    mu,
    ataque:  normalize(atkR),
    defensa: normalize(defR),
    equipos: teams,
    partidos: partidos.length,
    source
  };
}

// ─── Predicción de córners ────────────────────────────────────────────────────

/**
 * Calcula λ_corners_home y λ_corners_away para un partido.
 * Ajusta por posesión SofaScore cuando hay datos disponibles.
 *
 * @param {string} homeTeam
 * @param {string} awayTeam
 * @param {Object} strengths  — resultado de buildCornersStrengths_()
 * @returns {{ lambdaH, lambdaA, lambdaTotal }}
 */
function predictCorners_(homeTeam, awayTeam, strengths) {
  const home = teamNameToSpanish_(homeTeam);
  const away = teamNameToSpanish_(awayTeam);

  const mu   = strengths ? strengths.mu : CORNERS_MU_FALLBACK;
  const atkH = (strengths && strengths.ataque[home])  || 1;
  const defH = (strengths && strengths.defensa[home]) || 1;
  const atkA = (strengths && strengths.ataque[away])  || 1;
  const defA = (strengths && strengths.defensa[away]) || 1;

  let lambdaH = mu * atkH * defA * CORNERS_HOME_ADV;
  let lambdaA = mu * atkA * defH;

  // Ajuste por posesión de ataque (SofaScore) si está disponible
  const sofaBoost = _getSofaPossessionBoost_(home, away);
  if (sofaBoost) {
    lambdaH = lambdaH * (1 - CORNERS_SOFA_BLEND) + lambdaH * sofaBoost.home * CORNERS_SOFA_BLEND;
    lambdaA = lambdaA * (1 - CORNERS_SOFA_BLEND) + lambdaA * sofaBoost.away * CORNERS_SOFA_BLEND;
  }

  // Mínimo razonable
  lambdaH = Math.max(lambdaH, 1.5);
  lambdaA = Math.max(lambdaA, 1.5);

  return {
    lambdaH: Math.round(lambdaH * 100) / 100,
    lambdaA: Math.round(lambdaA * 100) / 100,
    lambdaTotal: Math.round((lambdaH + lambdaA) * 100) / 100
  };
}

/**
 * Obtiene multiplicador de posesión en tercio atacante de SofaStats.
 * Retorna { home, away } donde 1.0 = media. Retorna null si no hay datos.
 *
 * @param {string} home  — nombre en español
 * @param {string} away
 * @returns {{ home: number, away: number } | null}
 */
function _getSofaPossessionBoost_(home, away) {
  try {
    const rows = readAll_(CONFIG.SHEETS.SOFA_STATS);
    if (!rows || rows.length === 0) return null;

    const normN = s => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z]/g, '');
    const qH = normN(home), qA = normN(away);

    const rowH = rows.find(r => {
      const t = normN(r.equipo || r.team || '');
      return t.includes(qH) || qH.includes(t);
    });
    const rowA = rows.find(r => {
      const t = normN(r.equipo || r.team || '');
      return t.includes(qA) || qA.includes(t);
    });

    if (!rowH && !rowA) return null;

    // posesion_tercio_ataque: porcentaje de posesión en tercio atacante
    const posH = parseFloat(rowH && (rowH.posesion_tercio_ataque || rowH.possession_att_third) || 0);
    const posA = parseFloat(rowA && (rowA.posesion_tercio_ataque || rowA.possession_att_third) || 0);

    if (!posH && !posA) return null;

    // Normalizar contra 50% (neutral) → multiplicador de 0.8 a 1.2 aprox.
    const neutral = 50;
    const toMultiplier = (pos) => {
      if (!pos) return 1;
      return 0.8 + (pos / neutral) * 0.4;  // pos=50 → 1.2, pos=0 → 0.8
    };

    return {
      home: toMultiplier(posH),
      away: toMultiplier(posA)
    };
  } catch (e_) {
    return null;
  }
}

// ─── Derivación de mercados de córners ───────────────────────────────────────

/**
 * Calcula todas las probabilidades de mercado usando Poisson univariado.
 *
 * Para totales: convolucionamos las dos distribuciones independientes.
 * Para primer tiempo: asumimos fracción CORNERS_HT_FRACTION del total.
 *
 * @param {number} lambdaH
 * @param {number} lambdaA
 * @returns {CornersMarkets}
 */
function deriveCornersMarkets_(lambdaH, lambdaA) {
  const MAX = CORNERS_MAX;
  const fair = (p) => (p > 0.001 ? Math.round((1 / p) * 100) / 100 : null);
  const pct  = (p) => Math.round(p * 10000) / 100;

  // ── Distribución del total (convolución discreta de dos Poisson) ──────────
  const lambdaT = lambdaH + lambdaA; // suma de Poisson independientes = Poisson(λH + λA)

  const probTotal = (line) => {
    let over = 0;
    for (let k = 0; k <= MAX * 2; k++) {
      if (k > line) over += poissonPmf_(lambdaT, k);
    }
    return { over, under: 1 - over };
  };

  // ── Distribución por equipo ───────────────────────────────────────────────
  const probTeam = (lambda, line) => {
    let over = 0;
    for (let k = 0; k <= MAX; k++) {
      if (k > line) over += poissonPmf_(lambda, k);
    }
    return { over, under: 1 - over };
  };

  // ── Primer tiempo ─────────────────────────────────────────────────────────
  const lambdaHT = lambdaT * CORNERS_HT_FRACTION;
  const probHT = (line) => {
    let over = 0;
    for (let k = 0; k <= MAX; k++) {
      if (k > line) over += poissonPmf_(lambdaHT, k);
    }
    return { over, under: 1 - over };
  };

  // ── P(local > visitante en córners) ─────────────────────────────────────
  let probHomeMás = 0, probAwayMás = 0, probEmpate = 0;
  for (let i = 0; i <= MAX; i++) {
    const pH = poissonPmf_(lambdaH, i);
    for (let j = 0; j <= MAX; j++) {
      const p = pH * poissonPmf_(lambdaA, j);
      if (i > j) probHomeMás += p;
      else if (i < j) probAwayMás += p;
      else probEmpate += p;
    }
  }

  // ── Armar resultado ───────────────────────────────────────────────────────
  const t85  = probTotal(8.5);
  const t95  = probTotal(9.5);
  const t105 = probTotal(10.5);
  const t115 = probTotal(11.5);

  const ht45 = probHT(4.5);
  const ht55 = probHT(5.5);

  const h45 = probTeam(lambdaH, 4.5);
  const h55 = probTeam(lambdaH, 5.5);
  const a45 = probTeam(lambdaA, 4.5);
  const a55 = probTeam(lambdaA, 5.5);

  return {
    total: {
      over_8_5:  pct(t85.over),
      under_8_5: pct(t85.under),
      over_9_5:  pct(t95.over),
      under_9_5: pct(t95.under),
      over_10_5: pct(t105.over),
      under_10_5: pct(t105.under),
      over_11_5: pct(t115.over),
      under_11_5: pct(t115.under),
      cuota_fair_over95:  fair(t95.over),
      cuota_fair_under95: fair(t95.under)
    },
    home: {
      over_4_5:  pct(h45.over),
      under_4_5: pct(h45.under),
      over_5_5:  pct(h55.over),
      under_5_5: pct(h55.under),
      prob_more_corners: pct(probHomeMás)
    },
    away: {
      over_4_5:  pct(a45.over),
      under_4_5: pct(a45.under),
      over_5_5:  pct(a55.over),
      under_5_5: pct(a55.under),
      prob_more_corners: pct(probAwayMás)
    },
    primer_tiempo: {
      lambda_ht: Math.round(lambdaHT * 100) / 100,
      over_4_5:  pct(ht45.over),
      under_4_5: pct(ht45.under),
      over_5_5:  pct(ht55.over),
      under_5_5: pct(ht55.under)
    },
    prob_empate_corners: pct(probEmpate)
  };
}

// ─── Guardado en hoja CornersOdds ────────────────────────────────────────────

const CORNERS_HEADERS = [
  'match_key', 'fecha', 'local', 'visitante',
  'lambda_home', 'lambda_away', 'lambda_total',
  'over_8_5', 'over_9_5', 'over_10_5', 'over_11_5',
  'home_over_4_5', 'away_over_4_5',
  'prob_home_more', 'cuota_fair_over95', 'cuota_fair_under95',
  'updated_at'
];

/**
 * Calcula y hace upsert en la hoja CornersOdds para un fixture.
 *
 * @param {Object} fixture   — row de la hoja Partidos
 * @param {Object} [strengths] — resultado de buildCornersStrengths_()
 */
function saveCornersOdds_(fixture, strengths) {
  const home = fixture.local     || fixture.homeTeam || '';
  const away = fixture.visitante || fixture.awayTeam || '';
  if (!home || !away) return;

  if (!strengths) strengths = buildCornersStrengths_();

  const { lambdaH, lambdaA, lambdaTotal } = predictCorners_(home, away, strengths);
  const m = deriveCornersMarkets_(lambdaH, lambdaA);

  const matchKey = fixture.match_key ||
    `${normalizeFecha_(fixture.fecha)}_${norm_(home)}_${norm_(away)}`;

  const row = [
    matchKey,
    normalizeFecha_(fixture.fecha),
    teamNameToSpanish_(home),
    teamNameToSpanish_(away),
    lambdaH,
    lambdaA,
    lambdaTotal,
    m.total.over_8_5,
    m.total.over_9_5,
    m.total.over_10_5,
    m.total.over_11_5,
    m.home.over_4_5,
    m.away.over_4_5,
    m.home.prob_more_corners,
    m.total.cuota_fair_over95,
    m.total.cuota_fair_under95,
    nowChile_()
  ];

  const sheet   = getOrCreateSheet_(CONFIG.SHEETS.CORNERS_ODDS, CORNERS_HEADERS);
  const values  = sheet.getDataRange().getValues();
  const mkIdx   = values[0].indexOf('match_key');
  const existing = values.slice(1).findIndex(r => r[mkIdx] === matchKey);

  if (existing >= 0) {
    sheet.getRange(existing + 2, 1, 1, row.length).setValues([row]);
  } else {
    sheet.appendRow(row);
  }
}

/**
 * Recalcula CornersOdds para todos los partidos pendientes (status ≠ FT).
 * Llamado desde cronDailySetup.
 */
function recalcularCornersOdds() {
  const strengths = buildCornersStrengths_();
  if (!strengths) {
    Logger.log('recalcularCornersOdds: sin datos suficientes para calibrar el modelo');
    return;
  }

  Logger.log(`recalcularCornersOdds: μ=${strengths.mu.toFixed(2)} córners/eq | fuente=${strengths.source} | ${strengths.partidos} partidos`);

  const todos = readAll_(CONFIG.SHEETS.PARTIDOS)
    .filter(r => String(r.status || '').toUpperCase() !== 'FT');

  todos.forEach(r => {
    try {
      saveCornersOdds_(r, strengths);
    } catch (e) {
      console.warn(`saveCornersOdds_ ${r.match_key}:`, e.message);
    }
    Utilities.sleep(50);
  });

  Logger.log(`recalcularCornersOdds: ${todos.length} partidos calculados`);
}

// ─── Texto EV para Telegram ───────────────────────────────────────────────────

/**
 * Lee CornersOdds y BetfairOdds/OddsApuestas para un partido, calcula EV
 * y retorna texto HTML formateado para Telegram.
 *
 * @param {string} homeTeam
 * @param {string} awayTeam
 * @returns {string}
 */
function buildCornersEVText_(homeTeam, awayTeam) {
  const home = teamNameToSpanish_(homeTeam);
  const away = teamNameToSpanish_(awayTeam);
  const normN = s => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z]/g, '');
  const qH = normN(home), qA = normN(away);

  // Buscar en CornersOdds
  let cornersRow = null;
  try {
    const rows = readAll_(CONFIG.SHEETS.CORNERS_ODDS);
    cornersRow = rows.find(r => {
      const h = normN(r.local || ''), a = normN(r.visitante || '');
      return (h.includes(qH) || qH.includes(h)) && (a.includes(qA) || qA.includes(a));
    });
  } catch (e_) {}

  if (!cornersRow) return '⚠️ Sin datos de córners para este partido. Ejecuta /corners primero.';

  const lambdaH    = parseFloat(cornersRow.lambda_home  || 0);
  const lambdaA    = parseFloat(cornersRow.lambda_away  || 0);
  const fairOver95 = parseFloat(cornersRow.cuota_fair_over95  || 0);
  const fairUnd95  = parseFloat(cornersRow.cuota_fair_under95 || 0);
  const over95prob = parseFloat(cornersRow.over_9_5 || 0) / 100;

  const hFlag = teamFlag_(homeTeam), aFlag = teamFlag_(awayTeam);
  const pct = (v) => `${(Number(v) || 0).toFixed(1)}%`;
  const cuota = (v) => v ? `${v.toFixed(2)}` : 'N/D';

  let txt = `⚽🔄 <b>Córners — ${hFlag}${home} vs ${aFlag}${away}</b>\n`;
  txt += `<i>λ: ${home} <b>${lambdaH}</b> · ${away} <b>${lambdaA}</b> · Total <b>${(lambdaH + lambdaA).toFixed(1)}</b></i>\n\n`;

  txt += `<b>Mercados totales</b>\n`;
  const lines = [
    { label: 'O/U 8.5', over: cornersRow.over_8_5, under: (100 - parseFloat(cornersRow.over_8_5 || 0)).toFixed(1) },
    { label: 'O/U 9.5', over: cornersRow.over_9_5, under: (100 - parseFloat(cornersRow.over_9_5 || 0)).toFixed(1) },
    { label: 'O/U 10.5', over: cornersRow.over_10_5, under: (100 - parseFloat(cornersRow.over_10_5 || 0)).toFixed(1) },
    { label: 'O/U 11.5', over: cornersRow.over_11_5, under: (100 - parseFloat(cornersRow.over_11_5 || 0)).toFixed(1) },
  ];
  lines.forEach(l => {
    txt += `  ${l.label}: Over <b>${pct(l.over)}</b> · Under ${pct(l.under)}\n`;
  });

  txt += `\n<b>Cuotas justas O/U 9.5</b>\n`;
  txt += `  Over 9.5 → ${cuota(fairOver95)} · Under 9.5 → ${cuota(fairUnd95)}\n`;

  txt += `\n<b>Por equipo</b>\n`;
  txt += `  ${hFlag}${home} +4.5: <b>${pct(cornersRow.home_over_4_5)}</b> · +5.5: ${pct(parseFloat(cornersRow.home_over_4_5 || 0) * 0.7)}\n`;
  txt += `  ${aFlag}${away} +4.5: <b>${pct(cornersRow.away_over_4_5)}</b>\n`;
  txt += `  Más córners: ${home} <b>${pct(cornersRow.prob_home_more)}</b> · ${away} ${pct(100 - parseFloat(cornersRow.prob_home_more || 0))}\n`;

  // Buscar cuotas reales en BetfairOdds
  try {
    const betRows = readAll_(CONFIG.SHEETS.BETFAIR_ODDS);
    const matchBet = betRows.find(r => {
      const h = normN(r.home_team || r.local || '');
      const a = normN(r.away_team || r.visitante || '');
      const mt = String(r.market_type || '').toLowerCase();
      return (h.includes(qH) || qH.includes(h)) && (a.includes(qA) || qA.includes(a))
          && mt.includes('corner');
    });

    if (matchBet) {
      const bookOver  = parseFloat(matchBet.odds_over || matchBet.cuota_over  || 0);
      const bookUnder = parseFloat(matchBet.odds_under || matchBet.cuota_under || 0);

      if (bookOver > 0 && fairOver95 > 0) {
        const evOver  = (over95prob * bookOver) - 1;
        const evUnder = ((1 - over95prob) * bookUnder) - 1;
        txt += `\n<b>EV vs mercado (O/U 9.5)</b>\n`;
        txt += `  Over:  cuota ${bookOver.toFixed(2)} → EV <b>${(evOver * 100).toFixed(1)}%</b>${evOver > 0 ? ' ✅' : ''}\n`;
        txt += `  Under: cuota ${bookUnder.toFixed(2)} → EV <b>${(evUnder * 100).toFixed(1)}%</b>${evUnder > 0 ? ' ✅' : ''}\n`;
      }
    }
  } catch (e_) {}

  txt += `\n<i>⚠️ Cuotas justas sin margen. Compara con cuotas reales.</i>`;
  return txt;
}

// ─── Comando /corners ─────────────────────────────────────────────────────────

/**
 * Handler principal del comando /corners.
 *
 * Sin args:  muestra los 3 partidos de hoy con λ corners y mercados clave.
 * Con equipo: muestra histórico de córners del equipo en el torneo.
 *
 * @param {string} args  — argumento pasado después de /corners
 * @returns {string}
 */
function buildCornersCommandText_(args) {
  if (args) {
    return _buildCornersTeamHistory_(args);
  }
  return _buildCornersTodayText_();
}

/**
 * Muestra los partidos de hoy con predicción de córners.
 * @returns {string}
 */
function _buildCornersTodayText_() {
  const today    = todayChile_();
  const partidos = readAll_(CONFIG.SHEETS.PARTIDOS)
    .filter(r => normalizeFecha_(r.fecha) === today)
    .filter(r => String(r.status || '').toUpperCase() !== 'FT');

  if (!partidos.length) {
    return `📅 No hay partidos pendientes para hoy (${today}).`;
  }

  const strengths = buildCornersStrengths_();

  let txt = `🔄 <b>Predicción de Córners — ${today}</b>\n\n`;

  const top = partidos.slice(0, 3);
  top.forEach(r => {
    const home = teamNameToSpanish_(r.local     || '');
    const away = teamNameToSpanish_(r.visitante || '');
    const hFlag = teamFlag_(r.local), aFlag = teamFlag_(r.visitante);
    const hora = normalizeHora_(r.hora || '') || '--:--';

    let lambdaH, lambdaA, lambdaTotal, markets;
    try {
      const pred = predictCorners_(home, away, strengths);
      lambdaH = pred.lambdaH; lambdaA = pred.lambdaA; lambdaTotal = pred.lambdaTotal;
      markets = deriveCornersMarkets_(lambdaH, lambdaA);
    } catch (e_) {
      txt += `${hFlag}${home} vs ${aFlag}${away} — error al calcular\n\n`;
      return;
    }

    txt += `${hFlag}<b>${home}</b> vs ${aFlag}<b>${away}</b> · ${hora}\n`;
    txt += `  λ: ${home} <b>${lambdaH}</b> · ${away} <b>${lambdaA}</b> · Total <b>${lambdaTotal}</b>\n`;
    txt += `  O/U 9.5: Over <b>${markets.total.over_9_5}%</b> · Under ${markets.total.under_9_5}%\n`;
    txt += `  O/U 10.5: Over ${markets.total.over_10_5}% · O/U 8.5: Over ${markets.total.over_8_5}%\n`;
    txt += `  Más córners: ${home} ${markets.home.prob_more_corners}% · ${away} ${markets.away.prob_more_corners}%\n`;
    txt += `  1T +4.5: ${markets.primer_tiempo.over_4_5}% · λHT=${markets.primer_tiempo.lambda_ht}\n`;
    txt += '\n';
  });

  const source = strengths ? `fuente=${strengths.source}, μ=${strengths.mu.toFixed(1)} córners/eq` : 'sin calibración';
  txt += `<i>Modelo: ${source}. /corners EQUIPO para histórico.</i>`;
  return txt;
}

/**
 * Muestra el historial de córners de un equipo en el torneo.
 * @param {string} query  — nombre del equipo
 * @returns {string}
 */
function _buildCornersTeamHistory_(query) {
  const normN = s => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z]/g, '');
  const q = normN(query);

  const partidos = readAll_(CONFIG.SHEETS.PARTIDOS)
    .filter(r => String(r.status || '').toUpperCase() === 'FT')
    .filter(r => {
      const h = normN(r.local     || '');
      const a = normN(r.visitante || '');
      return h.includes(q) || q.includes(h) || a.includes(q) || q.includes(a);
    });

  const teamEs = teamNameToSpanish_(query);
  const flag   = teamFlag_(query);

  if (!partidos.length) {
    return `${flag}${teamEs} no tiene partidos finalizados registrados.`;
  }

  // Verificar si hay datos de córners
  const hasCorners = partidos.some(r =>
    (r.corners_home !== undefined && r.corners_home !== '') ||
    (r.corners_local !== undefined && r.corners_local !== '')
  );

  let txt = `🔄 <b>Córners — ${flag}${teamEs}</b>\n\n`;

  if (!hasCorners) {
    txt += `<i>No hay estadísticas de córners registradas. Datos de goles disponibles:</i>\n\n`;
  }

  let totalCF = 0, totalCC = 0, pj = 0;

  partidos.forEach(r => {
    const isHome = normN(r.local || '').includes(q) || q.includes(normN(r.local || ''));
    const rival  = teamNameToSpanish_(isHome ? r.visitante : r.local);
    const rFlag  = teamFlag_(isHome ? r.visitante : r.local);
    const fecha  = normalizeFecha_(r.fecha);
    const gl     = parseInt(r.goles_local     || 0, 10);
    const ga     = parseInt(r.goles_visitante || 0, 10);
    const goles  = isHome ? `${gl}-${ga}` : `${ga}-${gl}`;

    if (hasCorners) {
      const ch = parseInt((isHome ? r.corners_home || r.corners_local : r.corners_away || r.corners_visitante) || 0, 10);
      const cc = parseInt((isHome ? r.corners_away || r.corners_visitante : r.corners_home || r.corners_local) || 0, 10);
      totalCF += ch; totalCC += cc; pj++;
      txt += `${fecha} vs ${rFlag}${rival} (${goles}): <b>${ch}–${cc}</b> córners\n`;
    } else {
      txt += `${fecha} vs ${rFlag}${rival}: ${goles} goles\n`;
      pj++;
    }
  });

  if (hasCorners && pj > 0) {
    txt += `\n<b>Promedio:</b> ${(totalCF / pj).toFixed(1)} a favor · ${(totalCC / pj).toFixed(1)} en contra\n`;
    txt += `<b>Total:</b> ${totalCF} a favor · ${totalCC} en contra\n`;
  }

  return txt;
}
