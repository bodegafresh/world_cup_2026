/**
 * BetfairApi.gs
 *
 * Integración con Betfair Exchange para obtener cuotas reales de mercados
 * que The Odds API no cubre: Asian Handicap y Correct Score (marcador exacto).
 *
 * AUTENTICACIÓN en Google Apps Script:
 *   GAS no soporta SSL client certificates ni login interactivo.
 *   Solución: el usuario obtiene manualmente su Session Token desde
 *   Betfair Developer Tools y lo guarda en Script Properties.
 *
 * Script Properties requeridas:
 *   BETFAIR_SESSION_TOKEN  — token de sesión (expira en ~4h; keep-alive lo renueva)
 *   BETFAIR_APP_KEY        — Application Key de la cuenta Betfair
 *
 * Comisión Betfair: 5% sobre ganancias netas.
 *   cuota_efectiva = 1 + (cuota_back - 1) × 0.95
 *
 * Cache: CacheService con TTL de 15 min (precios cambian rápido, GAS no es RT).
 * Hoja: BetfairOdds — columnas definidas en BETFAIR_SHEET_COLS.
 */

// ─── Constantes ───────────────────────────────────────────────────────────────

const BETFAIR_API_BASE      = 'https://api.betfair.com/exchange/betting/json-rpc/v1';
const BETFAIR_KEEP_ALIVE    = 'https://identitysso.betfair.com/api/keepAlive';
const BETFAIR_COMMISSION    = 0.05;   // 5% comisión sobre ganancias
const BETFAIR_CACHE_TTL_S   = 900;    // 15 minutos en segundos
const BETFAIR_SHEET         = 'BetfairOdds';

// MarketTypes que buscamos en Betfair
const BETFAIR_MARKET_TYPES  = ['ASIAN_HANDICAP', 'CORRECT_SCORE', 'MATCH_ODDS'];

// Líneas de AH que calculamos EV
const AH_LINES = [-1.5, -0.5, 0, 0.5, 1.5];

// Top N correct score runners para EV
const CS_TOP_N = 5;

// ─── Autenticación ────────────────────────────────────────────────────────────

/**
 * Obtiene la Application Key de Script Properties.
 * @returns {string|null}
 */
function getBetfairAppKey_() {
  return PropertiesService.getScriptProperties().getProperty('BETFAIR_APP_KEY') || null;
}

/**
 * Obtiene el Session Token de Script Properties.
 * @returns {string|null}
 */
function getBetfairSessionToken_() {
  return PropertiesService.getScriptProperties().getProperty('BETFAIR_SESSION_TOKEN') || null;
}

/**
 * Intenta renovar el Session Token vía keep-alive de Betfair.
 * Actualiza la Script Property si tiene éxito.
 * Si falla, el token anterior sigue valiendo hasta que expire.
 *
 * @returns {boolean} true si se renovó correctamente
 */
function betfairKeepAlive_() {
  const appKey = getBetfairAppKey_();
  const token  = getBetfairSessionToken_();
  if (!appKey || !token) return false;

  try {
    const resp = UrlFetchApp.fetch(BETFAIR_KEEP_ALIVE, {
      method: 'get',
      headers: {
        'X-Authentication': token,
        'X-Application':    appKey,
        'Accept':           'application/json'
      },
      muteHttpExceptions: true
    });

    const data = JSON.parse(resp.getContentText());
    if (data.status === 'SUCCESS' && data.token) {
      PropertiesService.getScriptProperties()
        .setProperty('BETFAIR_SESSION_TOKEN', data.token);
      console.log('BetfairApi: session token renovado via keep-alive');
      return true;
    }
    console.warn('BetfairApi keep-alive: status=' + data.status);
    return false;
  } catch (e) {
    console.warn('BetfairApi keep-alive error:', e.message);
    return false;
  }
}

// ─── Core: JSON-RPC request ───────────────────────────────────────────────────

/**
 * Realiza una llamada JSON-RPC a la Betting API de Betfair.
 *
 * @param {string} method  Método de la API (ej. 'SportsAPING/v1.0/listMarketCatalogue')
 * @param {Object} params  Parámetros del método
 * @returns {*} Resultado del campo 'result' de la respuesta, o null si error
 */
