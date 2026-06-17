/**
 * TeamPlayerIngestion.gs
 *
 * Responsabilidad:
 * - Construir la base maestra de selecciones desde SourceFixtures/Partidos.
 * - Guardar equipos únicos en la hoja Equipos.
 * - Consultar planteles por selección usando API-Football players/squads.
 * - Guardar jugadores únicos en Jugadores.
 * - Guardar relación jugador-selección-torneo en Planteles.
 *
 * Este archivo NO analiza rendimiento de partido.
 * Eso irá en PlayerMatchStats con lineups/statistics/events.
 */

function loadTeamsFromCurrentData_() {
  const sourceFixtures = readAll_(CONFIG.SHEETS.SOURCE_FIXTURES);
  const teams = buildTeamsFromSourceFixtures_(sourceFixtures);

  upsertTeams_(teams);

  return {
    teams: teams.length,
    status: 'OK'
  };
}

function buildTeamsFromSourceFixtures_(sourceFixtures) {
  const byNormalizedName = {};

  sourceFixtures.forEach(row => {
    if (row.source !== 'API_FOOTBALL') return;

    addTeamFromSourceFixtureSide_(byNormalizedName, {
      team_id_api_football: row.home_team_id,
      nombre: row.home_team_name,
      source: row.source
    });

    addTeamFromSourceFixtureSide_(byNormalizedName, {
      team_id_api_football: row.away_team_id,
      nombre: row.away_team_name,
      source: row.source
    });
  });

  enrichTeamsWithFootballDataIds_(byNormalizedName, sourceFixtures);

  return Object.values(byNormalizedName);
}

function addTeamFromSourceFixtureSide_(map, input) {
  if (!input.nombre) return;

  const normalized = normalizeTeamNameStrong_(input.nombre);

  if (!map[normalized]) {
    map[normalized] = {
      team_id_api_football: input.team_id_api_football || '',
      team_id_football_data: '',
      nombre: input.nombre,
      nombre_normalizado: normalized,
      pais: input.nombre,
      codigo: '',
      grupo: '',
      ranking_fifa: '',
      director_tecnico: '',
      fuente: 'API_FOOTBALL',
      sources_used: 'API_FOOTBALL',
      confidence_score: 0.8,
      logo: '',
      last_updated: nowChile_()
    };
  }

  if (input.team_id_api_football && !map[normalized].team_id_api_football) {
    map[normalized].team_id_api_football = input.team_id_api_football;
  }
}

function enrichTeamsWithFootballDataIds_(teamsByName, sourceFixtures) {
  sourceFixtures.forEach(row => {
    if (row.source !== 'FOOTBALL_DATA') return;

    enrichTeamWithFootballDataId_(teamsByName, row.home_team_name, row.home_team_id);
    enrichTeamWithFootballDataId_(teamsByName, row.away_team_name, row.away_team_id);
  });
}

function enrichTeamWithFootballDataId_(teamsByName, teamName, footballDataId) {
  if (!teamName) return;

  const normalized = normalizeTeamNameStrong_(teamName);
  const team = teamsByName[normalized];

  if (!team) return;

  team.team_id_football_data = footballDataId || '';
  team.sources_used = 'API_FOOTBALL,FOOTBALL_DATA';
  team.confidence_score = 1;
  team.last_updated = nowChile_();
}

function upsertTeams_(teams) {
  const sheet = getSheet_(CONFIG.SHEETS.EQUIPOS);
  const values = sheet.getDataRange().getValues();
  const headers = values[0];

  const keyIndex = headers.indexOf('nombre_normalizado');

  if (keyIndex === -1) {
    throw new Error('La hoja Equipos necesita columna nombre_normalizado');
  }

  const existingRowByKey = {};

  values.slice(1).forEach((row, i) => {
    const key = row[keyIndex];
    if (key) existingRowByKey[String(key)] = i + 2;
  });

  teams.forEach(team => {
    const row = headers.map(header => safe_(team[header]));

    if (existingRowByKey[team.nombre_normalizado]) {
      sheet.getRange(existingRowByKey[team.nombre_normalizado], 1, 1, row.length).setValues([row]);
    } else {
      sheet.appendRow(row);
    }
  });
}

