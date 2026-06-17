/**
 * Arbitros.gs
 *
 * Gestión de árbitros del Mundial 2026.
 *
 * Fuentes:
 *  - fixture.fixture.referee (string "Nombre, País") de API-Football
 *  - REFEREE_CATALOG: catálogo manual con nacionalidad y confederación
 *
 * Hoja Arbitros (una fila por partido arbitrado):
 *   arbitro_id | nombre | nacionalidad | confederacion |
 *   fixture_id | fecha | equipo_local | equipo_visitante | ronda |
 *   amarillas | rojas | penales | updated_at
 *
 * Uso en proyecciones:
 *  - Árbitros estrictos → más tarjetas → mayor riesgo de suspensión
 *  - Mayor tasa de penales → afecta over/under
 *  - Se incluye en el contexto de buildEnrichedPreviewInput_
 */

// ─── Catálogo manual (FIFA WC 2026) ──────────────────────────────────────────
// API-Football solo da el nombre; la nacionalidad viene de aquí.
// Agregar árbitros a medida que aparezcan en los fixtures.

const REFEREE_CATALOG = {
  'Szymon Marciniak':      { nacionalidad: 'Poland',      confederacion: 'UEFA' },
  'Daniele Orsato':        { nacionalidad: 'Italy',        confederacion: 'UEFA' },
  'Clement Turpin':        { nacionalidad: 'France',       confederacion: 'UEFA' },
  'Antonio Mateu Lahoz':   { nacionalidad: 'Spain',        confederacion: 'UEFA' },
  'Slavko Vincic':         { nacionalidad: 'Slovenia',     confederacion: 'UEFA' },
  'Felix Zwayer':          { nacionalidad: 'Germany',      confederacion: 'UEFA' },
  'Istvan Kovacs':         { nacionalidad: 'Romania',      confederacion: 'UEFA' },
  'Ivan Barton':           { nacionalidad: 'El Salvador',  confederacion: 'CONCACAF' },
  'César Arturo Ramos':    { nacionalidad: 'Mexico',       confederacion: 'CONCACAF' },
  'Janny Sikazwe':         { nacionalidad: 'Zambia',       confederacion: 'CAF' },
  'Abdulrahman Al-Jassim': { nacionalidad: 'Qatar',        confederacion: 'AFC' },
  'Ma Ning':               { nacionalidad: 'China',        confederacion: 'AFC' },
  'Facundo Tello':         { nacionalidad: 'Argentina',    confederacion: 'CONMEBOL' },
  'Wilton Sampaio':        { nacionalidad: 'Brazil',       confederacion: 'CONMEBOL' },
  'Piero Maza':            { nacionalidad: 'Chile',        confederacion: 'CONMEBOL' },
  'Raphael Claus':         { nacionalidad: 'Brazil',       confederacion: 'CONMEBOL' },
  'Said Martinez':         { nacionalidad: 'Honduras',     confederacion: 'CONCACAF' },
  'Bakary Gassama':        { nacionalidad: 'Gambia',       confederacion: 'CAF' },
  'Victor Gomes':          { nacionalidad: 'South Africa', confederacion: 'CAF' },
  'Mustapha Ghorbal':      { nacionalidad: 'Algeria',      confederacion: 'CAF' },
  'Alireza Faghani':       { nacionalidad: 'Australia',    confederacion: 'AFC' },
  'Ryuji Sato':            { nacionalidad: 'Japan',        confederacion: 'AFC' },
  'Chris Beath':           { nacionalidad: 'Australia',    confederacion: 'OFC' },
  'Mohammed Abdulla':      { nacionalidad: 'UAE',          confederacion: 'AFC' }
};

const ARBITRO_HEADERS = [
  'arbitro_id', 'nombre', 'nacionalidad', 'confederacion',
  'fixture_id', 'fecha', 'equipo_local', 'equipo_visitante', 'ronda',
  'amarillas', 'rojas', 'penales', 'updated_at'
];

// ─── Extracción desde fixture ─────────────────────────────────────────────────

/**
 * Extrae el nombre del árbitro del objeto fixture de API-Football.
 * El campo viene como "Nombre Apellido, País" o solo "Nombre Apellido".
 */
function extractRefereeFromFixture_(fixture) {
  const raw = String(fixture.fixture.referee || '').trim();
  if (!raw) return null;

  // Quitar la parte ", País" si viene incluida
  const nombre = raw.includes(',') ? raw.split(',')[0].trim() : raw;
  return nombre || null;
}

/**
 * Busca info del árbitro en el catálogo.
 * Hace matching flexible (incluye, no exact).
 */
function getRefereeInfo_(nombre) {
  if (!nombre) return { nacionalidad: 'Desconocida', confederacion: 'Desconocida' };

  const key = Object.keys(REFEREE_CATALOG).find(k =>
    k.toLowerCase().includes(nombre.toLowerCase()) ||
    nombre.toLowerCase().includes(k.toLowerCase())
  );

  return key ? REFEREE_CATALOG[key] : { nacionalidad: 'Desconocida', confederacion: 'Desconocida' };
}

