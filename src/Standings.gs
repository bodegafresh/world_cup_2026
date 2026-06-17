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
    g.equipo,
    g.equipo_id,
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
      'grupo', 'posicion', 'equipo', 'equipo_id',
      'pj', 'pg', 'pe', 'pp', 'gf', 'gc', 'gd', 'puntos',
      'forma', 'descripcion', 'updated_at'
    ];
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    sheet.setFrozenRows(1);
  }

  return sheet;
}

const WC2026_GROUPS = {
  // Grupo A
  'México': 'Grupo A', 'Mexico': 'Grupo A', 'Sudáfrica': 'Grupo A', 'South Africa': 'Grupo A',
  'Corea del Sur': 'Grupo A', 'Korea Republic': 'Grupo A', 'República Checa': 'Grupo A', 'Czechia': 'Grupo A',
  // Grupo B
  'Canadá': 'Grupo B', 'Canada': 'Grupo B', 'Bosnia': 'Grupo B', 'Bosnia and Herzegovina': 'Grupo B',
  'Catar': 'Grupo B', 'Qatar': 'Grupo B', 'Suiza': 'Grupo B', 'Switzerland': 'Grupo B',
  // Grupo C
  'Brasil': 'Grupo C', 'Brazil': 'Grupo C', 'Marruecos': 'Grupo C', 'Morocco': 'Grupo C',
  'Haití': 'Grupo C', 'Haiti': 'Grupo C', 'Escocia': 'Grupo C', 'Scotland': 'Grupo C',
  // Grupo D
  'EE.UU.': 'Grupo D', 'USA': 'Grupo D', 'United States': 'Grupo D',
  'Paraguay': 'Grupo D', 'Australia': 'Grupo D', 'Turquía': 'Grupo D', 'Türkiye': 'Grupo D',
  // Grupo E
  'Alemania': 'Grupo E', 'Germany': 'Grupo E', 'Curazao': 'Grupo E', 'Curaçao': 'Grupo E',
  'Costa de Marfil': 'Grupo E', "Côte d'Ivoire": 'Grupo E', 'Ecuador': 'Grupo E',
  // Grupo F
  'Países Bajos': 'Grupo F', 'Netherlands': 'Grupo F', 'Japón': 'Grupo F', 'Japan': 'Grupo F',
  'Suecia': 'Grupo F', 'Sweden': 'Grupo F', 'Túnez': 'Grupo F', 'Tunisia': 'Grupo F',
  // Grupo G
  'Bélgica': 'Grupo G', 'Belgium': 'Grupo G', 'Egipto': 'Grupo G', 'Egypt': 'Grupo G',
  'Irán': 'Grupo G', 'Iran': 'Grupo G', 'IR Iran': 'Grupo G', 'Nueva Zelanda': 'Grupo G', 'New Zealand': 'Grupo G',
  // Grupo H
  'España': 'Grupo H', 'Spain': 'Grupo H', 'Cabo Verde': 'Grupo H', 'Cape Verde': 'Grupo H', 'Cape Verde Islands': 'Grupo H',
  'Arabia Saudita': 'Grupo H', 'Saudi Arabia': 'Grupo H', 'Uruguay': 'Grupo H',
  // Grupo I
  'Francia': 'Grupo I', 'France': 'Grupo I', 'Senegal': 'Grupo I',
  'Irak': 'Grupo I', 'Iraq': 'Grupo I', 'Noruega': 'Grupo I', 'Norway': 'Grupo I',
  // Grupo J
  'Argentina': 'Grupo J', 'Argelia': 'Grupo J', 'Algeria': 'Grupo J',
  'Austria': 'Grupo J', 'Jordania': 'Grupo J', 'Jordan': 'Grupo J',
  // Grupo K
  'Portugal': 'Grupo K', 'Congo DR': 'Grupo K', 'DR Congo': 'Grupo K',
  'Uzbekistán': 'Grupo K', 'Uzbekistan': 'Grupo K', 'Colombia': 'Grupo K',
  // Grupo L
  'Inglaterra': 'Grupo L', 'England': 'Grupo L', 'Croacia': 'Grupo L', 'Croatia': 'Grupo L',
  'Ghana': 'Grupo L', 'Panamá': 'Grupo L', 'Panama': 'Grupo L',
};

/**
 * Recalcula la tabla de posiciones directamente desde la hoja Partidos.
 * No requiere ninguna API — usa los resultados FT ya guardados.
 * Ejecutar manualmente después de loadFullWorldCupCalendarFromEspn().
 */
