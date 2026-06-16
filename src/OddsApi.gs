/**
 * OddsApi.gs
 *
 * Integración con The Odds API (free tier: 500 req/mes).
 * Obtiene cuotas reales 1X2, Over/Under 2.5 y Ambos Anotan
 * para partidos del Mundial 2026.
 *
 * No requiere llamada por fixture: trae todos los eventos del torneo
 * en una sola request y los cachea en Drive para evitar gastar cuota.
 */

const ODDS_CACHE_TTL_HOURS = 6;

/**
 * Devuelve las cuotas para un fixture dado (homeTeam, awayTeam).
 * Primero intenta Drive cache; si expiró o no existe, llama la API.
 *
 * @param {string} homeTeam - Nombre del equipo local
 * @param {string} awayTeam - Nombre del equipo visitante
 * @returns {Object|null} odds object { prob_local, prob_empate, prob_visitante, over25_prob, btts_prob, source, bookmakers_count } o null si no hay datos
 */
function fetchOddsForMatch_(homeTeam, awayTeam) {
  const allOdds = getAllOddsFromCacheOrApi_();

  if (!allOdds || !allOdds.length) return null;

  const event = findMatchingOddsEvent_(allOdds, homeTeam, awayTeam);

  if (!event) return null;

  return parseOddsEvent_(event);
}

/**
 * Obtiene todos los eventos del torneo con cuotas.
 * Lee de cache en Drive si está vigente (< ODDS_CACHE_TTL_HOURS).
 */
function getAllOddsFromCacheOrApi_() {
  const cacheKey = 'odds_all_events';
  const cached = readOddsCache_(cacheKey);

  if (cached) return cached;

  const fresh = fetchAllOddsFromApi_();

  if (fresh && fresh.length) {
    writeOddsCache_(cacheKey, fresh);
  }

  return fresh;
}

function fetchAllOddsFromApi_() {
  const key = getTheOddsApiKey_();

  if (!key) {
    console.warn('THE_ODDS_API_KEY no configurada');
    return null;
  }

  const params = [
    `apiKey=${key}`,
    `regions=${CONFIG.THE_ODDS_API.REGIONS}`,
    `markets=${CONFIG.THE_ODDS_API.MARKETS}`,
    `oddsFormat=${CONFIG.THE_ODDS_API.ODDS_FORMAT}`
  ].join('&');

  const url = `${CONFIG.THE_ODDS_API.BASE_URL}/sports/${CONFIG.THE_ODDS_API.SPORT_KEY}/odds/?${params}`;

  let response;
  try {
    response = UrlFetchApp.fetch(url, {
      method: 'get',
      muteHttpExceptions: true
    });
  } catch (e) {
    console.error('Error llamando The Odds API:', e.message);
    return null;
  }

  const status = response.getResponseCode();

  if (status === 422) {
    console.warn('The Odds API: torneo sin odds disponibles todavía (422)');
    return [];
  }

  if (status < 200 || status >= 300) {
    console.error(`The Odds API error ${status}: ${response.getContentText()}`);
    return null;
  }

  const remaining = response.getHeaders()['x-requests-remaining'];
  if (remaining !== undefined) {
    console.log(`The Odds API — requests restantes este mes: ${remaining}`);
  }

  const data = JSON.parse(response.getContentText());
  return Array.isArray(data) ? data : [];
}

/**
 * Busca el evento que corresponde al partido local vs visitante.
 * Normaliza nombres para tolerancia a diferencias menores (ej. "Korea" vs "South Korea").
 */
function findMatchingOddsEvent_(events, homeTeam, awayTeam) {
  const normHome = normalizeTeamName_(homeTeam);
  const normAway = normalizeTeamName_(awayTeam);

  return events.find(ev => {
    const evHome = normalizeTeamName_(ev.home_team || '');
    const evAway = normalizeTeamName_(ev.away_team || '');

    return (evHome === normHome && evAway === normAway) ||
           (evHome === normAway && evAway === normHome);
  }) || null;
}

/**
 * Convierte un evento de The Odds API al schema interno de probabilidades.
 */
function parseOddsEvent_(event) {
  const bookmakers = event.bookmakers || [];

  const h2xOdds = extractMarketOdds_(bookmakers, 'h2h');
  const totalsOdds = extractTotalsOdds_(bookmakers);
  const bttsOdds = extractBttsOdds_(bookmakers);

  if (!h2xOdds) return null;

  const isHomeFirst = normalizeTeamName_(event.home_team) === normalizeTeamName_(h2xOdds.outcomes[0].name);

  const homeOutcome = isHomeFirst ? h2xOdds.outcomes[0] : h2xOdds.outcomes[2];
  const drawOutcome = h2xOdds.outcomes.find(o => o.name === 'Draw') || null;
  const awayOutcome = isHomeFirst ? h2xOdds.outcomes[2] : h2xOdds.outcomes[0];

  const homeOdd  = homeOutcome ? Number(homeOutcome.price) : null;
  const drawOdd  = drawOutcome ? Number(drawOutcome.price) : null;
  const awayOdd  = awayOutcome ? Number(awayOutcome.price) : null;

  const probs1X2 = vigRemoval_(homeOdd, drawOdd, awayOdd);

  return {
    prob_local:      probs1X2 ? probs1X2.home : null,
    prob_empate:     probs1X2 ? probs1X2.draw : null,
    prob_visitante:  probs1X2 ? probs1X2.away : null,
    odd_local:       homeOdd,
    odd_empate:      drawOdd,
    odd_visitante:   awayOdd,
    over25_prob:     totalsOdds ? totalsOdds.over : null,
    btts_prob:       bttsOdds ? bttsOdds.yes : null,
    source:          'the-odds-api',
    bookmakers_count: bookmakers.length
  };
}

