/**
 * CardsModel.gs
 *
 * Modelo predictivo de tarjetas para apuestas en fútbol.
 *
 * El total de tarjetas en un partido depende principalmente de:
 *   1. El árbitro asignado (~40% varianza) — factor más determinante
 *   2. El historial de agresividad de cada equipo (~35%)
 *   3. El contexto del partido (ronda, presión, importancia) (~15%)
 *   4. Regresión a la media del torneo (~10%)
 *
 * λ_tarjetas = α_arbitro × β_equipo_home × β_equipo_away × γ_contexto
 *
 * Mercados soportados:
 *   - Tarjetas totales O/U 3.5, 4.5, 5.5
 *   - Tarjetas por equipo O/U 1.5, 2.5
 *   - Tarjeta roja Sí/No
 *   - Equipo con más tarjetas (H/A)
 *
 * Hoja: CardsOdds
 * Columnas: match_key, fecha, local, visitante, arbitro,
 *           lambda_home, lambda_away, lambda_total,
 *           over_3_5, over_4_5, over_5_5,
 *           home_over_1_5, away_over_1_5,
 *           prob_roja_si, cuota_fair_over45, cuota_fair_under45, updated_at
 */

// ─── Parámetros del modelo ────────────────────────────────────────────────────

const CARDS_BASE_YELLOW    = 3.8;   // promedio amarillas WC por partido
const CARDS_BASE_RED       = 0.15;  // promedio rojas WC por partido
const CARDS_REFEREE_WEIGHT = 0.50;  // peso del árbitro en el modelo (50%)
const CARDS_TEAM_WEIGHT    = 0.35;  // peso del historial de equipos (35%)
const CARDS_CONTEXT_WEIGHT = 0.15;  // peso del contexto del partido (15%)

// Multiplicadores por contexto de partido
const CARDS_CONTEXT = {
  GROUP_STAGE:  1.00,
  ROUND_OF_32:  1.05,
  ROUND_OF_16:  1.10,
  QUARTER:      1.15,
  SEMI:         1.20,
  FINAL:        1.25
};

// Probabilidad base de roja por tarjeta adicional (simplificado)
const CARDS_RED_PER_YELLOW_RATE = 0.055; // ~1 roja cada 18 amarillas en WC

const CARDS_HEADERS = [
  'match_key', 'fecha', 'local', 'visitante', 'arbitro',
  'lambda_home', 'lambda_away', 'lambda_total',
  'over_3_5', 'over_4_5', 'over_5_5',
  'home_over_1_5', 'away_over_1_5',
  'prob_roja_si', 'cuota_fair_over45', 'cuota_fair_under45', 'updated_at'
];

// ─── Construcción de fuerzas ──────────────────────────────────────────────────

/**
 * Lee la hoja Arbitros y construye el mapa de promedios por árbitro.
 * Lee la hoja Partidos (y PlayerMatchStats si disponible) para historial de equipos.
 *
 * @returns {{
 *   arbitros: { nombre: { amarillas_pp, rojas_pp, partidos, estilo } },
 *   equipos:  { nombre: { amarillas_prom, rojas_prom, agresividad_idx } }
 * }}
 */