function recalcularTablaDesdePartidos() {
  // Inicializar los 48 equipos con 0 stats — garantiza exactamente 4 por grupo
  const ALL_48 = {
    'Grupo A': ['México','Sudáfrica','Corea del Sur','República Checa'],
    'Grupo B': ['Canadá','Bosnia','Catar','Suiza'],
    'Grupo C': ['Brasil','Marruecos','Haití','Escocia'],
    'Grupo D': ['EE.UU.','Paraguay','Australia','Turquía'],
    'Grupo E': ['Alemania','Curazao','Costa de Marfil','Ecuador'],
    'Grupo F': ['Países Bajos','Japón','Suecia','Túnez'],
    'Grupo G': ['Bélgica','Egipto','Irán','Nueva Zelanda'],
    'Grupo H': ['España','Cabo Verde','Arabia Saudita','Uruguay'],
    'Grupo I': ['Francia','Senegal','Irak','Noruega'],
    'Grupo J': ['Argentina','Argelia','Austria','Jordania'],
    'Grupo K': ['Portugal','Congo DR','Uzbekistán','Colombia'],
    'Grupo L': ['Inglaterra','Croacia','Ghana','Panamá'],
  };

  const stats = {};
  Object.entries(ALL_48).forEach(([grupo, equipos]) => {
    equipos.forEach(eq => {
      stats[eq] = { grupo, pj:0, pg:0, pe:0, pp:0, gf:0, gc:0 };
    });
  });

  // Lookup rápido: cualquier nombre (ES o EN) → nombre canónico en stats
  const nameToCanon = {};
  Object.keys(stats).forEach(canon => {
    nameToCanon[canon.toLowerCase()] = canon;
  });
  // Agregar variantes EN→ES del diccionario
  Object.entries(WC2026_GROUPS).forEach(([variant]) => {
    const es = teamNameToSpanish_(variant);
    if (stats[es]) nameToCanon[variant.toLowerCase()] = es;
  });

  const resolve = raw => {
    if (!raw) return null;
    const lo = raw.toLowerCase().trim();
    if (nameToCanon[lo]) return nameToCanon[lo];
    const es = teamNameToSpanish_(raw);
    if (stats[es]) return es;
    return null;
  };

  // Acumular stats de partidos terminados — con dedup por par canónico de equipos
  // Evita contar 2 veces el mismo partido si ESPN y API-Football crearon filas distintas
  const FT_STATUS = ['FT', 'AET', 'PEN'];
  const seenMatchups = new Set();

  readAll_(CONFIG.SHEETS.PARTIDOS)
    .filter(r =>
      FT_STATUS.includes(String(r.status || '').toUpperCase()) &&
      r.goles_local !== '' && r.goles_local !== null && r.goles_local !== undefined &&
      r.goles_visitante !== '' && r.goles_visitante !== null && r.goles_visitante !== undefined
    )
    .forEach(r => {
      const home = resolve(r.local || r.home || '');
      const away = resolve(r.visitante || r.away || '');
      if (!home || !away) return;

      // Clave canónica: fecha normalizada + par de equipos canónicos ordenados alfabéticamente
      const fecha = normalizeFecha_(r.fecha) || String(r.fecha || '').substring(0, 10);
      const dedupKey = `${fecha}_${[home, away].sort().join('_')}`;
      if (seenMatchups.has(dedupKey)) {
        Logger.log(`⚠️ Duplicado ignorado: ${dedupKey}`);
        return;
      }
      seenMatchups.add(dedupKey);

      const gh = parseInt(r.goles_local)     || 0;
      const ga = parseInt(r.goles_visitante) || 0;

      stats[home].pj++; stats[away].pj++;
      stats[home].gf += gh; stats[home].gc += ga;
      stats[away].gf += ga; stats[away].gc += gh;

      if (gh > ga)      { stats[home].pg++; stats[away].pp++; }
      else if (gh < ga) { stats[away].pg++; stats[home].pp++; }
      else              { stats[home].pe++; stats[away].pe++; }
    });

  // Construir filas ordenadas por grupo → posición
  const groupRows = [];
  Object.keys(ALL_48).sort().forEach(grupo => {
    ALL_48[grupo]
      .map(eq => ({ equipo: eq, ...stats[eq] }))
      .sort((a, b) => {
        const pa = a.pg*3+a.pe, pb = b.pg*3+b.pe;
        return pb - pa || (b.gf-b.gc) - (a.gf-a.gc) || b.gf - a.gf;
      })
      .forEach((e, i) => {
        const puntos = e.pg*3 + e.pe;
        groupRows.push({
          grupo, posicion: i+1, equipo_id: '', equipo: e.equipo,
          pj: e.pj, pg: e.pg, pe: e.pe, pp: e.pp,
          gf: e.gf, gc: e.gc, gd: e.gf - e.gc, puntos,
          forma: '', descripcion: '', updated_at: nowChile_()
        });
      });
  });

  upsertStandings_(groupRows);
  Logger.log(`✅ Tabla recalculada: ${groupRows.length} equipos (${Object.keys(ALL_48).length} grupos).`);
}

/**
 * Añade a la tabla los 48 equipos del Mundial con 0 stats
 * para los que aún no tienen partidos registrados.
 * Ejecutar después de recalcularTablaDesdePartidos().
 */