function betfairRequest_(method, params) {
  const appKey = getBetfairAppKey_();
  const token  = getBetfairSessionToken_();

  if (!appKey || !token) {
    console.warn('BetfairApi: faltan BETFAIR_APP_KEY o BETFAIR_SESSION_TOKEN en Script Properties');
    return null;
  }

  const body = JSON.stringify([{
    jsonrpc: '2.0',
    method:  method,
    params:  params,
    id:      1
  }]);

  let response;
  try {
    response = UrlFetchApp.fetch(BETFAIR_API_BASE, {
      method:      'post',
      contentType: 'application/json',
      headers: {
        'X-Authentication': token,
        'X-Application':    appKey,
        'Accept':           'application/json'
      },
      payload:            body,
      muteHttpExceptions: true
    });
  } catch (e) {
    console.error('BetfairApi fetch error:', e.message);
    return null;
  }

  const status = response.getResponseCode();
  if (status === 401 || status === 403) {
    console.warn('BetfairApi: sesión expirada (HTTP ' + status + '). Renueva BETFAIR_SESSION_TOKEN.');
    betfairKeepAlive_();  // intento silencioso; si falla, el usuario debe actualizar manualmente
    return null;
  }
  if (status < 200 || status >= 300) {
    console.error('BetfairApi HTTP error ' + status + ': ' + response.getContentText().substring(0, 200));
    return null;
  }

  let parsed;
  try {
    parsed = JSON.parse(response.getContentText());
  } catch (e) {
    console.error('BetfairApi JSON parse error:', e.message);
    return null;
  }

  const rpc = Array.isArray(parsed) ? parsed[0] : parsed;
  if (rpc.error) {
    console.error('BetfairApi RPC error:', JSON.stringify(rpc.error));
    return null;
  }

  return rpc.result || null;
}

// ─── Búsqueda de eventos ──────────────────────────────────────────────────────

/**
 * Busca el event ID de Betfair para un partido.
 * Usa textQuery con el nombre del equipo local; filtra por fecha y nombres.
 *
 * @param {string} homeTeam  Nombre equipo local (en inglés preferible)
 * @param {string} awayTeam  Nombre equipo visitante
 * @param {string} date      Fecha en formato 'yyyy-MM-dd'
 * @returns {string|null} Betfair event ID o null si no se encuentra
 */
function findBetfairEventId_(homeTeam, awayTeam, date) {
  const cacheKey = 'bf_evt_' + normalizeTeamName_(homeTeam) + '_' + normalizeTeamName_(awayTeam);
  const cached = getCachedBetfair_(cacheKey);
  if (cached !== null) return cached;

  // Construir rango de fechas ±1 día para tolerar diferencias de zona horaria
  const fromDate = new Date(date);
  fromDate.setDate(fromDate.getDate() - 1);
  const toDate   = new Date(date);
  toDate.setDate(toDate.getDate() + 1);

  const params = {
    filter: {
      eventTypeIds:   ['1'],  // 1 = Soccer
      marketStartTime: {
        from: fromDate.toISOString(),
        to:   toDate.toISOString()
      },
      textQuery: homeTeam
    },
    maxResults: 50,
    locale: 'en'
  };

  const events = betfairRequest_('SportsAPING/v1.0/listEvents', params);
  if (!events || !events.length) {
    setCachedBetfair_(cacheKey, null);
    return null;
  }

  const normHome = normalizeTeamName_(homeTeam);
  const normAway = normalizeTeamName_(awayTeam);

  const match = events.find(ev => {
    const evName = normalizeTeamName_(ev.event ? ev.event.name : '');
    return evName.includes(normHome) || evName.includes(normAway);
  });

  const eventId = match ? String(match.event.id) : null;
  setCachedBetfair_(cacheKey, eventId);
  return eventId;
}

// ─── Listado de mercados ──────────────────────────────────────────────────────

/**
 * Lista los mercados disponibles para un evento de Betfair,
 * filtrando solo ASIAN_HANDICAP, CORRECT_SCORE y MATCH_ODDS.
 *
 * @param {string} eventId  Betfair event ID
 * @returns {Array} Array de { marketId, marketName, marketType } o []
 */
function fetchBetfairMarketsForEvent_(eventId) {
  if (!eventId) return [];

  const cacheKey = 'bf_mkt_' + eventId;
  const cached = getCachedBetfair_(cacheKey);
  if (cached !== null) return cached;

  const params = {
    filter: {
      eventIds:    [eventId],
      marketTypeCodes: BETFAIR_MARKET_TYPES
    },
    marketProjection: ['MARKET_NAME', 'RUNNER_DESCRIPTION'],
    maxResults: 100
  };

  const catalogue = betfairRequest_('SportsAPING/v1.0/listMarketCatalogue', params);
  if (!catalogue || !catalogue.length) {
    setCachedBetfair_(cacheKey, []);
    return [];
  }

  const markets = catalogue.map(m => ({
    marketId:   m.marketId,
    marketName: m.marketName,
    marketType: m.description ? m.description.marketType : '',
    runners:    (m.runners || []).map(r => ({
      selectionId: r.selectionId,
      runnerName:  r.runnerName
    }))
  }));

  setCachedBetfair_(cacheKey, markets);
  return markets;
}