function buildCardsStrengths_() {
  // ── Árbitros ──────────────────────────────────────────────────────────────
  const arbitros = {};
  try {
    const arbRows = readAll_(CONFIG.SHEETS.ARBITROS);
    const byRef = {};

    arbRows.forEach(r => {
      const nombre = String(r.nombre || '').trim();
      if (!nombre) return;
      if (!byRef[nombre]) byRef[nombre] = { am: 0, ro: 0, pj: 0 };
      byRef[nombre].am += Number(r.amarillas || 0);
      byRef[nombre].ro += Number(r.rojas     || 0);
      byRef[nombre].pj++;
    });

    Object.entries(byRef).forEach(([nombre, d]) => {
      const am_pp = d.pj ? d.am / d.pj : CARDS_BASE_YELLOW;
      const ro_pp = d.pj ? d.ro / d.pj : CARDS_BASE_RED;
      arbitros[nombre] = {
        amarillas_pp: am_pp,
        rojas_pp:     ro_pp,
        partidos:     d.pj,
        estilo: am_pp >= 4.5 ? 'ESTRICTO' : am_pp <= 2.5 ? 'PERMISIVO' : 'NORMAL'
      };
    });
  } catch (e_) {
    console.warn('buildCardsStrengths_: no se pudo leer Arbitros —', e_.message);
  }

  // ── Equipos ──────────────────────────────────────────────────────────────
  const equipos = {};
  try {
    // Intentar leer tarjetas desde hoja Arbitros (tiene local/visitante y tarjetas por partido)
    const arbRows = readAll_(CONFIG.SHEETS.ARBITROS);
    const byTeam = {};

    const ensureTeam = (nombre) => {
      if (!byTeam[nombre]) byTeam[nombre] = { am: 0, ro: 0, pj: 0 };
    };

    arbRows.forEach(r => {
      // Cada fila de Arbitros tiene amarillas y rojas TOTALES del partido
      // No tenemos desglose home/away por equipo en esa hoja
      // Distribuimos la mitad a cada equipo como aproximación
      const local = teamNameToSpanish_(String(r.equipo_local || ''));
      const visit = teamNameToSpanish_(String(r.equipo_visitante || ''));
      if (!local || !visit) return;
      const am = Number(r.amarillas || 0);
      const ro = Number(r.rojas     || 0);

      ensureTeam(local); ensureTeam(visit);
      // Distribución 50/50 cuando no hay desglose
      byTeam[local].am += am / 2;
      byTeam[local].ro += ro / 2;
      byTeam[local].pj++;
      byTeam[visit].am += am / 2;
      byTeam[visit].ro += ro / 2;
      byTeam[visit].pj++;
    });

    // Intentar afinar con PlayerMatchStats si existe (tiene tarjetas por jugador)
    try {
      const statsRows = readAll_(CONFIG.SHEETS.PLAYER_MATCH_STATS);
      statsRows.forEach(r => {
        const equipo = teamNameToSpanish_(String(r.equipo || r.team || ''));
        if (!equipo) return;
        const am = Number(r.amarillas || r.yellow_cards || 0);
        const ro = Number(r.rojas     || r.red_cards    || 0);
        if (am === 0 && ro === 0) return;
        if (!byTeam[equipo]) byTeam[equipo] = { am: 0, ro: 0, pj: 0 };
        byTeam[equipo].am += am;
        byTeam[equipo].ro += ro;
        // pj ya contado desde Arbitros; no incrementar aquí para no duplicar
      });
    } catch (e_) { /* PlayerMatchStats no disponible o sin datos de tarjetas */ }

    // Calcular índice de agresividad relativo a la media
    const allAm = Object.values(byTeam).map(d => d.pj ? d.am / d.pj : CARDS_BASE_YELLOW / 2);
    const mediaLiga = allAm.length
      ? allAm.reduce((a, b) => a + b, 0) / allAm.length
      : CARDS_BASE_YELLOW / 2;

    Object.entries(byTeam).forEach(([nombre, d]) => {
      const am_pp = d.pj ? d.am / d.pj : CARDS_BASE_YELLOW / 2;
      const ro_pp = d.pj ? d.ro / d.pj : CARDS_BASE_RED / 2;
      equipos[nombre] = {
        amarillas_prom:   am_pp,
        rojas_prom:       ro_pp,
        agresividad_idx:  mediaLiga > 0 ? am_pp / mediaLiga : 1,
        partidos:         d.pj
      };
    });
  } catch (e_) {
    console.warn('buildCardsStrengths_ equipos:', e_.message);
  }

  return { arbitros, equipos };
}

// ─── Búsqueda de árbitro para un partido ─────────────────────────────────────

/**
 * Busca el árbitro asignado a un partido dado su match_key.
 * Busca en la hoja Partidos (campo referee) o Arbitros.
 *
 * @param {string} matchKey
 * @param {string} [local]
 * @param {string} [visitante]
 * @returns {{ nombre: string, amarillas_pp: number, rojas_pp: number } | null}
 */
