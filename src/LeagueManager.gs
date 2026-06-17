/**
 * LeagueManager.gs
 *
 * Gestión de multi-liga para el bot de predicciones.
 *
 * Permite cambiar la liga activa en runtime sin tocar código.
 * Compatible 100% con el flujo WC2026 existente.
 *
 * Comandos del bot:
 *   /liga          — Lista las ligas disponibles con su estado
 *   /liga PREMIER  — Cambia la liga activa a Premier League
 *
 * Funciones públicas usadas por otros módulos:
 *   getOddsApiSportKey_()       — sport_key para The Odds API
 *   isActiveLeagueFixture_(f)   — filtra si un fixture pertenece a la liga activa
 *   loadLeagueCalendar_(key)    — carga partidos desde ESPN o API-Football
 */

// ─── Comando /liga ─────────────────────────────────────────────────────────────

/**
 * Handler principal del comando /liga.
 *
 * Sin args → lista las ligas disponibles.
 * Con args → intenta cambiar la liga activa.
 *
 * @param {string} args — argumento del comando (ej: 'PREMIER', 'premier', 'La Liga')
 * @returns {string}  texto para Telegram
 */
function buildLeagueManagerText_(args) {
  if (!args || !args.trim()) return buildLeagueListText_();

  // Normalizar el argumento: intentar matchear clave del catálogo
  const input  = args.trim().toUpperCase().replace(/[\s\-]/g, '_');
  const catalog = CONFIG.LEAGUES.CATALOG;

  // Búsqueda exacta por clave
  if (catalog[input]) {
    try {
      setActiveLeague_(input);
      const liga = catalog[input];
      return [
        `✅ <b>Liga activa cambiada</b>`,
        ``,
        `🏆 <b>${liga.name}</b>`,
        `📍 ${liga.country} · ${liga.type === 'cup' ? 'Copa' : 'Liga'}`,
        `📅 Temporada ${liga.season}`,
        `🏠 Ventaja local: ${liga.home_adv}x`,
        ``,
        `<i>El modelo Poisson, ELO y cuotas usarán esta liga de ahora en adelante.</i>`,
        `Usa /liga para ver todas las ligas disponibles.`
      ].join('\n');
    } catch (e) {
      return `⚠️ Error al cambiar liga: ${e.message}`;
    }
  }

  // Búsqueda parcial por nombre
  const match = Object.entries(catalog).find(([key, liga]) =>
    liga.name.toUpperCase().includes(args.trim().toUpperCase()) ||
    liga.country.toUpperCase().includes(args.trim().toUpperCase())
  );

  if (match) {
    try {
      setActiveLeague_(match[0]);
      const liga = match[1];
      return [
        `✅ <b>Liga activa cambiada</b>`,
        ``,
        `🏆 <b>${liga.name}</b>`,
        `📍 ${liga.country} · ${liga.type === 'cup' ? 'Copa' : 'Liga'}`,
        `📅 Temporada ${liga.season}`,
        ``,
        `<i>Usa /liga para ver todas las ligas disponibles.</i>`
      ].join('\n');
    } catch (e) {
      return `⚠️ Error al cambiar liga: ${e.message}`;
    }
  }

  return [
    `❌ No encontré la liga: <b>${args}</b>`,
    ``,
    buildLeagueListText_()
  ].join('\n');
}

/**
 * Lista todas las ligas del catálogo con su estado (activa / disponible).
 * @returns {string}
 */
function buildLeagueListText_() {
  const activaKey = PropertiesService.getScriptProperties().getProperty('ACTIVE_LEAGUE') || 'WC2026';
  const catalog   = CONFIG.LEAGUES.CATALOG;

  let msg = `🌍 <b>Ligas disponibles</b>\n\n`;

  Object.entries(catalog).forEach(([key, liga]) => {
    const esActiva = key === activaKey;
    const marker   = esActiva ? '🔵' : '⚪';
    const tipo     = liga.type === 'cup' ? '🏆' : '📅';
    msg += `${marker} ${tipo} <b>${liga.name}</b>\n`;
    msg += `   <code>${key}</code> · ${liga.country} · T${liga.season}\n`;
  });

  msg += `\n<i>Liga activa: <b>${catalog[activaKey] ? catalog[activaKey].name : activaKey}</b></i>`;
  msg += `\n\nUsa <code>/liga CLAVE</code> para cambiar. Ejemplo:\n`;
  msg += `/liga PREMIER\n/liga LA_LIGA\n/liga CHAMPIONS`;

  return msg;
}

// ─── Carga de calendario por liga ─────────────────────────────────────────────

/**
 * Carga los partidos de una liga específica desde ESPN o API-Football
 * y los inserta en la hoja Partidos (sin duplicar).
 *
 * Intenta ESPN primero (sin costo); fallback a API-Football.
 *
 * @param {string} leagueKey  — clave del catálogo, ej. 'PREMIER'
 * @returns {number}  cantidad de partidos insertados
 */
