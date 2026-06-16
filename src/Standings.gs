/**
 * Standings.gs
 *
 * Carga y persiste la tabla de posiciones del Mundial 2026 por grupo.
 * Fuente: API-Football /standings endpoint.
 *
 * Se llama al final de cronDailyLoadTodayStats() para mantener
 * la clasificación actualizada después de cada jornada.
 */

function loadWorldCupStandings() {
  const data = fetchStandings_();
  const groups = parseStandingsGroups_(data);

  if (!groups.length) {
    console.log('Sin datos de standings disponibles todavía (fase de grupos puede no haber comenzado).');
    return;
  }

  upsertStandings_(groups);
  console.log(`Standings actualizados: ${groups.length} equipos`);
}

/**
 * Llama API-Football /standings para el Mundial.
 */
function fetchStandings_() {
  return apiFootballGet_('/standings', {
    league: CONFIG.API_FOOTBALL.WORLD_CUP_LEAGUE_ID,
    season: CONFIG.API_FOOTBALL.SEASON
  });
}

/**
 * Convierte la respuesta de API-Football en filas planas por equipo.
 */
function parseStandingsGroups_(data) {
  const rows = [];
  const leagueData = (data.response || [])[0];

  if (!leagueData || !leagueData.league) return rows;

  const standings = leagueData.league.standings || [];

  standings.forEach(group => {
    group.forEach(entry => {
      rows.push({
        grupo:          entry.group || '',
        posicion:       entry.rank || '',
        equipo_id:      entry.team ? entry.team.id : '',
        equipo:         entry.team ? entry.team.name : '',
        pj:             entry.all ? entry.all.played : 0,
        pg:             entry.all ? entry.all.win : 0,
        pe:             entry.all ? entry.all.draw : 0,
        pp:             entry.all ? entry.all.lose : 0,
        gf:             entry.all && entry.all.goals ? entry.all.goals.for : 0,
        gc:             entry.all && entry.all.goals ? entry.all.goals.against : 0,
        gd:             entry.goalsDiff || 0,
        puntos:         entry.points || 0,
        forma:          entry.form || '',
        descripcion:    entry.description || '',
        updated_at:     nowChile_()
      });
    });
  });

  return rows;
}

/**
 * Upsert en la hoja Clasificacion: limpia y reescribe completo
 * (la tabla de posiciones es una snapshot, no acumula).
 */
function upsertStandings_(groups) {
  const sheetName = 'Clasificacion';

  const sheet = ensureStandingsSheet_(sheetName);

  const lastRow = sheet.getLastRow();
  if (lastRow > 1) {
    sheet.getRange(2, 1, lastRow - 1, sheet.getLastColumn()).clearContent();
  }

  const rows = groups.map(g => [
    g.grupo,
    g.posicion,
    g.equipo_id,
    g.equipo,
    g.pj,
    g.pg,
    g.pe,
    g.pp,
    g.gf,
    g.gc,
    g.gd,
    g.puntos,
    g.forma,
    g.descripcion,
    g.updated_at
  ]);

  if (rows.length) {
    sheet.getRange(2, 1, rows.length, rows[0].length).setValues(rows);
  }
}

/**
 * Crea la hoja Clasificacion con headers si no existe.
 */
function ensureStandingsSheet_(sheetName) {
  const ss = SpreadsheetApp.openById(getSpreadsheetId_());
  let sheet = ss.getSheetByName(sheetName);

  if (!sheet) {
    sheet = ss.insertSheet(sheetName);
    const headers = [
      'grupo', 'posicion', 'equipo_id', 'equipo',
      'pj', 'pg', 'pe', 'pp', 'gf', 'gc', 'gd', 'puntos',
      'forma', 'descripcion', 'updated_at'
    ];
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    sheet.setFrozenRows(1);
  }

  return sheet;
}

/**
 * Devuelve los standings como texto formateado para Telegram.
 * Agrupa por grupo y muestra posición, equipo, puntos y GD.
 */
function buildStandingsText_() {
  const ss = SpreadsheetApp.openById(getSpreadsheetId_());
  const sheet = ss.getSheetByName('Clasificacion');

  if (!sheet || sheet.getLastRow() <= 1) {
    return '⚠️ Tabla de posiciones aún no disponible (la fase de grupos aún no comenzó).';
  }

  const rows = readAll_('Clasificacion');

  if (!rows.length) return '⚠️ Sin datos de clasificación.';

  const byGroup = {};
  rows.forEach(r => {
    const g = r.grupo || 'Sin grupo';
    if (!byGroup[g]) byGroup[g] = [];
    byGroup[g].push(r);
  });

  let msg = '🏆 <b>Tabla de Posiciones — Mundial 2026</b>\n';

  Object.keys(byGroup).sort().forEach(grupo => {
    msg += `\n<b>${grupo}</b>\n`;
    byGroup[grupo].forEach(r => {
      const avanza = r.descripcion && r.descripcion.toLowerCase().includes('advance') ? '✅' : '  ';
      msg += `${avanza}${r.posicion}. ${r.equipo} — ${r.puntos} pts (GD ${r.gd > 0 ? '+' : ''}${r.gd})\n`;
    });
  });

  return msg.trim();
}