// ─── Obtención de precios ─────────────────────────────────────────────────────

/**
 * Obtiene el best back price para cada runner de un mercado.
 *
 * @param {string} marketId  Betfair market ID
 * @returns {Array} Array de { selectionId, bestBackPrice, runnerStatus } o []
 */
function fetchBetfairOdds_(marketId) {
  if (!marketId) return [];

  const cacheKey = 'bf_odds_' + marketId;
  const cached = getCachedBetfair_(cacheKey);
  if (cached !== null) return cached;

  const params = {
    marketIds:    [marketId],
    priceProjection: {
      priceData:         ['EX_BEST_OFFERS'],
      exBestOffersOverrides: {
        bestPricesDepth:  1,
        rollupModel:      'STAKE',
        rollupLimit:      10
      },
      virtualise: false
    },
    orderProjection:  'ALL',
    matchProjection:  'NO_ROLLUP'
  };

  const books = betfairRequest_('SportsAPING/v1.0/listMarketBook', params);
  if (!books || !books.length) {
    setCachedBetfair_(cacheKey, []);
    return [];
  }

  const book    = books[0];
  const runners = (book.runners || []).map(r => {
    const backs = (r.ex && r.ex.availableToBack) || [];
    const best  = backs.length ? Number(backs[0].price) : null;
    return {
      selectionId:    r.selectionId,
      bestBackPrice:  best,
      runnerStatus:   r.status
    };
  });

  setCachedBetfair_(cacheKey, runners);
  return runners;
}

// ─── API de cuotas por mercado ────────────────────────────────────────────────

/**
 * Obtiene cuotas de Asian Handicap de Betfair para un partido.
 * Devuelve objeto { runners: [{name, handicap, backPrice, effectiveOdds}] }
 * o null si no hay datos o sesión inválida.
 *
 * @param {string} homeTeam
 * @param {string} awayTeam
 * @param {string} date  'yyyy-MM-dd'
 * @returns {Object|null}
 */
function getBetfairAHOdds_(homeTeam, awayTeam, date) {
  const eventId = findBetfairEventId_(homeTeam, awayTeam, date);
  if (!eventId) return null;

  const markets = fetchBetfairMarketsForEvent_(eventId);
  const ahMarkets = markets.filter(m =>
    String(m.marketType).toUpperCase() === 'ASIAN_HANDICAP' ||
    String(m.marketName).toUpperCase().includes('ASIAN')
  );

  if (!ahMarkets.length) return null;

  const results = [];

  ahMarkets.forEach(mkt => {
    const priceRows = fetchBetfairOdds_(mkt.marketId);

    mkt.runners.forEach(runner => {
      const priceRow = priceRows.find(p => p.selectionId === runner.selectionId);
      if (!priceRow || !priceRow.bestBackPrice) return;

      const backPrice      = priceRow.bestBackPrice;
      const effectiveOdds  = applyBetfairCommission_(backPrice);

      // Parsear nombre del runner para extraer la línea AH
      const handicap = parseAHHandicap_(runner.runnerName, homeTeam, awayTeam);

      results.push({
        marketId:     mkt.marketId,
        runnerName:   runner.runnerName,
        handicap:     handicap,
        backPrice:    backPrice,
        effectiveOdds: effectiveOdds,
        selectionId:  runner.selectionId
      });
    });
  });

  return results.length ? { eventId, marketType: 'ASIAN_HANDICAP', runners: results } : null;
}

/**
 * Obtiene cuotas de Correct Score de Betfair para un partido.
 *
 * @param {string} homeTeam
 * @param {string} awayTeam
 * @param {string} date  'yyyy-MM-dd'
 * @returns {Object|null}
 */
function getBetfairCorrectScoreOdds_(homeTeam, awayTeam, date) {
  const eventId = findBetfairEventId_(homeTeam, awayTeam, date);
  if (!eventId) return null;

  const markets = fetchBetfairMarketsForEvent_(eventId);
  const csMarket = markets.find(m =>
    String(m.marketType).toUpperCase() === 'CORRECT_SCORE' ||
    String(m.marketName).toUpperCase().includes('CORRECT SCORE')
  );

  if (!csMarket) return null;

  const priceRows = fetchBetfairOdds_(csMarket.marketId);
  if (!priceRows.length) return null;

  const results = [];

  csMarket.runners.forEach(runner => {
    const priceRow = priceRows.find(p => p.selectionId === runner.selectionId);
    if (!priceRow || !priceRow.bestBackPrice) return;

    const backPrice     = priceRow.bestBackPrice;
    const effectiveOdds = applyBetfairCommission_(backPrice);

    results.push({
      marketId:     csMarket.marketId,
      runnerName:   runner.runnerName,
      score:        runner.runnerName,  // ej. "0 - 0", "1 - 0", etc.
      backPrice:    backPrice,
      effectiveOdds: effectiveOdds,
      selectionId:  runner.selectionId
    });
  });

  // Ordenar por cuota menor (más probable primero)
  results.sort((a, b) => a.backPrice - b.backPrice);

  return results.length ? { eventId, marketType: 'CORRECT_SCORE', runners: results } : null;
}