function getArbitroForFixture_(matchKey, local, visitante) {
  let refName = null;

  // 1. Buscar en hoja Partidos (campo referee o arbitro)
  try {
    const partidos = readAll_(CONFIG.SHEETS.PARTIDOS);
    const fila = partidos.find(r => {
      if (matchKey && r.match_key === matchKey) return true;
      if (local && visitante) {
        return norm_(r.local     || '') === norm_(local) &&
               norm_(r.visitante || '') === norm_(visitante);
      }
      return false;
    });
    if (fila) refName = String(fila.arbitro || fila.referee || '').trim() || null;
  } catch (e_) {}

  // 2. Buscar en hoja Arbitros por equipo/fecha
  if (!refName && local && visitante) {
    try {
      const arbRows = readAll_(CONFIG.SHEETS.ARBITROS);
      const fila = arbRows.find(r =>
        norm_(r.equipo_local     || '') === norm_(local) &&
        norm_(r.equipo_visitante || '') === norm_(visitante)
      );
      if (fila) refName = String(fila.nombre || '').trim() || null;
    } catch (e_) {}
  }

  if (!refName) return null;

  // Obtener stats del árbitro
  const stats = getRefereeStats_(refName);
  if (stats) {
    return {
      nombre:       stats.nombre,
      amarillas_pp: stats.amarillas_pp,
      rojas_pp:     stats.rojas ? stats.rojas / stats.partidos : CARDS_BASE_RED
    };
  }

  // Árbitro encontrado pero sin historial en torneo — usar catálogo
  return {
    nombre:       refName,
    amarillas_pp: CARDS_BASE_YELLOW,
    rojas_pp:     CARDS_BASE_RED
  };
}

// ─── Predicción de tarjetas ───────────────────────────────────────────────────

/**
 * Detecta el multiplicador de contexto según la ronda del partido.
 * @param {string} ronda
 * @returns {number}
 */
function _cardsContextMultiplier_(ronda) {
  if (!ronda) return CARDS_CONTEXT.GROUP_STAGE;
  const r = ronda.toLowerCase();
  if (r.includes('final') && !r.includes('semi') && !r.includes('quarter') && !r.includes('16') && !r.includes('32')) {
    return CARDS_CONTEXT.FINAL;
  }
  if (r.includes('semi')) return CARDS_CONTEXT.SEMI;
  if (r.includes('quarter') || r.includes('cuarto')) return CARDS_CONTEXT.QUARTER;
  if (r.includes('16') || r.includes('octavo') || r.includes('round of 16')) return CARDS_CONTEXT.ROUND_OF_16;
  if (r.includes('32') || r.includes('round of 32')) return CARDS_CONTEXT.ROUND_OF_32;
  return CARDS_CONTEXT.GROUP_STAGE;
}

/**
 * Calcula las lambdas de tarjetas para el partido.
 *
 * @param {string} homeTeam
 * @param {string} awayTeam
 * @param {string} matchKey
 * @param {Object} strengths  resultado de buildCardsStrengths_()
 * @param {string} [ronda]    ronda del partido para ajuste de contexto
 * @returns {{
 *   lambdaAmarillasHome: number,
 *   lambdaAmarillasAway: number,
 *   lambdaTotal: number,
 *   probRoja: number
 * }}
 */