// ─── Guardado en hoja ─────────────────────────────────────────────────────────

/**
 * Guarda el árbitro de un fixture junto con los eventos de tarjetas y penales.
 * Llamar desde loadWorldCupDay_ después de guardar eventos.
 */
function saveRefereeForFixture_(fixture, events) {
  const nombre = extractRefereeFromFixture_(fixture);
  if (!nombre) return;

  const fixtureId = String(fixture.fixture.id);

  // Dedup: no guardar si ya existe esta combinación arbitro+fixture
  try {
    const existing = readAll_(CONFIG.SHEETS.ARBITROS).find(
      r => String(r.fixture_id) === fixtureId
    );
    if (existing) return;
  } catch (e) { /* hoja no existe aún */ }

  const info = getRefereeInfo_(nombre);

  // Contar tarjetas y penales desde los eventos del partido
  const amarillas = events.filter(ev => ev.type === 'Card' && ev.detail === 'Yellow Card').length;
  const rojas     = events.filter(ev => ev.type === 'Card' && (ev.detail === 'Red Card' || ev.detail === 'Second Yellow card')).length;
  const penales   = events.filter(ev => ev.type === 'Goal' && ev.detail === 'Penalty').length;

  const arbitroId = hash_(nombre);
  const fecha     = String(fixture.fixture.date || '').substring(0, 10);

  getOrCreateSheet_(CONFIG.SHEETS.ARBITROS, ARBITRO_HEADERS);
  appendRows_(CONFIG.SHEETS.ARBITROS, [[
    arbitroId,
    nombre,
    info.nacionalidad,
    info.confederacion,
    fixtureId,
    fecha,
    safe_(fixture.teams.home.name),
    safe_(fixture.teams.away.name),
    safe_(fixture.league.round),
    amarillas,
    rojas,
    penales,
    nowChile_()
  ]]);
}

/**
 * Guarda el árbitro de un partido usando datos del ESPN summary.
 * Alternativa a saveRefereeForFixture_ cuando no hay objeto API-Football.
 *
 * @param {string} fakeId    - fixture_id a usar (ej: 'espn_12345')
 * @param {string} fecha     - 'yyyy-MM-dd'
 * @param {string} homeTeam  - nombre en español
 * @param {string} awayTeam  - nombre en español
 * @param {string} ronda     - ronda del partido (ej: 'Grupo A')
 * @param {Object} summary   - respuesta cruda de fetchEspnSummary_
 */
function saveRefereeFromEspnSummary_(fakeId, fecha, homeTeam, awayTeam, ronda, summary) {
  // Extraer árbitro de summary.header.competitions[0].officials
  let nombre = '';
  try {
    const comp = ((summary.header || {}).competitions || [])[0] || {};
    const officials = comp.officials || [];
    const ref = officials.find(o => {
      const pos = String((o.position || {}).displayName || o.position || '').toLowerCase();
      return pos.includes('referee') || pos === 'referee';
    }) || officials[0];
    if (ref) {
      const names = ref.names || ref.officials || [];
      nombre = names.length ? (names[0].displayName || names[0].shortName || '') : (ref.displayName || '');
    }
  } catch(e_) { return; }

  if (!nombre) return;

  // Dedup por fakeId
  try {
    const existing = readAll_(CONFIG.SHEETS.ARBITROS).find(r => String(r.fixture_id) === fakeId);
    if (existing) return;
  } catch(e_) {}

  // Contar tarjetas desde summary.plays o summary.scoringPlays (ESPN)
  let amarillas = 0, rojas = 0, penales = 0;
  try {
    const plays = summary.plays || summary.keyEvents || [];
    plays.forEach(p => {
      const type = String(p.type && (p.type.text || p.type.id) || '').toLowerCase();
      if (type.includes('yellow card')) amarillas++;
      else if (type.includes('red card')) rojas++;
      else if (type.includes('penalty')) penales++;
    });
  } catch(e_) {}

  const info = getRefereeInfo_(nombre);
  getOrCreateSheet_(CONFIG.SHEETS.ARBITROS, ARBITRO_HEADERS);
  appendRows_(CONFIG.SHEETS.ARBITROS, [[
    hash_(nombre),
    nombre,
    info.nacionalidad,
    info.confederacion,
    fakeId,
    fecha,
    homeTeam,
    awayTeam,
    ronda || '',
    amarillas,
    rojas,
    penales,
    nowChile_()
  ]]);
  Logger.log(`  Árbitro guardado: ${nombre} (${homeTeam} vs ${awayTeam})`);
}

// ─── Estadísticas acumuladas ──────────────────────────────────────────────────

/**
 * Retorna las estadísticas acumuladas de un árbitro en el torneo.
 * Busca por nombre (parcial).
 */
