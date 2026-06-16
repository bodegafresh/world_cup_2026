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
 * Recalcula la tabla de posiciones directamente desde la hoja Partidos.
 * No requiere ninguna API — usa los resultados FT ya guardados.
 * Ejecutar manualmente después de loadFullWorldCupCalendarFromEspn().
 */
function recalcularTablaDesdePartidos() {
  const rows = readAll_(CONFIG.SHEETS.PARTIDOS);

  const FT_STATUS = ['FT', 'AET', 'PEN'];
  const played = rows.filter(r =>
    FT_STATUS.includes(String(r.status || '').toUpperCase()) &&
    r.goles_local !== '' && r.goles_local !== null && r.goles_local !== undefined &&
    r.goles_visitante !== '' && r.goles_visitante !== null && r.goles_visitante !== undefined
  );

  if (!played.length) {
    Logger.log('No hay partidos terminados en la hoja Partidos.');
    return;
  }

  // acumular stats por equipo
  const stats = {}; // equipo → { grupo, pj, pg, pe, pp, gf, gc }
  const ensure = (equipo, grupo) => {
    if (!stats[equipo]) stats[equipo] = { grupo: grupo || '', pj:0, pg:0, pe:0, pp:0, gf:0, gc:0 };
  };

  played.forEach(r => {
    const home  = teamNameToSpanish_(r.local     || r.home     || '');
    const away  = teamNameToSpanish_(r.visitante || r.away     || '');
    const grupo = r.grupo || '';
    const gh    = parseInt(r.goles_local)     || 0;
    const ga    = parseInt(r.goles_visitante) || 0;

    ensure(home, grupo);
    ensure(away, grupo);

    stats[home].pj++; stats[away].pj++;
    stats[home].gf += gh; stats[home].gc += ga;
    stats[away].gf += ga; stats[away].gc += gh;

    if (gh > ga)      { stats[home].pg++; stats[away].pp++; }
    else if (gh < ga) { stats[away].pg++; stats[home].pp++; }
    else              { stats[home].pe++; stats[away].pe++; }
  });

  // Construir filas con puntos y GD, ordenadas por grupo
  const grupos = {};
  Object.entries(stats).forEach(([equipo, s]) => {
    const puntos = s.pg * 3 + s.pe;
    const gd     = s.gf - s.gc;
    const g      = s.grupo || 'Sin grupo';
    if (!grupos[g]) grupos[g] = [];
    grupos[g].push({ equipo, puntos, gd, ...s });
  });

  const groupRows = [];
  Object.keys(grupos).sort().forEach(grupo => {
    const equipos = grupos[grupo]
      .sort((a, b) => b.puntos - a.puntos || b.gd - a.gd || b.gf - a.gf);
    equipos.forEach((e, i) => {
      groupRows.push({
        grupo,
        posicion:    i + 1,
        equipo_id:   '',
        equipo:      e.equipo,
        pj:          e.pj,
        pg:          e.pg,
        pe:          e.pe,
        pp:          e.pp,
        gf:          e.gf,
        gc:          e.gc,
        gd:          e.gf - e.gc,
        puntos:      e.puntos,
        forma:       '',
        descripcion: '',
        updated_at:  nowChile_()
      });
    });
  });

  upsertStandings_(groupRows);
  Logger.log(`✅ Tabla recalculada: ${groupRows.length} equipos en ${Object.keys(grupos).length} grupos.`);
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
