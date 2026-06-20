/**
 * PlayerMatchStats.gs
 *
 * Carga estadísticas avanzadas por jugador por partido desde
 * API-Football /fixtures/players.
 *
 * Complementa ResumenJugadorPartido (que viene de eventos live)
 * con métricas de rendimiento completas: pases, tiros, duelos,
 * regates, rating WhoScored.
 *
 * Se llama en cronDailyLoadTodayStats() para cada fixture finalizado.
 */

function loadPlayerStatsForFixture_(fixtureId, fixture) {
  const data = fetchPlayerStatsByFixture_(fixtureId);
  const players = parsePlayerStatsResponse_(data.response || [], fixtureId);

  if (!players.length) {
    console.log(`PlayerMatchStats: sin datos para fixture ${fixtureId}`);
    return;
  }

  savePlayerMatchStats_(players);

  const rawUrl = saveRawJson_(
    `raw/api-football/player-stats/${fixtureId}`,
    `player-stats-${fixtureId}.json`,
    data
  );

  console.log(`PlayerMatchStats: ${players.length} jugadores guardados para fixture ${fixtureId}`);
  return players.length;
}

/**
 * Llama API-Football /fixtures/players.
 */
function fetchPlayerStatsByFixture_(fixtureId) {
  return apiFootballGet_('/fixtures/players', { fixture: fixtureId });
}

/**
 * Parsea la respuesta de /fixtures/players en objetos planos.
 * La respuesta viene por equipo: [{team, players: [{player, statistics}]}]
 */
function parsePlayerStatsResponse_(response, fixtureId) {
  const rows = [];

  response.forEach(teamBlock => {
    const teamId   = teamBlock.team ? teamBlock.team.id : '';
    const teamName = teamBlock.team ? teamBlock.team.name : '';

    (teamBlock.players || []).forEach(entry => {
      const p    = entry.player || {};
      const stat = (entry.statistics || [])[0] || {};

      const games    = stat.games    || {};
      const shots    = stat.shots    || {};
      const goals    = stat.goals    || {};
      const passes   = stat.passes   || {};
      const tackles  = stat.tackles  || {};
      const duels    = stat.duels    || {};
      const dribbles = stat.dribbles || {};
      const fouls    = stat.fouls    || {};
      const cards    = stat.cards    || {};

      rows.push({
        fixture_id:          fixtureId,
        player_id:           p.id || '',
        player_name:         p.name || '',
        team_id:             teamId,
        team_name:           teamName,
        minutes_played:      games.minutes || '',
        rating:              games.rating ? Number(parseFloat(games.rating).toFixed(2)) : '',
        position:            games.position || '',
        captain:             games.captain ? 1 : 0,
        shots_total:         shots.total || 0,
        shots_on:            shots.on || 0,
        goals_scored:        goals.total || 0,
        goals_conceded:      goals.concedes || 0,
        assists:             goals.assists || 0,
        passes_total:        passes.total || 0,
        passes_accuracy:     passes.accuracy ? Number(String(passes.accuracy).replace('%','')) : '',
        key_passes:          passes.key || 0,
        tackles_total:       tackles.total || 0,
        interceptions:       tackles.interceptions || 0,
        blocks:              tackles.blocks || 0,
        duels_total:         duels.total || 0,
        duels_won:           duels.won || 0,
        dribbles_attempts:   dribbles.attempts || 0,
        dribbles_success:    dribbles.success || 0,
        fouls_committed:     fouls.committed || 0,
        fouls_drawn:         fouls.drawn || 0,
        yellow_cards:        cards.yellow || 0,
        red_cards:           cards.red || 0,
        loaded_at:           nowChile_()
      });
    });
  });

  return rows;
}

/**
 * Upsert por fixture_id + player_id.
 * Evita duplicados y refresca stats si una fuente trae datos mas completos.
 */
function savePlayerMatchStats_(players) {
  const sheetName = CONFIG.SHEETS.PLAYER_MATCH_STATS;
  const HEADERS = [
    'fixture_id', 'player_id', 'player_name', 'team_id', 'team_name',
    'minutes_played', 'rating', 'position', 'captain',
    'shots_total', 'shots_on', 'goals_scored', 'goals_conceded', 'assists',
    'passes_total', 'passes_accuracy', 'key_passes',
    'tackles_total', 'interceptions', 'blocks',
    'duels_total', 'duels_won',
    'dribbles_attempts', 'dribbles_success',
    'fouls_committed', 'fouls_drawn',
    'yellow_cards', 'red_cards', 'loaded_at'
  ];

  const rows = [];

  players.forEach(p => {
    rows.push(HEADERS.map(h => safe_(p[h])));
  });

  upsertRowsByKey_(sheetName, HEADERS, rows, ['fixture_id', 'player_id']);
}

function getExistingPlayerStatsPairs_(sheet) {
  const values = sheet.getDataRange().getValues();
  if (values.length <= 1) return {};

  const headers = values[0];
  const fixtureIdx = headers.indexOf('fixture_id');
  const playerIdx  = headers.indexOf('player_id');
  const map = {};

  values.slice(1).forEach(row => {
    const key = `${row[fixtureIdx]}_${row[playerIdx]}`;
    map[key] = true;
  });

  return map;
}

/**
 * Crea la hoja PlayerMatchStats con headers si no existe.
 */
function ensurePlayerStatsSheet_(sheetName) {
  const ss = SpreadsheetApp.openById(getSpreadsheetId_());
  let sheet = ss.getSheetByName(sheetName);

  if (!sheet) {
    sheet = ss.insertSheet(sheetName);
    const headers = [
      'fixture_id', 'player_id', 'player_name', 'team_id', 'team_name',
      'minutes_played', 'rating', 'position', 'captain',
      'shots_total', 'shots_on', 'goals_scored', 'goals_conceded', 'assists',
      'passes_total', 'passes_accuracy', 'key_passes',
      'tackles_total', 'interceptions', 'blocks',
      'duels_total', 'duels_won',
      'dribbles_attempts', 'dribbles_success',
      'fouls_committed', 'fouls_drawn',
      'yellow_cards', 'red_cards', 'loaded_at'
    ];
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    sheet.setFrozenRows(1);
  }

  return sheet;
}