function completarTablaConTodos48() {
  const ALL_TEAMS = {
    'Grupo A': ['México','Sudáfrica','Corea del Sur','República Checa'],
    'Grupo B': ['Canadá','Bosnia','Catar','Suiza'],
    'Grupo C': ['Brasil','Marruecos','Haití','Escocia'],
    'Grupo D': ['EE.UU.','Paraguay','Australia','Turquía'],
    'Grupo E': ['Alemania','Curazao','Costa de Marfil','Ecuador'],
    'Grupo F': ['Países Bajos','Japón','Suecia','Túnez'],
    'Grupo G': ['Bélgica','Egipto','Irán','Nueva Zelanda'],
    'Grupo H': ['España','Cabo Verde','Arabia Saudita','Uruguay'],
    'Grupo I': ['Francia','Senegal','Irak','Noruega'],
    'Grupo J': ['Argentina','Argelia','Austria','Jordania'],
    'Grupo K': ['Portugal','Congo DR','Uzbekistán','Colombia'],
    'Grupo L': ['Inglaterra','Croacia','Ghana','Panamá'],
  };

  const sheet = ensureStandingsSheet_('Clasificacion');
  const existing = readAll_('Clasificacion');
  const existingTeams = new Set(existing.map(r => String(r.equipo || '').toLowerCase().trim()));

  const newRows = [];
  Object.entries(ALL_TEAMS).forEach(([grupo, equipos]) => {
    equipos.forEach(equipo => {
      if (!existingTeams.has(equipo.toLowerCase().trim())) {
        newRows.push([grupo, '', equipo, '', 0, 0, 0, 0, 0, 0, 0, 0, '', '', nowChile_()]);
      }
    });
  });

  if (newRows.length) {
    sheet.getRange(sheet.getLastRow() + 1, 1, newRows.length, newRows[0].length).setValues(newRows);
    Logger.log(`✅ Agregados ${newRows.length} equipos faltantes a la tabla.`);
  } else {
    Logger.log('Todos los 48 equipos ya están en la tabla.');
  }
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
    byGroup[grupo]
      .sort((a, b) => Number(b.puntos||0) - Number(a.puntos||0) || Number(b.gd||0) - Number(a.gd||0) || Number(b.gf||0) - Number(a.gf||0))
      .forEach((r, i) => {
        const gd  = Number(r.gd || 0);
        const pts = Number(r.puntos || 0);
        const pj  = Number(r.pj || 0);
        const pg  = Number(r.pg || 0);
        const pe  = Number(r.pe || 0);
        const pp  = Number(r.pp || 0);
        const gf  = Number(r.gf || 0);
        const gc  = Number(r.gc || 0);
        const avanza = i < 2 ? '✅' : '  ';
        const flag   = teamFlag_(r.equipo || '');
        const nombre = r.equipo || '?';
        msg += `${avanza}${i+1}. ${flag} <b>${nombre}</b> ${pts}pts`;
        if (pj > 0) msg += ` | ${pj}PJ ${pg}G ${pe}E ${pp}P | ${gf}:${gc} (${gd >= 0 ? '+' : ''}${gd})`;
        msg += '\n';
      });
  });

  return msg.trim();
}

/**
 * Detecta y reporta partidos duplicados en la hoja Partidos.
 * Agrupa por par canónico de equipos + fecha y muestra los que tienen > 1 fila.
 * Útil para diagnosticar discrepancias de stats cuando ESPN y API-Football
 * generan match_keys distintos para el mismo partido.
 * Ejecutar manualmente desde Apps Script editor.
 */
function auditarDuplicadosPartidos() {
  const rows = readAll_(CONFIG.SHEETS.PARTIDOS);
  const groups = {};

  rows.forEach((r, idx) => {
    const home = teamNameToSpanish_(r.local || r.home || '');
    const away = teamNameToSpanish_(r.visitante || r.away || '');
    if (!home || !away) return;
    const fecha = normalizeFecha_(r.fecha) || String(r.fecha || '').substring(0, 10);
    const key   = `${fecha}_${[home, away].sort().join(' vs ')}`;
    if (!groups[key]) groups[key] = [];
    groups[key].push({
      row: idx + 2,
      match_key: r.match_key || '',
      status:    r.status || '',
      score:     `${r.goles_local ?? '?'}-${r.goles_visitante ?? '?'}`,
      source:    r.fuente || r.source || ''
    });
  });

  let dupes = 0;
  Object.entries(groups).forEach(([key, entries]) => {
    if (entries.length > 1) {
      dupes++;
      Logger.log(`🔁 DUPLICADO: ${key}`);
      entries.forEach(e => Logger.log(`   fila ${e.row} | key=${e.match_key} | ${e.status} ${e.score} | fuente=${e.source}`));
    }
  });

  Logger.log(`\n✅ Auditoría completa: ${rows.length} filas, ${dupes} partidos duplicados encontrados.`);
  return dupes;
}