// ─── Guardado en hoja BetfairOdds ────────────────────────────────────────────

/**
 * Descarga y guarda en BetfairOdds las cuotas de AH y Correct Score
 * para un fixture dado.
 *
 * Columnas de BetfairOdds:
 *   match_key, fecha, local, visitante, market_type, runner_name,
 *   back_price, effective_odds, betfair_event_id, betfair_market_id, updated_at
 *
 * @param {Object} fixture  Objeto mínimo con { local, visitante, fecha, match_key }
 *                          o fila de la hoja Partidos
 * @returns {number} Filas guardadas
 */
function saveBetfairOddsForMatch_(fixture) {
  const homeTeam = fixture.local  || fixture.home_team || '';
  const awayTeam = fixture.visitante || fixture.away_team || '';
  const date     = fixture.fecha  || fixture.date || todayChile_();
  const matchKey = fixture.match_key ||
    normalizeTeamName_(homeTeam) + '_vs_' + normalizeTeamName_(awayTeam);

  if (!homeTeam || !awayTeam) {
    console.warn('saveBetfairOddsForMatch_: faltan homeTeam o awayTeam');
    return 0;
  }

  const now       = new Date().toISOString();
  const ahData    = getBetfairAHOdds_(homeTeam, awayTeam, date);
  const csData    = getBetfairCorrectScoreOdds_(homeTeam, awayTeam, date);
  let   saved     = 0;

  const eventId = (ahData && ahData.eventId) || (csData && csData.eventId) || '';

  // Obtener filas existentes para upsert
  let existing = [];
  try { existing = readAll_(BETFAIR_SHEET); } catch (e) { existing = []; }

  /**
   * Upsert de una fila: si ya existe (match_key + market_type + runner_name) → update,
   * sino → append.
   */
  function upsertRunner_(rowData) {
    const idx = existing.findIndex(r =>
      String(r.match_key   || '') === rowData.match_key &&
      String(r.market_type || '') === rowData.market_type &&
      String(r.runner_name || '') === rowData.runner_name
    );
    if (idx >= 0) {
      updateRow_(BETFAIR_SHEET, idx, rowData);
    } else {
      appendRow_(BETFAIR_SHEET, rowData);
      existing.push(rowData);  // mantener índice actualizado
    }
    saved++;
  }

  // Guardar Asian Handicap
  if (ahData && ahData.runners) {
    ahData.runners.forEach(r => {
      upsertRunner_({
        match_key:         matchKey,
        fecha:             date,
        local:             homeTeam,
        visitante:         awayTeam,
        market_type:       'ASIAN_HANDICAP',
        runner_name:       r.runnerName,
        handicap:          r.handicap !== null ? r.handicap : '',
        back_price:        r.backPrice,
        effective_odds:    r.effectiveOdds,
        betfair_event_id:  eventId,
        betfair_market_id: r.marketId,
        updated_at:        now
      });
    });
  }

  // Guardar Correct Score
  if (csData && csData.runners) {
    csData.runners.forEach(r => {
      upsertRunner_({
        match_key:         matchKey,
        fecha:             date,
        local:             homeTeam,
        visitante:         awayTeam,
        market_type:       'CORRECT_SCORE',
        runner_name:       r.runnerName,
        handicap:          '',
        back_price:        r.backPrice,
        effective_odds:    r.effectiveOdds,
        betfair_event_id:  eventId,
        betfair_market_id: r.marketId,
        updated_at:        now
      });
    });
  }

  console.log(`saveBetfairOddsForMatch_ ${matchKey}: ${saved} filas guardadas`);
  return saved;
}

// ─── EV con cuotas de Betfair ─────────────────────────────────────────────────

/**
 * Calcula EV para mercados de Betfair (AH y Correct Score) cruzando con Poisson.
 *
 * @param {string} homeTeam
 * @param {string} awayTeam
 * @param {string} matchKey
 * @returns {Array} Oportunidades con mismo formato que calculateEvForFixture_:
 *   [{ mercado, seleccion, prob_modelo, cuota, ev, edge, kelly, source }]
 */
