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

  // Usa versión enriquecida que también extrae Pinnacle como línea de referencia
  return parseOddsEventWithPinnacle_(event);
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
    upsertOddsToSheet_(fresh);
  }

  return fresh;
}

/**
 * Verifica si existen odds frescos en la hoja OddsApuestas para un partido.
 * "Fresco" = updated_at hace menos de 4 horas.
 *
 * @param {string} matchKey - Identificador del partido (match_key o fixture_id)
 * @returns {Object|null} La fila de OddsApuestas si está fresca, null si no
 */
function getSheetOddsIfFresh_(matchKey) {
  if (!matchKey) return null;
  const FRESH_HOURS = 4;
  try {
    const rows = readAll_('OddsApuestas');
    const now = Date.now();
    const row = rows.find(r => {
      const key = String(r.match_key || r.fixture_id || '');
      return key === String(matchKey);
    });
    if (!row) return null;
    const updatedAt = row.updated_at ? new Date(row.updated_at).getTime() : 0;
    const ageHours = (now - updatedAt) / 3600000;
    return ageHours < FRESH_HOURS ? row : null;
  } catch (e) {
    console.warn('getSheetOddsIfFresh_ error:', e.message);
    return null;
  }
}

/**
 * Upsert de eventos de odds en la hoja OddsApuestas.
 * Si ya existe una fila con el mismo match_key → update; si no → append.
 *
 * @param {Array} events - Array de eventos de The Odds API
 */
function upsertOddsToSheet_(events) {
  if (!events || !events.length) return;
  const sheetName = 'OddsApuestas';
  try {
    const existing = readAll_(sheetName);
    const now = new Date().toISOString();
    events.forEach(ev => {
      const matchKey = `${normalizeTeamName_(ev.home_team)}_vs_${normalizeTeamName_(ev.away_team)}`;
      const parsed = parseOddsEventWithPinnacle_(ev);
      if (!parsed) return;
      const rowData = {
        match_key:           matchKey,
        fixture_id:          ev.id || '',
        home_team:           ev.home_team || '',
        away_team:           ev.away_team || '',
        commence_time:       ev.commence_time || '',
        fuente:              'THE_ODDS_API',
        prob_local:          parsed.prob_local,
        prob_empate:         parsed.prob_empate,
        prob_visitante:      parsed.prob_visitante,
        odd_local:           parsed.odd_local,
        odd_empate:          parsed.odd_empate,
        odd_visitante:       parsed.odd_visitante,
        over25_prob:         parsed.over25_prob,
        btts_prob:           parsed.btts_prob,
        bookmakers_count:    parsed.bookmakers_count,
        pinnacle_prob_local:     parsed.pinnacle_prob_local,
        pinnacle_prob_empate:    parsed.pinnacle_prob_empate,
        pinnacle_prob_visitante: parsed.pinnacle_prob_visitante,
        pinnacle_vig:            parsed.pinnacle_vig,
        tiene_pinnacle:          parsed.tiene_pinnacle,
        updated_at:          now
      };
      const idx = existing.findIndex(r =>
        String(r.match_key || r.fixture_id || '') === matchKey ||
        (ev.id && String(r.fixture_id || '') === String(ev.id))
      );
      if (idx >= 0) {
        updateRow_(sheetName, idx, rowData);
      } else {
        appendRow_(sheetName, rowData);
      }
    });
  } catch (e) {
    console.warn('upsertOddsToSheet_ error:', e.message);
  }
}