/**
 * Carga planteles para todos los equipos conocidos en la hoja Equipos.
 */
function loadSquadsForKnownTeams_() {
  const teams = readAll_(CONFIG.SHEETS.EQUIPOS)
    .filter(team => team.team_id_api_football);

  let totalTeams = 0;
  let totalPlayers = 0;
  let totalSquadRows = 0;

  teams.forEach(team => {
    try {
      const result = loadSquadForTeam_(team);
      totalTeams += 1;
      totalPlayers += result.players;
      totalSquadRows += result.squadRows;

      Utilities.sleep(900);
    } catch (e) {
      Logger.log(`Error cargando squad para ${team.nombre}: ${e.message}`);
    }
  });

  return {
    teams: totalTeams,
    players: totalPlayers,
    squadRows: totalSquadRows,
    status: 'OK'
  };
}

/**
 * Carga el plantel de una selección concreta.
 */
function loadSquadForTeam_(team) {
  const teamId = team.team_id_api_football;
  const teamName = team.nombre;

  const data = fetchSquadByTeam_(teamId);

  const rawUrl = saveRawJson_(
    `raw/api-football/squads/${teamId}`,
    `api-football-squad-${teamId}.json`,
    data
  );

  const squadPayload = extractSquadPayload_(data);

  const players = squadPayload.players.map(player => {
    return buildPlayerObject_(player, team, rawUrl);
  });

  const squadRows = squadPayload.players.map(player => {
    return buildSquadObject_(player, team, rawUrl);
  });

  upsertPlayers_(players);
  upsertSquadRows_(squadRows);

  return {
    team_id: teamId,
    team: teamName,
    players: players.length,
    squadRows: squadRows.length,
    rawUrl: rawUrl
  };
}

function extractSquadPayload_(data) {
  const response = data.response || [];

  if (!response.length) {
    return {
      team: {},
      players: []
    };
  }

  const item = response[0];

  return {
    team: item.team || {},
    players: item.players || []
  };
}

function buildPlayerObject_(player, team, rawUrl) {
  return {
    player_id_api_football: player.id || '',
    nombre: player.name || '',
    nombre_normalizado: normalizePlayerName_(player.name),
    equipo_id: team.team_id_api_football || '',
    equipo: team.nombre || '',
    posicion: player.position || '',
    edad: player.age || '',
    fecha_nacimiento: '',
    nacionalidad: team.nombre || '',
    altura: '',
    peso: '',
    foto: player.photo || '',
    fuente: `API_FOOTBALL players/squads | ${rawUrl}`,
    last_updated: nowChile_()
  };
}

function buildSquadObject_(player, team, rawUrl) {
  const squadId = `${team.team_id_api_football}_${player.id}_${CONFIG.API_FOOTBALL.SEASON}`;

  return {
    squad_id: squadId,
    team_id: team.team_id_api_football || '',
    equipo: team.nombre || '',
    player_id: player.id || '',
    jugador: player.name || '',
    posicion: player.position || '',
    numero: player.number || '',
    rol: '',
    mundial: 'World Cup',
    season: CONFIG.API_FOOTBALL.SEASON,
    fuente: `API_FOOTBALL players/squads | ${rawUrl}`,
    last_updated: nowChile_()
  };
}