function calculateBetfairEV_(homeTeam, awayTeam, matchKey) {
  const opportunities = [];

  // 1. Obtener probabilidades Poisson
  let poisson = null;
  try { poisson = getPoissonOdds_(homeTeam, awayTeam, matchKey); } catch (e_) {}

  if (!poisson) {
    console.warn('calculateBetfairEV_: sin datos Poisson para ' + homeTeam + ' vs ' + awayTeam);
    return [];
  }

  // También obtenemos la distribución completa para AH y Correct Score exactos
  let markets = null;
  try {
    markets = poissonPredictMarkets_(homeTeam, awayTeam);
  } catch (e_) {
    console.warn('calculateBetfairEV_: no se pudo calcular poissonPredictMarkets_:', e_.message);
  }

  // 2. Leer cuotas Betfair desde la hoja
  let betfairRows = [];
  try {
    betfairRows = readAll_(BETFAIR_SHEET).filter(r =>
      String(r.match_key || '') === String(matchKey || '') ||
      (normalizeTeamName_(r.local || '') === normalizeTeamName_(homeTeam) &&
       normalizeTeamName_(r.visitante || '') === normalizeTeamName_(awayTeam))
    );
  } catch (e) {
    console.warn('calculateBetfairEV_ readAll error:', e.message);
    return [];
  }

  if (!betfairRows.length) return [];

  // 3. Función interna de EV
  function evCalc_(probModelo, cuota) {
    if (!probModelo || !cuota || cuota <= 1) return null;
    const ev     = parseFloat(((probModelo * cuota) - 1).toFixed(4));
    const impl   = parseFloat((1 / cuota).toFixed(4));
    const edge   = parseFloat((probModelo - impl).toFixed(4));
    const kellyR = (probModelo * cuota - 1) / (cuota - 1);
    const kelly  = parseFloat((Math.max(0, Math.min(kellyR / KELLY_DIVISOR, KELLY_MAX_FRACTION))).toFixed(4));
    return { ev, edge, kelly, impl };
  }

  // 4. Procesar AH runners
  betfairRows
    .filter(r => String(r.market_type || '') === 'ASIAN_HANDICAP')
    .forEach(r => {
      const cuota      = parseFloat(r.effective_odds || 0);
      const runnerName = String(r.runner_name || '');
      const handicap   = parseFloat(r.handicap);

      if (!cuota || !runnerName) return;

      // Obtener probabilidad Poisson para esta línea AH
      let probModelo = null;
      if (markets && markets.asian_handicap) {
        const normHome = normalizeTeamName_(homeTeam);
        const isHomeRunner = normalizeTeamName_(runnerName).includes(normHome.split(' ')[0]);

        if (!isNaN(handicap)) {
          const ahKey = isHomeRunner ? handicap : -handicap;
          // markets.asian_handicap es un objeto keyed por línea
          const ahEntry = markets.asian_handicap[String(ahKey)] ||
                          markets.asian_handicap[String(ahKey.toFixed(1))];
          if (ahEntry) {
            probModelo = isHomeRunner ? ahEntry.home : ahEntry.away;
          }
        }
      }

      if (!probModelo) return;

      const calc = evCalc_(probModelo, cuota);
      if (!calc) return;

      if (calc.ev > EV_POSITIVE_THRESHOLD) {
        opportunities.push({
          mercado:      'Asian Handicap',
          seleccion:    runnerName,
          handicap:     isNaN(handicap) ? '' : handicap,
          prob_modelo:  parseFloat(probModelo.toFixed(4)),
          prob_impl:    calc.impl,
          cuota:        cuota,
          cuota_raw:    parseFloat(r.back_price || 0),
          ev:           calc.ev,
          edge:         calc.edge,
          kelly:        calc.kelly,
          source:       'betfair_exchange',
          market_type:  'ASIAN_HANDICAP',
          betfair_market_id: r.betfair_market_id || ''
        });
      }
    });

  // 5. Procesar Correct Score runners
  const csRows = betfairRows.filter(r => String(r.market_type || '') === 'CORRECT_SCORE');
  const csRowsSorted = [...csRows].sort((a, b) =>
    parseFloat(a.back_price || 999) - parseFloat(b.back_price || 999)
  );
  const topCS = csRowsSorted.slice(0, CS_TOP_N * 3);  // tomar más candidatos para filtrar por EV+

  topCS.forEach(r => {
    const cuota      = parseFloat(r.effective_odds || 0);
    const scoreName  = String(r.runner_name || '');
    if (!cuota || !scoreName) return;

    // Parsear "1 - 0" → {home: 1, away: 0}
    const scoreMatch = scoreName.match(/(\d+)\s*[-–]\s*(\d+)/);
    if (!scoreMatch) return;

    const homeGoals = parseInt(scoreMatch[1]);
    const awayGoals = parseInt(scoreMatch[2]);

    // Obtener probabilidad Poisson para este marcador exacto
    let probModelo = null;
    if (markets && markets.correct_scores) {
      const scoreKey = `${homeGoals}-${awayGoals}`;
      const altKey   = `${homeGoals}_${awayGoals}`;
      probModelo = markets.correct_scores[scoreKey] ||
                  markets.correct_scores[altKey] ||
                  null;
    }

    // Fallback: calcular directamente si tenemos lambdas
    if (!probModelo && poisson && poisson.lambda_home && poisson.lambda_away) {
      const lh = parseFloat(poisson.lambda_home);
      const la = parseFloat(poisson.lambda_away);
      if (lh > 0 && la > 0) {
        probModelo = poissonPmf_(lh, homeGoals) * poissonPmf_(la, awayGoals);
      }
    }

    if (!probModelo || probModelo < 0.001) return;

    const calc = evCalc_(probModelo, cuota);
    if (!calc) return;

    if (calc.ev > EV_POSITIVE_THRESHOLD) {
      opportunities.push({
        mercado:      'Correct Score',
        seleccion:    scoreName,
        prob_modelo:  parseFloat(probModelo.toFixed(5)),
        prob_impl:    calc.impl,
        cuota:        cuota,
        cuota_raw:    parseFloat(r.back_price || 0),
        ev:           calc.ev,
        edge:         calc.edge,
        kelly:        calc.kelly,
        source:       'betfair_exchange',
        market_type:  'CORRECT_SCORE',
        betfair_market_id: r.betfair_market_id || ''
      });
    }
  });

  // Ordenar por EV descendente
  opportunities.sort((a, b) => b.ev - a.ev);
  return opportunities;
}