function predictCards_(homeTeam, awayTeam, matchKey, strengths, ronda) {
  const home = teamNameToSpanish_(homeTeam);
  const away = teamNameToSpanish_(awayTeam);

  // ── Factor árbitro ────────────────────────────────────────────────────────
  const arbData = getArbitroForFixture_(matchKey, home, away);
  const refFactor = arbData
    ? arbData.amarillas_pp / CARDS_BASE_YELLOW
    : 1.0; // sin árbitro conocido → regresión a media

  // ── Factor equipo ─────────────────────────────────────────────────────────
  const eqH  = (strengths.equipos || {})[home] || { agresividad_idx: 1 };
  const eqA  = (strengths.equipos || {})[away] || { agresividad_idx: 1 };

  // λ de cada equipo = media_torneo × agresividad_local × agresividad_visitante_provocada
  // Aproximación: cada equipo recibe tarjetas = f(su propia agresividad + la del rival)
  const agresH = eqH.agresividad_idx || 1;
  const agresA = eqA.agresividad_idx || 1;

  // ── Factor contexto ───────────────────────────────────────────────────────
  const ctxMult = _cardsContextMultiplier_(ronda || '');

  // ── Cálculo del lambda por equipo ─────────────────────────────────────────
  // Combinación ponderada: árbitro (50%) + historial equipo (35%) + contexto (15%)
  // Base = CARDS_BASE_YELLOW / 2 (tarjetas esperadas por equipo)
  const base = CARDS_BASE_YELLOW / 2;

  // Contribución árbitro
  const arbContribH = base * refFactor;
  const arbContribA = base * refFactor;

  // Contribución historial equipos
  const teamContribH = base * agresH;
  const teamContribA = base * agresA;

  // Lambdas ponderadas
  const rawLH = (arbContribH * CARDS_REFEREE_WEIGHT) +
                (teamContribH * CARDS_TEAM_WEIGHT) +
                (base * CARDS_CONTEXT_WEIGHT);

  const rawLA = (arbContribA * CARDS_REFEREE_WEIGHT) +
                (teamContribA * CARDS_TEAM_WEIGHT) +
                (base * CARDS_CONTEXT_WEIGHT);

  const lambdaAmarillasHome = rawLH * ctxMult;
  const lambdaAmarillasAway = rawLA * ctxMult;
  const lambdaTotal = lambdaAmarillasHome + lambdaAmarillasAway;

  // Probabilidad de tarjeta roja
  // P(roja) = 1 - e^(-λ_roja) donde λ_roja = lambdaTotal × tasa_roja_por_amarilla
  const lambdaRoja = lambdaTotal * CARDS_RED_PER_YELLOW_RATE;
  const probRoja = 1 - Math.exp(-lambdaRoja);

  return {
    lambdaAmarillasHome: Math.round(lambdaAmarillasHome * 100) / 100,
    lambdaAmarillasAway: Math.round(lambdaAmarillasAway * 100) / 100,
    lambdaTotal:         Math.round(lambdaTotal * 100) / 100,
    probRoja:            Math.round(probRoja * 10000) / 10000,
    refFactor,
    ctxMult,
    arbitro: arbData ? arbData.nombre : null
  };
}

// ─── Derivación de mercados ───────────────────────────────────────────────────

/**
 * CDF acumulada Poisson: P(X <= k) dado lambda.
 */
function _poissonCDF_(lambda, k) {
  let cum = 0;
  for (let i = 0; i <= k; i++) {
    cum += poissonPmf_(lambda, i);
  }
  return Math.min(cum, 1);
}

/**
 * P(X >= n) = 1 - P(X <= n-1) para Poisson.
 */
function _poissonOverN_(lambda, n) {
  return Math.max(0, 1 - _poissonCDF_(lambda, n - 1));
}

/**
 * Calcula todas las probabilidades de mercado de tarjetas.
 *
 * @param {number} lH   lambda amarillas local
 * @param {number} lA   lambda amarillas visitante
 * @param {number} lT   lambda total (amarillas)
 * @param {number} pR   probabilidad de que haya al menos 1 roja
 * @returns {CardsMarkets}
 */
function deriveCardsMarkets_(lH, lA, lT, pR) {
  const fair = (p) => p > 0.001 ? Math.round((1 / p) * 100) / 100 : null;
  const pct  = (p) => Math.round(p * 10000) / 100;

  // Over/Under totales (lineas: 3.5, 4.5, 5.5)
  // Para línea X.5: over = P(total >= ceil(X.5)) = P(total >= X+1)
  const over35 = _poissonOverN_(lT, 4);  // P(total >= 4)
  const over45 = _poissonOverN_(lT, 5);  // P(total >= 5)
  const over55 = _poissonOverN_(lT, 6);  // P(total >= 6)

  // Over/Under por equipo
  const homeOver15 = _poissonOverN_(lH, 2); // P(home >= 2)
  const homeOver25 = _poissonOverN_(lH, 3); // P(home >= 3)
  const awayOver15 = _poissonOverN_(lA, 2);
  const awayOver25 = _poissonOverN_(lA, 3);

  // Probabilidad equipo con más tarjetas
  // Aproximación: P(home > away) para distribución Poisson bivariada independiente
  let probHomeMas = 0;
  let probAwayMas = 0;
  const maxCards = 10;
  for (let i = 0; i <= maxCards; i++) {
    for (let j = 0; j <= maxCards; j++) {
      const p = poissonPmf_(lH, i) * poissonPmf_(lA, j);
      if (i > j) probHomeMas += p;
      else if (j > i) probAwayMas += p;
    }
  }
  const probEmpateCards = Math.max(0, 1 - probHomeMas - probAwayMas);

  return {
    total: {
      over35:      pct(over35),
      under35:     pct(1 - over35),
      over45:      pct(over45),
      under45:     pct(1 - over45),
      over55:      pct(over55),
      under55:     pct(1 - over55),
      cuota_over45:  fair(over45),
      cuota_under45: fair(1 - over45),
      cuota_over35:  fair(over35),
      cuota_under35: fair(1 - over35)
    },
    home: {
      over15:      pct(homeOver15),
      under15:     pct(1 - homeOver15),
      over25:      pct(homeOver25),
      under25:     pct(1 - homeOver25),
      prob_more_cards: pct(probHomeMas)
    },
    away: {
      over15:      pct(awayOver15),
      under15:     pct(1 - awayOver15),
      over25:      pct(awayOver25),
      under25:     pct(1 - awayOver25),
      prob_more_cards: pct(probAwayMas)
    },
    prob_roja_si:       pct(pR),
    prob_roja_no:       pct(1 - pR),
    prob_empate_cards:  pct(probEmpateCards),
    lambda_home:        Math.round(lH * 100) / 100,
    lambda_away:        Math.round(lA * 100) / 100,
    lambda_total:       Math.round(lT * 100) / 100
  };
}