function upsertPlayers_(players) {
  if (!players || !players.length) return;

  const sheet = getSheet_(CONFIG.SHEETS.JUGADORES);
  const values = sheet.getDataRange().getValues();
  const headers = values[0];

  const keyIndex = headers.indexOf('player_id_api_football');

  if (keyIndex === -1) {
    throw new Error('La hoja Jugadores necesita columna player_id_api_football');
  }

  const existingRowByKey = {};

  values.slice(1).forEach((row, i) => {
    const key = row[keyIndex];
    if (key) existingRowByKey[String(key)] = i + 2;
  });

  players.forEach(player => {
    const row = headers.map(header => safe_(player[header]));

    if (existingRowByKey[String(player.player_id_api_football)]) {
      sheet.getRange(existingRowByKey[String(player.player_id_api_football)], 1, 1, row.length).setValues([row]);
    } else {
      sheet.appendRow(row);
    }
  });
}

function upsertSquadRows_(squadRows) {
  if (!squadRows || !squadRows.length) return;

  const sheet = getSheet_(CONFIG.SHEETS.PLANTELES);
  const values = sheet.getDataRange().getValues();
  const headers = values[0];

  const keyIndex = headers.indexOf('squad_id');

  if (keyIndex === -1) {
    throw new Error('La hoja Planteles necesita columna squad_id');
  }

  const existingRowByKey = {};

  values.slice(1).forEach((row, i) => {
    const key = row[keyIndex];
    if (key) existingRowByKey[String(key)] = i + 2;
  });

  squadRows.forEach(squad => {
    const row = headers.map(header => safe_(squad[header]));

    if (existingRowByKey[String(squad.squad_id)]) {
      sheet.getRange(existingRowByKey[String(squad.squad_id)], 1, 1, row.length).setValues([row]);
    } else {
      sheet.appendRow(row);
    }
  });
}

function normalizePlayerName_(name) {
  return String(name || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]/g, '');
}

// \u2500\u2500 Funciones p\u00fablicas (sin underscore) para ejecutar desde el editor \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500

function cargarEquipos()  { return loadTeamsFromCurrentData_(); }
function cargarPlanteles() { return loadSquadsForKnownTeams_(); }

/**
 * Carga planteles desde ESPN para todos los equipos que a\u00fan no tienen jugadores
 * en la hoja Jugadores. Usa los summaries de los partidos ya disputados.
 *
 * No requiere API-Football. Usa espn_{athleteId} como player_id sint\u00e9tico.
 * Ejecutar manualmente despu\u00e9s de backfillEspnHistorical().
 */