function getRefereeStats_(nombre) {
  if (!nombre) return null;

  const q = nombre.toLowerCase();
  let rows;
  try {
    rows = readAll_(CONFIG.SHEETS.ARBITROS).filter(r =>
      String(r.nombre || '').toLowerCase().includes(q)
    );
  } catch (e) { return null; }

  if (!rows.length) return null;

  const partidos  = rows.length;
  const amarillas = rows.reduce((s, r) => s + Number(r.amarillas || 0), 0);
  const rojas     = rows.reduce((s, r) => s + Number(r.rojas     || 0), 0);
  const penales   = rows.reduce((s, r) => s + Number(r.penales   || 0), 0);

  const amarillasPP = partidos ? (amarillas / partidos).toFixed(1) : 0;
  const tendencia   = Number(amarillasPP) >= 4.5 ? 'ESTRICTO'
                    : Number(amarillasPP) <= 2.5 ? 'PERMISIVO'
                    : 'NORMAL';

  const info = getRefereeInfo_(rows[0].nombre);

  return {
    nombre:          rows[0].nombre,
    nacionalidad:    rows[0].nacionalidad || info.nacionalidad,
    confederacion:   rows[0].confederacion || info.confederacion,
    partidos,
    amarillas,       rojas,       penales,
    amarillas_pp:    Number(amarillasPP),
    tendencia,
    partidos_lista:  rows.map(r => `${r.fecha} ${r.equipo_local} vs ${r.equipo_visitante}`)
  };
}

/**
 * Retorna el árbitro de un fixture específico con sus stats.
 * Para usar en buildEnrichedPreviewInput_.
 */
function getRefereeContextForFixture_(fixture) {
  const nombre = extractRefereeFromFixture_(fixture);
  if (!nombre) return null;

  const info  = getRefereeInfo_(nombre);
  const stats = getRefereeStats_(nombre);

  return {
    nombre,
    nacionalidad:  info.nacionalidad,
    confederacion: info.confederacion,
    stats_torneo:  stats || null
  };
}

// ─── Listado de árbitros del torneo ──────────────────────────────────────────

/**
 * Lista todos los árbitros que han actuado en el torneo con sus estadísticas.
 */
function buildArbitrosResumenText_() {
  let rows;
  try { rows = readAll_(CONFIG.SHEETS.ARBITROS); } catch (e) { return 'Sin datos de árbitros aún.'; }
  if (!rows.length) return 'Sin datos de árbitros aún. Se cargan automáticamente al procesar los partidos.';

  // Agrupar por árbitro
  const byRef = {};
  rows.forEach(r => {
    const k = r.nombre || 'Desconocido';
    if (!byRef[k]) byRef[k] = { info: r, partidos: 0, amarillas: 0, rojas: 0, penales: 0 };
    byRef[k].partidos++;
    byRef[k].amarillas += Number(r.amarillas || 0);
    byRef[k].rojas     += Number(r.rojas     || 0);
    byRef[k].penales   += Number(r.penales   || 0);
  });

  const lista = Object.entries(byRef)
    .map(([nombre, d]) => ({
      nombre,
      nacionalidad: d.info.nacionalidad || '',
      partidos:     d.partidos,
      app: d.partidos ? (d.amarillas / d.partidos).toFixed(1) : '0',
      rojas:        d.rojas,
      penales:      d.penales
    }))
    .sort((a, b) => b.partidos - a.partidos);

  let msg = `🟨 <b>Árbitros del Mundial 2026</b> (${lista.length} árbitros)\n\n`;

  lista.forEach(a => {
    const tendencia = Number(a.app) >= 4.5 ? '🔴 Estricto'
                    : Number(a.app) <= 2.5 ? '🟢 Permisivo'
                    : '🟡 Normal';
    msg += `<b>${a.nombre}</b> (${a.nacionalidad})\n`;
    msg += `  ${a.partidos} partidos | 🟨 ${a.app}/partido | 🟥 ${a.rojas} | ⚽ ${a.penales} pen | ${tendencia}\n\n`;
  });

  return msg.trim();
}

// ─── Integración en el prompt de IA ──────────────────────────────────────────

/**
 * Texto corto del árbitro para incluir en el prompt de OpenAI.
 */
function buildRefereePromptContext_(refereeCtx) {
  if (!refereeCtx) return '';

  const s = refereeCtx.stats_torneo;
  if (!s) {
    return `Árbitro: ${refereeCtx.nombre} (${refereeCtx.nacionalidad}, ${refereeCtx.confederacion}). Sin partidos previos en el torneo.`;
  }

  return `Árbitro: ${refereeCtx.nombre} (${refereeCtx.nacionalidad}, ${refereeCtx.confederacion}). ` +
    `Torneo: ${s.partidos} partidos, ${s.amarillas_pp} amarillas/partido (${s.tendencia}), ` +
    `${s.rojas} rojas, ${s.penales} penales.`;
}