// ─── Guardado en hoja CardsOdds ───────────────────────────────────────────────

/**
 * Calcula y guarda las probabilidades de tarjetas para un fixture.
 * Upsert por match_key.
 *
 * @param {Object} fixture  fila de la hoja Partidos
 * @param {Object} [strengths]  resultado de buildCardsStrengths_()
 */
function saveCardsOdds_(fixture, strengths) {
  const home = teamNameToSpanish_(fixture.local     || fixture.homeTeam  || '');
  const away = teamNameToSpanish_(fixture.visitante || fixture.awayTeam  || '');
  if (!home || !away) return;

  if (!strengths) strengths = buildCardsStrengths_();

  const matchKey = fixture.match_key ||
    `${normalizeFecha_(fixture.fecha)}_${norm_(home)}_${norm_(away)}`;

  const ronda   = String(fixture.ronda || fixture.round || '');
  const pred    = predictCards_(home, away, matchKey, strengths, ronda);
  const markets = deriveCardsMarkets_(
    pred.lambdaAmarillasHome,
    pred.lambdaAmarillasAway,
    pred.lambdaTotal,
    pred.probRoja
  );

  const row = [
    matchKey,
    normalizeFecha_(fixture.fecha),
    home,
    away,
    pred.arbitro || '',
    pred.lambdaAmarillasHome,
    pred.lambdaAmarillasAway,
    pred.lambdaTotal,
    markets.total.over35,
    markets.total.over45,
    markets.total.over55,
    markets.home.over15,
    markets.away.over15,
    markets.prob_roja_si,
    markets.total.cuota_over45,
    markets.total.cuota_under45,
    nowChile_()
  ];

  const sheet  = getOrCreateSheet_(CONFIG.SHEETS.CARDS_ODDS, CARDS_HEADERS);
  const values = sheet.getDataRange().getValues();
  const mkIdx  = values[0].indexOf('match_key');
  const existing = values.slice(1).findIndex(r => r[mkIdx] === matchKey);

  if (existing >= 0) {
    sheet.getRange(existing + 2, 1, 1, row.length).setValues([row]);
  } else {
    sheet.appendRow(row);
  }
}

// ─── Recálculo masivo ─────────────────────────────────────────────────────────

/**
 * Recalcula CardsOdds para todos los partidos pendientes (status ≠ FT).
 * Llamar desde cronDailySetup.
 */