// ─── Texto para bot Telegram ──────────────────────────────────────────────────

/**
 * Construye el texto para el bot Telegram con oportunidades EV+ de Betfair.
 * Muestra AH EV+ y Correct Score EV+.
 *
 * @param {string} homeTeam
 * @param {string} awayTeam
 * @param {string} [matchKey]  Opcional, para búsqueda directa en hoja
 * @returns {string}
 */
function buildBetfairEVText_(homeTeam, awayTeam, matchKey) {
  const hFlag = teamFlag_(homeTeam);
  const aFlag = teamFlag_(awayTeam);
  const hName = teamNameToSpanish_(homeTeam);
  const aName = teamNameToSpanish_(awayTeam);

  const appKey = getBetfairAppKey_();
  const token  = getBetfairSessionToken_();
  if (!appKey || !token) {
    return `⚠️ *Betfair Exchange no configurado*\n` +
           `Agrega BETFAIR_APP_KEY y BETFAIR_SESSION_TOKEN en Script Properties.`;
  }

  const key = matchKey ||
    normalizeTeamName_(homeTeam) + '_vs_' + normalizeTeamName_(awayTeam);

  const opps = calculateBetfairEV_(homeTeam, awayTeam, key);

  if (!opps.length) {
    return `📊 *Betfair Exchange — ${hFlag} ${hName} vs ${aFlag} ${aName}*\n` +
           `Sin oportunidades EV+ en AH o Correct Score (umbral 5%).`;
  }

  const lines = [`📊 *Betfair Exchange EV+* | ${hFlag} ${hName} vs ${aFlag} ${aName}\n`];

  const ahOpps = opps.filter(o => o.market_type === 'ASIAN_HANDICAP');
  const csOpps = opps.filter(o => o.market_type === 'CORRECT_SCORE');

  if (ahOpps.length) {
    lines.push('🏷 *Asian Handicap*');
    ahOpps.slice(0, 5).forEach(o => {
      const evPct   = (o.ev * 100).toFixed(1);
      const edgePct = (o.edge * 100).toFixed(1);
      const kellyPct = (o.kelly * 100).toFixed(1);
      lines.push(
        `  • ${o.seleccion}` +
        ` | Cuota: \`${o.cuota.toFixed(2)}\` (raw ${o.cuota_raw.toFixed(2)})` +
        ` | EV: *+${evPct}%* | Edge: ${edgePct}%` +
        ` | Kelly: ${kellyPct}%`
      );
    });
    lines.push('');
  }

  if (csOpps.length) {
    lines.push('🎯 *Correct Score*');
    csOpps.slice(0, CS_TOP_N).forEach(o => {
      const evPct   = (o.ev * 100).toFixed(1);
      const probPct = (o.prob_modelo * 100).toFixed(1);
      lines.push(
        `  • ${o.seleccion}` +
        ` | Cuota: \`${o.cuota.toFixed(1)}\`` +
        ` | P(Poisson): ${probPct}%` +
        ` | EV: *+${evPct}%*`
      );
    });
    lines.push('');
  }

  lines.push(`_Cuotas efectivas con comisión 5% Betfair. No financiero._`);
  return lines.join('\n');
}