/**
 * Extrae el mercado 1X2 (h2h) promediando todos los bookmakers.
 */
function extractMarketOdds_(bookmakers, marketKey) {
  const markets = [];

  bookmakers.forEach(bk => {
    const market = (bk.markets || []).find(m => m.key === marketKey);
    if (market) markets.push(market);
  });

  if (!markets.length) return null;

  const outcomeMap = {};
  markets.forEach(m => {
    (m.outcomes || []).forEach(o => {
      if (!outcomeMap[o.name]) outcomeMap[o.name] = [];
      outcomeMap[o.name].push(Number(o.price));
    });
  });

  const outcomes = Object.keys(outcomeMap).map(name => ({
    name,
    price: outcomeMap[name].reduce((a, b) => a + b, 0) / outcomeMap[name].length
  }));

  return { outcomes };
}

/**
 * Extrae Over 2.5 promediando bookmakers.
 */
function extractTotalsOdds_(bookmakers) {
  const markets = [];

  bookmakers.forEach(bk => {
    const market = (bk.markets || []).find(m => m.key === 'totals');
    if (market) markets.push(market);
  });

  if (!markets.length) return null;

  const overPrices = [];

  markets.forEach(m => {
    (m.outcomes || []).forEach(o => {
      if (o.name === 'Over' && o.point === 2.5) {
        overPrices.push(Number(o.price));
      }
    });
  });

  if (!overPrices.length) return null;

  const avgOver = overPrices.reduce((a, b) => a + b, 0) / overPrices.length;
  const avgUnder = 1 / (1 - 1 / avgOver);

  const total = 1 / avgOver + 1 / avgUnder;

  return {
    over: parseFloat((1 / avgOver / total).toFixed(4)),
    under: parseFloat((1 / avgUnder / total).toFixed(4))
  };
}

/**
 * Extrae Ambos Anotan (btts) promediando bookmakers.
 */
function extractBttsOdds_(bookmakers) {
  const markets = [];

  bookmakers.forEach(bk => {
    const market = (bk.markets || []).find(m => m.key === 'btts');
    if (market) markets.push(market);
  });

  if (!markets.length) return null;

  const yesPrices = [];
  const noPrices = [];

  markets.forEach(m => {
    (m.outcomes || []).forEach(o => {
      if (o.name === 'Yes') yesPrices.push(Number(o.price));
      if (o.name === 'No') noPrices.push(Number(o.price));
    });
  });

  if (!yesPrices.length) return null;

  const avgYes = yesPrices.reduce((a, b) => a + b, 0) / yesPrices.length;
  const avgNo = noPrices.length
    ? noPrices.reduce((a, b) => a + b, 0) / noPrices.length
    : null;

  const total = 1 / avgYes + (avgNo ? 1 / avgNo : 0);

  return {
    yes: parseFloat((1 / avgYes / (total || 1)).toFixed(4)),
    no:  avgNo ? parseFloat((1 / avgNo / total).toFixed(4)) : null
  };
}

/**
 * Convierte cuotas decimales a probabilidades sin vig (juice).
 * prob_i = (1/odd_i) / sum(1/odd_j)
 */
function vigRemoval_(homeOdd, drawOdd, awayOdd) {
  if (!homeOdd || !awayOdd) return null;

  const implHome = 1 / homeOdd;
  const implDraw = drawOdd ? 1 / drawOdd : 0;
  const implAway = 1 / awayOdd;

  const total = implHome + implDraw + implAway;

  return {
    home: parseFloat((implHome / total).toFixed(4)),
    draw: drawOdd ? parseFloat((implDraw / total).toFixed(4)) : null,
    away: parseFloat((implAway / total).toFixed(4))
  };
}

/**
 * Normaliza nombre de equipo para matching tolerante.
 */
function normalizeTeamName_(name) {
  return String(name || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// ─── Cache en Drive ────────────────────────────────────────────────────────────

function readOddsCache_(key) {
  try {
    const folder = getDriveCacheFolder_();
    const files = folder.getFilesByName(`${key}.json`);

    if (!files.hasNext()) return null;

    const file = files.next();
    const modified = file.getLastUpdated();
    const ageHours = (Date.now() - modified.getTime()) / 3600000;

    if (ageHours > ODDS_CACHE_TTL_HOURS) return null;

    const content = JSON.parse(file.getBlob().getDataAsString());
    return content;
  } catch (e) {
    console.warn('readOddsCache_ error:', e.message);
    return null;
  }
}

function writeOddsCache_(key, data) {
  try {
    const folder = getDriveCacheFolder_();
    const files = folder.getFilesByName(`${key}.json`);

    const blob = Utilities.newBlob(JSON.stringify(data), 'application/json', `${key}.json`);

    if (files.hasNext()) {
      files.next().setContent(JSON.stringify(data));
    } else {
      folder.createFile(blob);
    }
  } catch (e) {
    console.warn('writeOddsCache_ error:', e.message);
  }
}

function getDriveCacheFolder_() {
  const rawFolder = DriveApp.getFolderById(getRawFolderId_());
  const name = 'odds_cache';

  const existing = rawFolder.getFoldersByName(name);

  if (existing.hasNext()) return existing.next();

  return rawFolder.createFolder(name);
}