function recalcularCardsOdds(maxDias) {
  const strengths = buildCardsStrengths_();

  const hoy = Utilities.formatDate(new Date(), CONFIG.TIMEZONE, 'yyyy-MM-dd');
  const cutoff = maxDias != null
    ? Utilities.formatDate(new Date(new Date().getTime() + maxDias * 86400000), CONFIG.TIMEZONE, 'yyyy-MM-dd')
    : null;

  const todos = readAll_(CONFIG.SHEETS.PARTIDOS)
    .filter(r => {
      if (String(r.status || '').toUpperCase() === 'FT') return false;
      if (cutoff) { const f = normalizeFecha_(r.fecha); return f >= hoy && f <= cutoff; }
      return true;
    });

  Logger.log(`recalcularCardsOdds: ${todos.length} partidos pendientes${cutoff ? ' (próximos ' + maxDias + ' días)' : ''}`);

  todos.forEach(r => {
    try {
      saveCardsOdds_(r, strengths);
    } catch (e) {
      console.warn(`saveCardsOdds_ ${r.match_key}:`, e.message);
    }
    Utilities.sleep(30);
  });

  Logger.log(`recalcularCardsOdds: OK`);
}

// ─── Texto EV para Telegram ───────────────────────────────────────────────────

/**
 * Busca cuotas reales en BetfairOdds y calcula EV para los mercados de tarjetas.
 *
 * @param {string} homeTeam
 * @param {string} awayTeam
 * @returns {string}  HTML para Telegram
 */
function buildCardsEVText_(homeTeam, awayTeam) {
  const home = teamNameToSpanish_(homeTeam);
  const away = teamNameToSpanish_(awayTeam);

  // Leer datos del modelo
  let cardsRow;
  try {
    const rows = readAll_(CONFIG.SHEETS.CARDS_ODDS);
    cardsRow = rows.find(r =>
      norm_(r.local     || '').includes(norm_(home)) &&
      norm_(r.visitante || '').includes(norm_(away))
    );
  } catch (e_) {}

  if (!cardsRow) {
    return `⚠️ Sin datos de tarjetas para ${home} vs ${away}. Ejecuta recalcularCardsOdds() primero.`;
  }

  const lambdaTotal = Number(cardsRow.lambda_total || 0);
  const over45prob  = Number(cardsRow.over_4_5 || 0) / 100;
  const under45prob = 1 - over45prob;
  const probRoja    = Number(cardsRow.prob_roja_si || 0) / 100;

  const hFlag = teamFlag_(home);
  const aFlag = teamFlag_(away);

  let txt = `🟨 <b>Tarjetas — ${hFlag}${home} vs ${aFlag}${away}</b>\n\n`;
  txt += `📊 <b>Modelo:</b> λ total = <b>${lambdaTotal}</b> tarjetas esperadas\n`;
  txt += `  Local: ${cardsRow.lambda_home} · Visitante: ${cardsRow.lambda_away}\n`;
  txt += `  Árbitro: ${cardsRow.arbitro || 'No asignado'}\n\n`;

  txt += `<b>Probabilidades del modelo</b>\n`;
  txt += `  O/U 3.5 → Over ${cardsRow.over_3_5}% · Under ${(100 - Number(cardsRow.over_3_5)).toFixed(1)}%\n`;
  txt += `  O/U 4.5 → Over ${cardsRow.over_4_5}% · Under ${(100 - Number(cardsRow.over_4_5)).toFixed(1)}%\n`;
  txt += `  O/U 5.5 → Over ${cardsRow.over_5_5}% · Under ${(100 - Number(cardsRow.over_5_5)).toFixed(1)}%\n`;
  txt += `  Tarjeta roja: Sí ${cardsRow.prob_roja_si}% · No ${(100 - Number(cardsRow.prob_roja_si)).toFixed(1)}%\n\n`;

  txt += `<b>Cuotas justas (sin margen de casa)</b>\n`;
  txt += `  Over 4.5  → <b>${cardsRow.cuota_fair_over45  || 'N/A'}</b>\n`;
  txt += `  Under 4.5 → <b>${cardsRow.cuota_fair_under45 || 'N/A'}</b>\n`;

  // Buscar cuotas reales en OddsApuestas (Pinnacle vía The Odds API)
  try {
    const oddsRows = readAll_(CONFIG.SHEETS.ODDS);
    const n = s => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z]/g, '');
    const matchOdds = oddsRows.find(r =>
      n(r.home_team || r.local || '').includes(n(home)) &&
      n(r.away_team || r.visitante || '').includes(n(away))
    );
    if (matchOdds) {
      const pinnOver  = parseFloat(matchOdds.cards_over45  || matchOdds.bookmaker_cards_over  || 0);
      const pinnUnder = parseFloat(matchOdds.cards_under45 || matchOdds.bookmaker_cards_under || 0);
      if (pinnOver > 1) {
        const evOver  = bettingMetrics_(over45prob, pinnOver).ev_pct;
        const evUnder = bettingMetrics_(under45prob, pinnUnder).ev_pct;
        txt += `\n<b>EV vs mercado (O/U 4.5)</b>\n`;
        txt += `  Over  4.5 @ ${pinnOver.toFixed(2)}  → EV ${evOver  > 0 ? '✅' : '❌'} <b>${(evOver  * 100).toFixed(1)}%</b>\n`;
        txt += `  Under 4.5 @ ${pinnUnder.toFixed(2)} → EV ${evUnder > 0 ? '✅' : '❌'} <b>${(evUnder * 100).toFixed(1)}%</b>\n`;
      }
    }
  } catch (e_) {}

  txt += `\n<i>Compara las cuotas justas con las de tu casa de apuestas para detectar value.</i>`;
  return txt;
}