function fetchAllOddsFromApi_() {
  const key = getTheOddsApiKey_();

  if (!key) {
    console.warn('THE_ODDS_API_KEY no configurada');
    return null;
  }

  // Use only h2h+totals to avoid 422 when bookmakers don't offer all markets
  const markets = 'h2h,totals';
  const params = [
    `apiKey=${key}`,
    `regions=${CONFIG.THE_ODDS_API.REGIONS}`,
    `markets=${markets}`,
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
 * Extrae las cuotas de Pinnacle (bookmaker de referencia, menor margen del mercado).
 * Pinnacle es la fuente más precisa para estimar probabilidades "reales" implícitas.
 * Si Pinnacle no está disponible en la respuesta, devuelve null.
 *
 * @param {Array} bookmakers  - array de bookmakers del evento (The Odds API)
 * @returns {Object|null} { prob_local, prob_empate, prob_visitante, vig } o null
 */
function extractPinnacleOdds_(bookmakers) {
  const pinnacle = (bookmakers || []).find(bk =>
    String(bk.key || '').toLowerCase().includes('pinnacle') ||
    String(bk.title || '').toLowerCase().includes('pinnacle')
  );

  if (!pinnacle) return null;

  const h2h = (pinnacle.markets || []).find(m => m.key === 'h2h');
  if (!h2h) return null;

  const outcomes  = h2h.outcomes || [];
  const drawEntry = outcomes.find(o => o.name === 'Draw');
  const nonDraw   = outcomes.filter(o => o.name !== 'Draw');

  if (nonDraw.length < 2) return null;

  const homeOdd = Number(nonDraw[0].price);
  const awayOdd = Number(nonDraw[1].price);
  const drawOdd = drawEntry ? Number(drawEntry.price) : null;

  const probs = vigRemoval_(homeOdd, drawOdd, awayOdd);
  if (!probs) return null;

  const vig = (1 / homeOdd + 1 / awayOdd + (drawOdd ? 1 / drawOdd : 0)) - 1;

  return {
    prob_local:     probs.home,
    prob_empate:    probs.draw,
    prob_visitante: probs.away,
    odd_local:      homeOdd,
    odd_empate:     drawOdd,
    odd_visitante:  awayOdd,
    vig:            parseFloat(vig.toFixed(4))
  };
}

/**
 * Versión enriquecida de parseOddsEvent_ que también extrae Pinnacle como línea de referencia.
 * Si Pinnacle no está disponible, los campos pinnacle_* quedan en null.
 */
function parseOddsEventWithPinnacle_(event) {
  const base = parseOddsEvent_(event);
  if (!base) return null;

  const pinnacle = extractPinnacleOdds_(event.bookmakers || []);

  return {
    ...base,
    pinnacle_prob_local:     pinnacle ? pinnacle.prob_local     : null,
    pinnacle_prob_empate:    pinnacle ? pinnacle.prob_empate    : null,
    pinnacle_prob_visitante: pinnacle ? pinnacle.prob_visitante : null,
    pinnacle_vig:            pinnacle ? pinnacle.vig            : null,
    tiene_pinnacle:          !!pinnacle
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

// ── Diagnóstico The Odds API ───────────────────────────────────────────────────
function diagnosticarOdds() {
  const results = [];

  // 1. Verificar clave en Script Properties
  const key = getTheOddsApiKey_();
  if (!key) {
    results.push('❌ THE_ODDS_API_KEY no está configurada en Script Properties');
    results.push('   → Ve a Apps Script → Proyecto → Propiedades del script → Agrega THE_ODDS_API_KEY');
    Logger.log(results.join('\n'));
    return;
  }
  results.push(`✅ Clave configurada: ${key.substring(0,6)}...${key.slice(-4)}`);

  // 2. Verificar sport_key activo
  const sportKey = CONFIG.THE_ODDS_API.SPORT_KEY;
  results.push(`ℹ️  Sport key: ${sportKey}`);

  // 3. Cuántas filas hay en OddsApuestas
  try {
    const rows = readAll_(CONFIG.SHEETS.ODDS);
    results.push(`ℹ️  OddsApuestas tiene ${rows.length} fila(s)`);
    if (rows.length > 0) {
      results.push(`   Primera: ${rows[0].home_team || ''} vs ${rows[0].away_team || ''} (${rows[0].updated_at || ''})`);
    }
  } catch(e) {
    results.push(`⚠️  Error leyendo OddsApuestas: ${e.message}`);
  }

  // 4. Cuántas filas en EvOpportunities
  try {
    const evRows = readAll_(CONFIG.SHEETS.EV_OPPORTUNITIES);
    results.push(`ℹ️  EvOpportunities tiene ${evRows.length} fila(s)`);
  } catch(e) {
    results.push(`⚠️  Error leyendo EvOpportunities: ${e.message}`);
  }

  // 5. Llamada de prueba a la API
  results.push('🔄 Llamando a The Odds API...');
  try {
    const url = `${CONFIG.THE_ODDS_API.BASE_URL}/sports/${sportKey}/odds/?apiKey=${key}&regions=eu&markets=h2h&oddsFormat=decimal`;
    const resp = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
    const code = resp.getResponseCode();
    results.push(`   HTTP ${code}`);
    if (code === 200) {
      const data = JSON.parse(resp.getContentText());
      results.push(`✅ API OK — ${data.length} evento(s) devuelto(s)`);
      if (data.length > 0) {
        results.push(`   Primero: ${data[0].home_team} vs ${data[0].away_team} (${data[0].commence_time})`);
        results.push('   → Corre cronDailySetup() o calcularEV() para poblar OddsApuestas y EvOpportunities');
      } else {
        results.push('⚠️  La API devolvió 0 eventos. Posibles causas:');
        results.push('   - sport_key incorrecto (prueba "soccer_fifa_world_cup_2026" o consulta /v4/sports)');
        results.push('   - Partidos fuera del rango de cuotas (solo 1-2 días adelante)');
      }
    } else if (code === 401) {
      results.push('❌ API key inválida o sin saldo');
    } else if (code === 422) {
      results.push('❌ sport_key no reconocido por la API. Prueba listar sports:');
      results.push('   → Corre: listarSportsOddsAPI()');
    } else {
      results.push(`❌ Error: ${resp.getContentText().substring(0,200)}`);
    }
  } catch(e) {
    results.push(`❌ Error de red: ${e.message}`);
  }

  Logger.log(results.join('\n'));
  return results.join('\n');
}

function listarSportsOddsAPI() {
  const key = getTheOddsApiKey_();
  if (!key) { Logger.log('THE_ODDS_API_KEY no configurada'); return; }
  const resp = UrlFetchApp.fetch(`${CONFIG.THE_ODDS_API.BASE_URL}/sports/?apiKey=${key}`, { muteHttpExceptions: true });
  const data = JSON.parse(resp.getContentText());
  const soccer = (Array.isArray(data) ? data : []).filter(s => s.key && s.key.includes('soccer'));
  Logger.log('Sports de fútbol disponibles:\n' + soccer.map(s => `${s.key} — ${s.title}`).join('\n'));
}