function cargarPlantelesDesdeEspn() {
  Logger.log('=== CARGANDO PLANTELES DESDE ESPN ===');

  // Equipos ya con jugadores en la hoja
  const jugadores = readAll_(CONFIG.SHEETS.JUGADORES);
  const equiposConPlantel = new Set(jugadores.map(j => String(j.equipo || '').toLowerCase()));

  // Partidos FT para saber qu\u00e9 equipos jugaron y en qu\u00e9 fechas
  const partidos = readAll_(CONFIG.SHEETS.PARTIDOS)
    .filter(r => ['FT','AET','PEN'].includes(String(r.status || '').toUpperCase()));

  // Recolectar teams sin plantel y el primer partido FT de cada uno
  const equiposFaltantes = {}; // equipoEs \u2192 { fecha, homeTeam, awayTeam }
  partidos.forEach(r => {
    const localEs = teamNameToSpanish_(r.local || '');
    const visitEs = teamNameToSpanish_(r.visitante || '');
    if (!equiposConPlantel.has(localEs.toLowerCase()) && !equiposFaltantes[localEs]) {
      equiposFaltantes[localEs] = { fecha: r.fecha, localEs, visitEs, lado: 'home' };
    }
    if (!equiposConPlantel.has(visitEs.toLowerCase()) && !equiposFaltantes[visitEs]) {
      equiposFaltantes[visitEs] = { fecha: r.fecha, localEs, visitEs, lado: 'away' };
    }
  });

  const faltantesList = Object.entries(equiposFaltantes);
  Logger.log(`Equipos sin plantel: ${faltantesList.length}`);
  if (!faltantesList.length) { Logger.log('Todos los equipos ya tienen plantel.'); return; }

  const sheet   = getOrCreateSheet_(CONFIG.SHEETS.JUGADORES, null);
  const headers = getHeaders_(CONFIG.SHEETS.JUGADORES);
  const keyIdx  = headers.indexOf('player_id_api_football');

  // Mapa de IDs ya existentes para dedup
  const vals = sheet.getDataRange().getValues();
  const existingIds = new Set(vals.slice(1).map(r => String(r[keyIdx] || '')).filter(Boolean));

  let totalEquipos = 0, totalJugadores = 0;

  // Agrupar por fecha para minimizar llamadas ESPN
  const porFecha = {};
  faltantesList.forEach(([, info]) => {
    if (!porFecha[info.fecha]) porFecha[info.fecha] = [];
    porFecha[info.fecha].push(info);
  });

  Object.entries(porFecha).forEach(([fecha, infos]) => {
    let espnEvents;
    try { espnEvents = fetchEspnEventsByDate_(fecha); }
    catch(e) { Logger.log(`ESPN ${fecha}: ${e.message}`); return; }

    infos.forEach(info => {
      // Encontrar el evento ESPN que corresponde a este partido
      const normN = s => String(s || '').toLowerCase()
        .normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z]/g, '');
      const homeN = normN(info.localEs), awayN = normN(info.visitEs);
      const ev = (espnEvents || []).find(e => {
        const eH = normN(teamNameToSpanish_(e.home_team || ''));
        const eA = normN(teamNameToSpanish_(e.away_team || ''));
        return (eH === homeN && eA === awayN) || (eH === awayN && eA === homeN);
      });
      if (!ev || !ev.espn_id) { Logger.log(`  sin ESPN ID para ${info.localEs} vs ${info.visitEs}`); return; }

      let summary;
      try { summary = fetchEspnSummary_(ev.espn_id); }
      catch(e) { Logger.log(`  ESPN summary error: ${e.message}`); return; }

      const rosters = summary.rosters || [];
      const newRows = [];

      rosters.forEach(entry => {
        const side   = entry.homeAway;
        const teamEn = side === 'home' ? ev.home_team : ev.away_team;
        const teamEs = teamNameToSpanish_(teamEn);
        if (!equiposFaltantes[teamEs]) return; // este equipo ya tiene plantel, skip

        (entry.roster || []).forEach(p => {
          const ath = p.athlete || {};
          const pid = `espn_${ath.id || ''}`;
          if (!ath.id || existingIds.has(pid)) return;

          const rowData = {};
          rowData['player_id_api_football'] = pid;
          rowData['nombre']                 = ath.displayName || ath.shortName || '';
          rowData['nombre_normalizado']     = normalizePlayerName_(rowData['nombre']);
          rowData['equipo_id']              = String((entry.team || {}).id || '');
          rowData['equipo']                 = teamEs;
          rowData['posicion']               = ((p.position || {}).abbreviation || '').toUpperCase();
          rowData['edad']                   = ath.age || '';
          rowData['fecha_nacimiento']       = '';
          rowData['nacionalidad']           = teamEs;
          rowData['altura']                 = '';
          rowData['peso']                   = '';
          rowData['foto']                   = (ath.headshot || {}).href || '';
          rowData['fuente']                 = 'ESPN_SUMMARY';
          rowData['last_updated']           = nowChile_();

          const row = headers.map(h => rowData[h] !== undefined ? rowData[h] : '');
          newRows.push(row);
          existingIds.add(pid);
          totalJugadores++;
        });
      });

      if (newRows.length) {
        sheet.getRange(sheet.getLastRow() + 1, 1, newRows.length, newRows[0].length).setValues(newRows);
        Logger.log(`  \u2705 ${info.localEs} vs ${info.visitEs}: ${newRows.length} jugadores`);
        totalEquipos++;
      }

      Utilities.sleep(500);
    });
  });

  Logger.log(`\n=== FIN: ${totalJugadores} jugadores de ${totalEquipos} equipos cargados ===`);
}