// ─── Comando /tarjetas ────────────────────────────────────────────────────────

/**
 * Handler principal del comando /tarjetas.
 *
 * Sin args  → Partidos de hoy con λ y mercados clave.
 * Con equipo → Historial de tarjetas del equipo.
 * Con árbitro → Historial del árbitro en el torneo.
 * Con "X vs Y" → Predicción detallada del partido.
 *
 * @param {string} args
 * @returns {string}  HTML para Telegram
 */
function buildCardsCommandText_(args) {
  const q = String(args || '').trim();

  // ── Sin argumento: resumen del día ───────────────────────────────────────
  if (!q) {
    return _buildCardsTodayText_();
  }

  // ── Partido específico: "X vs Y" ─────────────────────────────────────────
  const vsMatch = q.match(/^(.+?)\s+vs\.?\s+(.+)$/i);
  if (vsMatch) {
    return buildCardsEVText_(vsMatch[1].trim(), vsMatch[2].trim());
  }

  // ── Árbitro o equipo (heurística: si está en catálogo = árbitro) ─────────
  const qLower = q.toLowerCase();
  const esArbitro = Object.keys(REFEREE_CATALOG).some(k =>
    k.toLowerCase().includes(qLower) || qLower.includes(k.toLowerCase().split(' ')[1] || '')
  );

  if (esArbitro) {
    return _buildArbitroCardsText_(q);
  }

  // Si no, asumir equipo
  return _buildEquipoCardsText_(q);
}

/**
 * Resumen de tarjetas para los partidos de hoy.
 */
function _buildCardsTodayText_() {
  const today  = todayChile_();
  const partidos = readAll_(CONFIG.SHEETS.PARTIDOS)
    .filter(r => normalizeFecha_(r.fecha) === today &&
                 String(r.status || '').toUpperCase() !== 'FT');

  if (!partidos.length) {
    return `🟨 <b>Tarjetas hoy (${today})</b>\n\nNo hay partidos pendientes hoy.`;
  }

  const strengths = buildCardsStrengths_();

  let txt = `🟨 <b>Predicción de Tarjetas — ${today}</b>\n\n`;

  partidos.forEach(r => {
    const home = teamNameToSpanish_(r.local     || '');
    const away = teamNameToSpanish_(r.visitante || '');
    if (!home || !away) return;

    const matchKey = r.match_key ||
      `${normalizeFecha_(r.fecha)}_${norm_(home)}_${norm_(away)}`;
    const ronda = String(r.ronda || r.round || '');

    let pred, markets;
    try {
      pred    = predictCards_(home, away, matchKey, strengths, ronda);
      markets = deriveCardsMarkets_(
        pred.lambdaAmarillasHome,
        pred.lambdaAmarillasAway,
        pred.lambdaTotal,
        pred.probRoja
      );
    } catch (e_) {
      return;
    }

    const hFlag = teamFlag_(home);
    const aFlag = teamFlag_(away);
    const hora  = r.hora_chile || '';

    txt += `<b>${hFlag}${home} vs ${aFlag}${away}</b>`;
    if (hora) txt += ` (${hora})`;
    txt += `\n`;
    txt += `  Árbitro: ${pred.arbitro || '🔍 no asignado'}\n`;
    txt += `  λ: ${pred.lambdaAmarillasHome}🏠 + ${pred.lambdaAmarillasAway}✈️ = <b>${pred.lambdaTotal}</b> tarjetas\n`;
    txt += `  O/U 4.5: Over <b>${markets.total.over45}%</b> · Under ${markets.total.under45}%\n`;
    txt += `  Roja: Sí <b>${markets.prob_roja_si}%</b>\n\n`;
  });

  txt += `<i>Usa /tarjetas X vs Y para análisis EV completo.</i>`;
  return txt;
}