// ─── Backfill manual ─────────────────────────────────────────────────────────

/**
 * Rellena cuotas Betfair para partidos pendientes (sin datos en BetfairOdds).
 * Útil para correr manualmente antes de un bloque de partidos.
 *
 * Lee partidos de la hoja Partidos con status NS (not started) y fecha = hoy o mañana.
 * Para cada uno llama saveBetfairOddsForMatch_.
 *
 * @returns {Object} { procesados, guardados, errores }
 */
function backfillBetfairOdds() {
  const appKey = getBetfairAppKey_();
  const token  = getBetfairSessionToken_();
  if (!appKey || !token) {
    console.warn('backfillBetfairOdds: faltan credenciales Betfair');
    return { procesados: 0, guardados: 0, errores: ['Sin credenciales'] };
  }

  const hoy     = todayChile_();
  const manana  = tomorrowChile_();

  let partidos = [];
  try {
    partidos = readAll_(CONFIG.SHEETS.PARTIDOS).filter(r => {
      const fecha  = String(r.fecha || '').substring(0, 10);
      const status = String(r.status || '').toUpperCase();
      return (fecha === hoy || fecha === manana) && status === 'NS';
    });
  } catch (e) {
    console.error('backfillBetfairOdds readAll error:', e.message);
    return { procesados: 0, guardados: 0, errores: [e.message] };
  }

  let procesados = 0, guardados = 0;
  const errores  = [];

  partidos.forEach(fixture => {
    try {
      const saved = saveBetfairOddsForMatch_(fixture);
      guardados += saved;
      procesados++;
      Utilities.sleep(300);  // respetar rate limits de Betfair
    } catch (e) {
      const key = fixture.match_key || (fixture.local + ' vs ' + fixture.visitante);
      console.warn('backfillBetfairOdds error en ' + key + ':', e.message);
      errores.push(key + ': ' + e.message);
    }
  });

  const msg = `backfillBetfairOdds: ${procesados} partidos, ${guardados} filas guardadas, ${errores.length} errores`;
  console.log(msg);
  return { procesados, guardados, errores };
}

// ─── Helpers de comisión y parsing ───────────────────────────────────────────

/**
 * Aplica la comisión del 5% de Betfair sobre las ganancias.
 * cuota_efectiva = 1 + (cuota_back - 1) × (1 - BETFAIR_COMMISSION)
 *
 * @param {number} backPrice  Cuota decimal del best back
 * @returns {number} Cuota efectiva redondeada a 3 decimales
 */
function applyBetfairCommission_(backPrice) {
  if (!backPrice || backPrice <= 1) return backPrice;
  return parseFloat((1 + (backPrice - 1) * (1 - BETFAIR_COMMISSION)).toFixed(3));
}

/**
 * Parsea el nombre de un runner de Asian Handicap para extraer la línea.
 * Ejemplos de nombres Betfair AH: "Argentina -0.5", "France +1.5", "Brazil 0"
 *
 * @param {string} runnerName
 * @param {string} homeTeam
 * @param {string} awayTeam
 * @returns {number|null} Línea AH desde la perspectiva del runner (negativo = favorito)
 */
function parseAHHandicap_(runnerName, homeTeam, awayTeam) {
  if (!runnerName) return null;
  // Buscar patrón de número con signo opcional al final del nombre
  const match = runnerName.match(/([+-]?\d+\.?\d*)$/);
  if (!match) return null;
  return parseFloat(match[1]);
}

// ─── Cache con CacheService ───────────────────────────────────────────────────

/**
 * Lee un valor del cache de Betfair (CacheService, TTL 15 min).
 * @param {string} key
 * @returns {*} Valor parseado, null si no existe o expiró
 */
function getCachedBetfair_(key) {
  try {
    const raw = CacheService.getScriptCache().get('bf_' + key);
    if (raw === null) return null;
    return JSON.parse(raw);
  } catch (e) {
    return null;
  }
}

/**
 * Guarda un valor en el cache de Betfair.
 * @param {string} key
 * @param {*} value  Debe ser JSON-serializable
 */
function setCachedBetfair_(key, value) {
  try {
    const serialized = JSON.stringify(value);
    // CacheService tiene límite de 100KB por entrada
    if (serialized.length > 90000) {
      console.warn('setCachedBetfair_: valor demasiado grande para cache (' + key + ')');
      return;
    }
    CacheService.getScriptCache().put('bf_' + key, serialized, BETFAIR_CACHE_TTL_S);
  } catch (e) {
    console.warn('setCachedBetfair_ error:', e.message);
  }
}