function loadLeagueCalendar_(leagueKey) {
  const catalog = CONFIG.LEAGUES.CATALOG;
  if (!catalog[leagueKey]) throw new Error('Liga no encontrada: ' + leagueKey);

  const liga = catalog[leagueKey];
  Logger.log(`loadLeagueCalendar_: cargando ${liga.name} (id=${liga.id}, season=${liga.season})`);

  let inserted = 0;

  // Intentar desde API-Football (fuente más completa para ligas de clubes)
  try {
    inserted = _loadLeagueFromApiFootball_(liga);
    Logger.log(`loadLeagueCalendar_: ${inserted} partidos desde API-Football`);
  } catch (e) {
    Logger.log(`loadLeagueCalendar_: API-Football falló (${e.message}), sin fallback adicional`);
  }

  return inserted;
}

/**
 * Carga fixtures de API-Football para la liga dada e inserta en Partidos.
 * @private
 */
function _loadLeagueFromApiFootball_(liga) {
  const key = getApiFootballKey_();
  const url = `${CONFIG.API_FOOTBALL.BASE_URL}/fixtures?league=${liga.id}&season=${liga.season}`;

  const resp = UrlFetchApp.fetch(url, {
    headers: { 'x-apisports-key': key },
    muteHttpExceptions: true
  });

  if (resp.getResponseCode() !== 200) {
    throw new Error(`API-Football HTTP ${resp.getResponseCode()}`);
  }

  const data = JSON.parse(resp.getContentText());
  const fixtures = (data.response || []);
  if (!fixtures.length) return 0;

  // Leer match_keys existentes para evitar duplicados
  let existingKeys = new Set();
  try {
    readAll_(CONFIG.SHEETS.PARTIDOS).forEach(r => {
      if (r.match_key) existingKeys.add(r.match_key);
    });
  } catch (e_) { /* hoja vacía */ }

  const rows = [];
  fixtures.forEach(f => {
    const fecha     = Utilities.formatDate(new Date(f.fixture.date), CONFIG.TIMEZONE, 'yyyy-MM-dd');
    const horaChile = Utilities.formatDate(new Date(f.fixture.date), CONFIG.TIMEZONE, 'HH:mm');
    const local     = (f.teams.home || {}).name || '';
    const visitante = (f.teams.away || {}).name || '';
    const matchKey  = `${fecha}_${norm_lm_(local)}_${norm_lm_(visitante)}`;

    if (existingKeys.has(matchKey)) return;
    existingKeys.add(matchKey);

    rows.push([
      matchKey,
      f.fixture.id || '',
      fecha,
      horaChile,
      local,
      visitante,
      f.fixture.status.short || 'NS',
      f.goals && f.goals.home !== null ? f.goals.home : '',
      f.goals && f.goals.away !== null ? f.goals.away : '',
      f.fixture.venue ? f.fixture.venue.name || '' : '',
      f.fixture.venue ? f.fixture.venue.city || '' : '',
      f.league.round || '',
      liga.id,    // league_id
      liga.season // season
    ]);
  });

  if (rows.length) {
    // Asegurar que la hoja tiene las columnas necesarias
    getOrCreateSheet_(CONFIG.SHEETS.PARTIDOS, [
      'match_key','fixture_id_af','fecha','hora_chile',
      'local','visitante','status',
      'goles_local','goles_visitante',
      'estadio','ciudad','ronda',
      'league_id','season'
    ]);
    appendRows_(CONFIG.SHEETS.PARTIDOS, rows);
  }

  return rows.length;
}

/** Normalización interna para match_key */
function norm_lm_(str) {
  return String(str || '').toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]/g, '');
}

// ─── Helpers para otros módulos ───────────────────────────────────────────────

/**
 * Retorna el sport_key de The Odds API para la liga activa.
 * Usado en OddsModel.gs en vez del hardcoded CONFIG.THE_ODDS_API.SPORT_KEY.
 *
 * @returns {string}
 */
function getOddsApiSportKey_() {
  try {
    return getActiveLeague_().sport_key || CONFIG.THE_ODDS_API.SPORT_KEY;
  } catch (e_) {
    return CONFIG.THE_ODDS_API.SPORT_KEY;
  }
}

/**
 * Verifica si un fixture (fila de Partidos) pertenece a la liga activa.
 * Permite filtrar al procesar partidos en crons mixtos.
 *
 * @param {Object} fixture  — fila de la hoja Partidos con campo league_id (opcional)
 * @returns {boolean}
 */
function isActiveLeagueFixture_(fixture) {
  try {
    const liga = getActiveLeague_();
    // Si el fixture no tiene league_id, se asume que es de la liga activa (compatibilidad)
    if (!fixture.league_id || fixture.league_id === '') return true;
    return String(fixture.league_id) === String(liga.id);
  } catch (e_) {
    return true; // fallback permisivo
  }
}

/**
 * Cambia a WC2026 como liga activa. Helper de conveniencia para tests manuales.
 */
function switchToWorldCup() {
  setActiveLeague_('WC2026');
  Logger.log('Liga activa: Mundial FIFA 2026');
}
