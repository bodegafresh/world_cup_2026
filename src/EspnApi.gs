/**
 * EspnApi.gs
 *
 * Integración con la API pública no oficial de ESPN (sin autenticación).
 * Provee estadísticas avanzadas de partido, forma reciente de equipos
 * y validación de marcadores — datos que API-Football y football-data.org
 * no entregan en el plan gratuito.
 *
 * Endpoints usados:
 *   /scoreboard?dates=YYYYMMDD  → lista de partidos del día con IDs ESPN
 *   /summary?event={id}         → stats completas + forma + H2H
 *
 * Sin límite de cuota conocido. Todas las llamadas incluyen un
 * User-Agent de navegador para evitar bloqueos.
 */

const ESPN_BASE_URL = 'https://site.api.espn.com/apis/site/v2/sports/soccer/fifa.world';
const ESPN_CACHE_TTL_HOURS = 4;

// ─── Fetch básico ──────────────────────────────────────────────────────────────

function espnGet_(path) {
  const url = `${ESPN_BASE_URL}${path}`;
  const response = UrlFetchApp.fetch(url, {
    muteHttpExceptions: true,
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; GoogleAppsScript)' }
  });

  if (response.getResponseCode() !== 200) {
    throw new Error(`ESPN ${path} → HTTP ${response.getResponseCode()}`);
  }

  return JSON.parse(response.getContentText());
}

// ─── Eventos por fecha ─────────────────────────────────────────────────────────

/**
 * Devuelve lista de partidos ESPN para una fecha dada.
 * @param {string} date - 'yyyy-MM-dd'
 * @returns {Array<{espn_id, home_team, away_team, home_score, away_score, status, attendance}>}
 */
function fetchEspnEventsByDate_(date) {
  const dateStr = date.replace(/-/g, '');
  const data    = espnGet_(`/scoreboard?dates=${dateStr}`);
  const events  = data.events || [];

  return events.map(e => {
    const comp  = (e.competitions || [])[0] || {};
    const comps = comp.competitors || [];
    const home  = comps.find(c => c.homeAway === 'home') || comps[0] || {};
    const away  = comps.find(c => c.homeAway === 'away') || comps[1] || {};

    return {
      espn_id:     e.id,
      date:        date,
      home_team:   (home.team || {}).displayName || '',
      away_team:   (away.team || {}).displayName || '',
      home_score:  home.score || '0',
      away_score:  away.score || '0',
      status:      ((comp.status || {}).type || {}).shortDetail || '',
      attendance:  comp.attendance || 0
    };
  });
}

// ─── Resumen completo de partido ───────────────────────────────────────────────

/**
 * Devuelve el resumen completo de un evento ESPN.
 * Incluye stats, forma últimos 5, H2H, rosters, odds.
 * @param {string} espnId
 * @returns {Object} datos crudos ESPN summary
 */
function fetchEspnSummary_(espnId) {
  return espnGet_(`/summary?event=${espnId}`);
}

// ─── Helpers de extracción ─────────────────────────────────────────────────────

/**
 * Extrae estadísticas de equipo del boxscore ESPN.
 * Devuelve un objeto plano con todos los valores numéricos.
 */
function parseEspnTeamStats_(teamEntry) {
  const result = {};
  (teamEntry.statistics || []).forEach(s => {
    result[s.name] = parseFloat(s.displayValue) || 0;
  });
  return result;
}

/**
 * Extrae datos de forma (últimos 5 partidos) para un equipo desde summary.
 * @param {Array} lastFiveGames - array por equipo de ESPN summary.lastFiveGames
 * @param {string} espnTeamId
 * @returns {{ resultados: string, rivales: string, marcadores: string }}
 */
function parseEspnTeamForm_(lastFiveGames, espnTeamId) {
  const teamEntry = (lastFiveGames || []).find(t =>
    String((t.team || {}).id) === String(espnTeamId)
  );

  if (!teamEntry) return null;

  const events  = (teamEntry.events || []).slice(0, 5);
  const results = [];
  const rivals  = [];
  const scores  = [];

  events.forEach(ev => {
    const isHome = String(ev.homeTeamId) === String(espnTeamId);
    const myScore  = isHome ? ev.homeTeamScore  : ev.awayTeamScore;
    const oppScore = isHome ? ev.awayTeamScore  : ev.homeTeamScore;
    const opponent = (ev.opponent || {}).displayName || '?';

    const myGoals  = parseInt(myScore  || 0);
    const oppGoals = parseInt(oppScore || 0);

    let r = 'D';
    if      (myGoals > oppGoals)  r = 'W';
    else if (myGoals < oppGoals)  r = 'L';

    results.push(r);
    rivals.push(opponent);
    scores.push(`${myGoals}-${oppGoals}`);
  });

  return {
    resultados: results.join(','),
    rivales:    rivals.join(','),
    marcadores: scores.join(',')
  };
}

/**
 * Busca el ESPN event ID que corresponde a un fixture de nuestra data,
 * usando matching por nombres de equipo en la lista de eventos del día.
 *
 * @param {string} date
 * @param {string} homeTeam - nombre equipo local (nuestro sistema)
 * @param {string} awayTeam - nombre equipo visitante
 * @returns {string|null} espn_id o null si no se encontró
 */
function findEspnEventId_(date, homeTeam, awayTeam) {
  let espnEvents;
  try {
    espnEvents = fetchEspnEventsByDate_(date);
  } catch (e) {
    console.warn(`findEspnEventId_ fetch error: ${e.message}`);
    return null;
  }

  const normStr = s => String(s || '').toLowerCase()
    .replace(/[áàä]/g,'a').replace(/[éèë]/g,'e').replace(/[íìï]/g,'i')
    .replace(/[óòö]/g,'o').replace(/[úùü]/g,'u').replace(/ñ/g,'n')
    .replace(/[^a-z0-9 ]/g, '').trim();

  const h = normStr(homeTeam);
  const a = normStr(awayTeam);

  for (const ev of espnEvents) {
    const eh = normStr(ev.home_team);
    const ea = normStr(ev.away_team);

    if (
      (eh.includes(h) || h.includes(eh)) &&
      (ea.includes(a) || a.includes(ea))
    ) return ev.espn_id;

    // Intento inverso (por si home/away están invertidos)
    if (
      (eh.includes(a) || a.includes(eh)) &&
      (ea.includes(h) || h.includes(ea))
    ) return ev.espn_id;
  }

  return null;
}