/**
 * Historial de tarjetas de un árbitro en el torneo.
 */
function _buildArbitroCardsText_(nombre) {
  const stats = getRefereeStats_(nombre);
  if (!stats) {
    return `🟨 No encontré datos para el árbitro: <b>${nombre}</b>\n\n` +
           `Usa /arbitros para ver la lista completa.`;
  }

  let txt = `🟨 <b>Árbitro: ${stats.nombre}</b>\n`;
  txt += `${stats.nacionalidad} · ${stats.confederacion}\n\n`;
  txt += `<b>Historial en el torneo</b>\n`;
  txt += `  Partidos: ${stats.partidos}\n`;
  txt += `  Amarillas: ${stats.amarillas} (${stats.amarillas_pp}/partido)\n`;
  txt += `  Rojas: ${stats.rojas}\n`;
  txt += `  Penales: ${stats.penales}\n`;
  txt += `  Tendencia: ${stats.tendencia === 'ESTRICTO' ? '🔴 Estricto' : stats.tendencia === 'PERMISIVO' ? '🟢 Permisivo' : '🟡 Normal'}\n\n`;

  if (stats.partidos_lista && stats.partidos_lista.length) {
    txt += `<b>Partidos arbitrados:</b>\n`;
    stats.partidos_lista.slice(0, 5).forEach(p => {
      txt += `  · ${p}\n`;
    });
  }

  return txt;
}

/**
 * Historial de tarjetas de un equipo en el torneo.
 */
function _buildEquipoCardsText_(equipo) {
  const q = norm_(equipo);

  let arbRows;
  try { arbRows = readAll_(CONFIG.SHEETS.ARBITROS); } catch (e_) { arbRows = []; }

  const filas = arbRows.filter(r =>
    norm_(r.equipo_local || '').includes(q) ||
    norm_(r.equipo_visitante || '').includes(q)
  );

  if (!filas.length) {
    return `🟨 Sin datos de tarjetas para: <b>${equipo}</b>\n\n` +
           `Los datos se acumulan a medida que se juegan partidos.`;
  }

  const nombre = teamNameToSpanish_(equipo);
  let totalAm = 0, totalRo = 0, partidos = 0;

  filas.forEach(r => {
    const am = Number(r.amarillas || 0);
    const ro = Number(r.rojas     || 0);
    // Aproximación 50/50 (no tenemos desglose por equipo en esta hoja)
    totalAm += am / 2;
    totalRo += ro / 2;
    partidos++;
  });

  const amPP = partidos ? (totalAm / partidos).toFixed(1) : '—';
  const roPP = partidos ? (totalRo / partidos).toFixed(2) : '—';

  let txt = `🟨 <b>Tarjetas — ${teamFlag_(nombre)}${nombre}</b>\n\n`;
  txt += `<b>Historial en el torneo (${partidos} partidos)</b>\n`;
  txt += `  Total amarillas: ~${totalAm.toFixed(0)} (${amPP}/partido)\n`;
  txt += `  Total rojas: ~${totalRo.toFixed(1)} (${roPP}/partido)\n`;
  txt += `  Tendencia: ${Number(amPP) >= 2.5 ? '🔴 Agresivo' : Number(amPP) <= 1.5 ? '🟢 Disciplinado' : '🟡 Normal'}\n\n`;

  txt += `<b>Partidos:</b>\n`;
  filas.slice(0, 5).forEach(r => {
    const fecha = String(r.fecha || '').substring(5, 10);
    txt += `  ${fecha} vs ${norm_(r.equipo_local || '') === q ? r.equipo_visitante : r.equipo_local}: 🟨${r.amarillas} 🟥${r.rojas}\n`;
  });

  return txt;
}
