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