// ─── Setup / diagnóstico ──────────────────────────────────────────────────────

/**
 * Verifica la configuración de Betfair y prueba la conexión.
 * Ejecutar manualmente para diagnosticar problemas de auth.
 *
 * @returns {Object} Estado de la configuración
 */
function diagnoseBetfairSetup() {
  const appKey = getBetfairAppKey_();
  const token  = getBetfairSessionToken_();

  const status = {
    tiene_app_key:    !!appKey,
    tiene_token:      !!token,
    keep_alive_ok:    false,
    test_event_ok:    false,
    mensaje:          ''
  };

  if (!appKey || !token) {
    status.mensaje = 'Configura BETFAIR_APP_KEY y BETFAIR_SESSION_TOKEN en Script Properties';
    Logger.log(JSON.stringify(status, null, 2));
    return status;
  }

  // Test keep-alive
  status.keep_alive_ok = betfairKeepAlive_();

  // Test búsqueda de evento simple
  try {
    const testParams = {
      filter: { eventTypeIds: ['1'], marketStartTime: {
        from: new Date().toISOString(),
        to:   new Date(Date.now() + 7 * 86400000).toISOString()
      }},
      maxResults: 1
    };
    const events = betfairRequest_('SportsAPING/v1.0/listEvents', testParams);
    status.test_event_ok = Array.isArray(events) && events.length > 0;
    if (status.test_event_ok) {
      status.primer_evento = events[0].event ? events[0].event.name : '?';
    }
  } catch (e) {
    status.test_event_error = e.message;
  }

  status.mensaje = status.test_event_ok
    ? 'Betfair API operativa'
    : 'Error conectando a Betfair (revisa el token)';

  Logger.log(JSON.stringify(status, null, 2));
  return status;
}

/**
 * Imprime instrucciones para obtener el Session Token de Betfair.
 * Ejecutar si no sabes cómo configurarlo.
 */
function printBetfairSetupInstructions() {
  const instrucciones = [
    '=== CONFIGURACIÓN BETFAIR EXCHANGE ===',
    '',
    '1. Ve a https://developer.betfair.com y logéate con tu cuenta Betfair',
    '2. En "My Account" → "API Access" → crea una Application Key (tipo "Delayed" es gratis)',
    '3. Copia el valor de "Application Key" → Script Property: BETFAIR_APP_KEY',
    '',
    '4. Para el Session Token (modo sin certificados):',
    '   a. Ve a https://identitysso.betfair.com/api/login?username=TU_USER&password=TU_PASS',
    '   b. O usa el endpoint: POST https://identitysso.betfair.com/api/certlogin (requiere cert)',
    '   c. Alternativa más fácil: usa el Betfair API Demo Tool en developer.betfair.com',
    '      → "Betting API" → "Login" → copia el sessionToken de la respuesta',
    '   d. Guarda el token en Script Property: BETFAIR_SESSION_TOKEN',
    '',
    '5. Los tokens expiran en ~4h. La función betfairKeepAlive_() los renueva automáticamente',
    '   si se llama antes de que expiren.',
    '',
    '6. Ejecuta diagnoseBetfairSetup() para verificar que todo funciona.',
    '',
    'NOTA: Betfair cobra 5% de comisión sobre ganancias netas.',
    'Las cuotas efectivas ya incluyen este descuento en los cálculos de EV.'
  ].join('\n');

  Logger.log(instrucciones);
  return instrucciones;
}

/**
 * Crea la hoja BetfairOdds con sus headers si no existe.
 * Ejecutar una sola vez al configurar el sistema.
 */
function setupBetfairOddsSheet() {
  const ss = SpreadsheetApp.openById(getSpreadsheetId_());
  let sheet = ss.getSheetByName(BETFAIR_SHEET);

  if (sheet) {
    Logger.log('La hoja ' + BETFAIR_SHEET + ' ya existe');
    return;
  }

  sheet = ss.insertSheet(BETFAIR_SHEET);

  const headers = [
    'match_key', 'fecha', 'local', 'visitante',
    'market_type', 'runner_name', 'handicap',
    'back_price', 'effective_odds',
    'betfair_event_id', 'betfair_market_id',
    'updated_at'
  ];

  sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  sheet.getRange(1, 1, 1, headers.length).setFontWeight('bold');
  sheet.setFrozenRows(1);

  // Formato de columnas numéricas
  sheet.getRange('G:G').setNumberFormat('0.00');   // handicap
  sheet.getRange('H:H').setNumberFormat('0.000');  // back_price
  sheet.getRange('I:I').setNumberFormat('0.000');  // effective_odds

  Logger.log('✅ Hoja ' + BETFAIR_SHEET + ' creada con ' + headers.length + ' columnas');
}
