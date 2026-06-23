/**
 * FinalCanonicalLoaders.gs
 *
 * Carga final Sheets -> Supabase usando Sheets solo como input temporal.
 * No replica hojas ni guarda raw payload en tablas canonicas/analytics.
 */

function finalCanonicalBootstrapApply() {
  if (!isSupabaseConfigured_()) throw new Error('Supabase no configurado.');
  return {
    catalog: seedCompetitionCatalogToSupabase(),
    runtime: supabaseStatus(),
    note: 'Final architecture bootstrap ready. Use final/load-* endpoints; do not use sheet-to-table legacy migration.'
  };
}

function finalCanonicalLoadAllMvpApply() {
  return {
    bootstrap: finalCanonicalBootstrapApply(),
    teams: finalCanonicalLoadTeamsApply(),
    players: finalCanonicalLoadPlayersApply(),
    matches: finalCanonicalLoadMatchesApply(),
    odds: finalCanonicalLoadOddsApply(),
    predictions: finalCanonicalLoadPoissonPredictionsApply(),
    betting: finalCanonicalLoadBettingHistoryApply()
  };
}

function finalCanonicalCleanupTournamentSlotsApply() {
  if (!isSupabaseConfigured_()) throw new Error('Supabase no configurado.');
  const rows = supabaseSelect_('teams', 'select=team_key,display_name,normalized_name&limit=10000');
  const slotKeys = (rows || [])
    .filter(function(row) {
      return isTournamentSlotName_(row.display_name) ||
        isTournamentSlotName_(row.normalized_name) ||
        isTournamentSlotName_(row.team_key);
    })
    .map(function(row) { return String(row.team_key || '').trim(); })
    .filter(Boolean);

  const uniqueKeys = Array.from(new Set(slotKeys));
  if (!uniqueKeys.length) {
    return { tournament_slots_found: 0, cleaned: false };
  }

  const deleted = finalDeleteTeamsByKeys_(uniqueKeys);
  return {
    tournament_slots_found: uniqueKeys.length,
    slot_team_keys: uniqueKeys,
    cleaned: true,
    deleted: deleted
  };
}

function finalCanonicalLoadTeamsApply() {
  if (!isSupabaseConfigured_()) throw new Error('Supabase no configurado.');
  seedCompetitionCatalogToSupabase();

  const teams = {};
  const aliases = {};
  const sourceMappings = {};
  const competitionTeams = {};

  function addTeam(name, row, options) {
    options = options || {};
    if (isTournamentSlotName_(name)) return null;
    const displayName = teamNameToSpanish_(name || '');
    if (isTournamentSlotName_(displayName)) return null;
    const teamKey = canonicalTeamKey_(displayName);
    if (!teamKey) return null;
    teams[teamKey] = {
      team_key: teamKey,
      display_name: displayName,
      normalized_name: normalizeTeamNameStrong_(displayName),
      team_type: options.team_type || finalInferTeamType_(row),
      country_code: safe_(row && (row.country_code || row.codigo_pais || row.pais_codigo)),
      gender: safe_(row && row.gender),
      payload: {},
      updated_at: nowIso_()
    };
    addTeamAlias_(aliases, teamKey, displayName, 'canonical');
    teamAliasVariantsFor_(name).forEach(function(alias) {
      addTeamAlias_(aliases, teamKey, alias, 'known_alias');
    });
    ['nombre', 'equipo', 'team', 'display_name', 'nombre_normalizado'].forEach(function(field) {
      if (row && row[field]) addTeamAlias_(aliases, teamKey, row[field], field);
    });
    addTeamSource_(sourceMappings, teamKey, 'api_football', row && (row.team_id_api_football || row.equipo_id || row.team_id), displayName);
    addTeamSource_(sourceMappings, teamKey, 'football_data', row && row.team_id_football_data, displayName);
    return teamKey;
  }

  readAllFromSheet_(CONFIG.SHEETS.EQUIPOS).forEach(function(row) {
    const name = row.nombre || row.equipo || row.team || row.display_name;
    const teamKey = addTeam(name, row, {});
    const competitionSeasonId = row.competition_season_id || getActiveCompetitionSeasonId_();
    if (teamKey && competitionSeasonId) {
      competitionTeams[competitionSeasonId + '|' + teamKey] = {
        competition_season_id: competitionSeasonId,
        team_key: teamKey,
        group_code: safe_(row.grupo || row.group_code),
        status: 'ACTIVE',
        seed_rating: toNumberOrNull_(row.seed_rating || row.ranking_fifa),
        payload: {},
        updated_at: nowIso_()
      };
    }
  });

  readAllFromSheet_(CONFIG.SHEETS.CLASIFICACION).forEach(function(row) {
    const name = row.equipo || row.team;
    const competitionSeasonId = row.competition_season_id || getActiveCompetitionSeasonId_();
    const teamKey = addTeam(name, row, { team_type: 'NATIONAL_TEAM' });
    if (teamKey && competitionSeasonId) {
      competitionTeams[competitionSeasonId + '|' + teamKey] = {
        competition_season_id: competitionSeasonId,
        team_key: teamKey,
        group_code: safe_(row.grupo || row.group_code),
        status: 'ACTIVE',
        seed_rating: null,
        payload: {},
        updated_at: nowIso_()
      };
    }
  });

  readAllFromSheet_(CONFIG.SHEETS.PARTIDOS).forEach(function(row) {
    const competitionSeasonId = getCompetitionSeasonIdFromFixture_(row);
    [
      { name: row.local || row.equipo_local || row.home_team, group_code: row.grupo || row.group },
      { name: row.visitante || row.equipo_visitante || row.away_team, group_code: row.grupo || row.group }
    ].forEach(function(item) {
      const teamKey = addTeam(item.name, row, { team_type: 'NATIONAL_TEAM' });
      if (!teamKey || !competitionSeasonId) return;
      const key = competitionSeasonId + '|' + teamKey;
      if (!competitionTeams[key]) {
        competitionTeams[key] = {
          competition_season_id: competitionSeasonId,
          team_key: teamKey,
          group_code: safe_(item.group_code),
          status: 'ACTIVE',
          seed_rating: null,
          payload: {},
          updated_at: nowIso_()
        };
      }
    });
  });

  const teamRows = Object.values(teams);
  const aliasRows = Object.values(aliases);
  const sourceRows = Object.values(sourceMappings);
  const competitionRows = Object.values(competitionTeams);

  if (teamRows.length) supabaseUpsert_('teams', teamRows, 'team_key');
  if (aliasRows.length) supabaseUpsert_('team_aliases', aliasRows, 'normalized_alias,source');
  if (sourceRows.length) supabaseUpsert_('source_team_mapping', sourceRows, 'source,source_team_id');
  if (competitionRows.length) supabaseUpsert_('competition_team_mapping', competitionRows, 'competition_season_id,team_key');

  return {
    teams: teamRows.length,
    team_aliases: aliasRows.length,
    source_team_mapping: sourceRows.length,
    competition_team_mapping: competitionRows.length
  };
}

function addTeamAlias_(target, teamKey, alias, source) {
  const raw = String(alias || '').trim();
  const normalized = normalizeTeamNameStrong_(raw);
  if (!teamKey || !normalized) return;
  const key = normalized + '|' + source;
  target[key] = {
    alias_key: hash_([source, normalized].join('|')),
    team_key: teamKey,
    alias: raw,
    normalized_alias: normalized,
    language: '',
    source: source,
    confidence: 1,
    payload: {},
    updated_at: nowIso_()
  };
}

function addTeamSource_(target, teamKey, source, sourceId, sourceName) {
  const id = String(sourceId || '').trim();
  if (!teamKey || !id) return;
  target[source + '|' + id] = {
    source: source,
    source_team_id: id,
    team_key: teamKey,
    competition_season_id: null,
    source_team_name: safe_(sourceName),
    confidence: 1,
    payload: {},
    updated_at: nowIso_()
  };
}

function finalInferTeamType_(row) {
  const raw = String((row && (row.team_type || row.tipo || row.type)) || '').toUpperCase();
  if (raw.indexOf('CLUB') !== -1) return 'CLUB';
  if (raw.indexOf('NATIONAL') !== -1 || raw.indexOf('SELE') !== -1) return 'NATIONAL_TEAM';
  return 'NATIONAL_TEAM';
}

function finalCanonicalLoadPlayersApply() {
  if (!isSupabaseConfigured_()) throw new Error('Supabase no configurado.');

  const players = {};
  const aliases = {};
  const sourceMappings = {};
  const memberships = {};
  const rosters = {};
  const competitionSeasonId = getActiveCompetitionSeasonId_();

  function addPlayer(row) {
    const name = row.jugador || row.nombre || row.player_name;
    const teamName = row.equipo || row.team_name || row.team;
    const playerKey = canonicalPlayerKey_(name, '', row.player_id_api_football || row.player_id || row.jugador_id);
    if (!name || !playerKey) return null;
    players[playerKey] = {
      player_key: playerKey,
      display_name: safe_(name),
      normalized_name: normalizeTeamNameStrong_(name),
      birth_date: toDateOrNull_(row.birth_date || row.fecha_nacimiento),
      nationality_country_code: safe_(row.nationality_country_code || row.nacionalidad_codigo),
      primary_position: safe_(row.posicion || row.position),
      photo_url: safe_(row.foto || row.photo || row.photo_url),
      payload: {},
      updated_at: nowIso_()
    };
    addPlayerAlias_(aliases, playerKey, name, 'canonical');
    addPlayerSource_(sourceMappings, playerKey, 'api_football', row.player_id_api_football || row.player_id || row.jugador_id, name);
    addPlayerSource_(sourceMappings, playerKey, 'football_data', row.player_id_football_data, name);
    if (teamName) {
      const teamKey = canonicalTeamKey_(teamName);
      if (teamKey) {
        const membershipKey = playerKey + '|' + teamKey + '|NATIONAL_TEAM';
        memberships[membershipKey] = {
          player_key: playerKey,
          team_key: teamKey,
          membership_type: 'NATIONAL_TEAM',
          valid_from: null,
          valid_to: null,
          source: 'sheet_seed',
          confidence: 0.7,
          payload: {},
          updated_at: nowIso_()
        };
        rosters[competitionSeasonId + '|' + teamKey + '|' + playerKey] = {
          competition_season_id: competitionSeasonId,
          team_key: teamKey,
          player_key: playerKey,
          shirt_number: toNumberOrNull_(row.numero || row.shirt_number),
          position: safe_(row.posicion || row.position),
          roster_status: 'ACTIVE',
          source: 'sheet_seed',
          payload: {},
          updated_at: nowIso_()
        };
      }
    }
    return playerKey;
  }

  readAllFromSheet_(CONFIG.SHEETS.JUGADORES).forEach(addPlayer);
  readAllFromSheet_(CONFIG.SHEETS.PLANTELES).forEach(addPlayer);

  const playerRows = Object.values(players);
  const aliasRows = Object.values(aliases);
  const sourceRows = Object.values(sourceMappings);
  const membershipRows = Object.values(memberships);
  const rosterRows = Object.values(rosters);

  if (playerRows.length) supabaseUpsert_('players', playerRows, 'player_key');
  if (aliasRows.length) supabaseUpsert_('player_aliases', aliasRows, 'normalized_alias,source');
  if (sourceRows.length) supabaseUpsert_('source_player_mapping', sourceRows, 'source,source_player_id');
  if (membershipRows.length) supabaseRequest_('post', 'team_memberships', membershipRows, { prefer: 'return=minimal' });
  if (rosterRows.length) supabaseUpsert_('competition_rosters', rosterRows, 'competition_season_id,team_key,player_key');

  return {
    players: playerRows.length,
    player_aliases: aliasRows.length,
    source_player_mapping: sourceRows.length,
    team_memberships: membershipRows.length,
    competition_rosters: rosterRows.length
  };
}

function addPlayerAlias_(target, playerKey, alias, source) {
  const raw = String(alias || '').trim();
  const normalized = normalizeTeamNameStrong_(raw);
  if (!playerKey || !normalized) return;
  target[normalized + '|' + source] = {
    alias_key: hash_([source, normalized].join('|')),
    player_key: playerKey,
    alias: raw,
    normalized_alias: normalized,
    language: '',
    source: source,
    confidence: 1,
    payload: {},
    updated_at: nowIso_()
  };
}

function addPlayerSource_(target, playerKey, source, sourceId, sourceName) {
  const id = String(sourceId || '').trim();
  if (!playerKey || !id) return;
  target[source + '|' + id] = {
    source: source,
    source_player_id: id,
    player_key: playerKey,
    source_player_name: safe_(sourceName),
    confidence: 1,
    payload: {},
    updated_at: nowIso_()
  };
}

function finalCanonicalLoadMatchesApply() {
  if (!isSupabaseConfigured_()) throw new Error('Supabase no configurado.');
  const matchRows = [];
  const sourceRows = [];
  const missingTeams = {};
  readAllFromSheet_(CONFIG.SHEETS.PARTIDOS).forEach(function(row) {
    const matchId = ensureMatchIdFromRow_(row);
    if (!matchId) return;
    const competitionSeasonId = getCompetitionSeasonIdFromFixture_(row);
    const homeRaw = row.local || row.equipo_local || row.home_team || '';
    const awayRaw = row.visitante || row.equipo_visitante || row.away_team || '';
    const homeIsSlot = isTournamentSlotName_(homeRaw);
    const awayIsSlot = isTournamentSlotName_(awayRaw);
    const homeName = homeIsSlot ? tournamentSlotLabel_(homeRaw) : teamNameToSpanish_(homeRaw);
    const awayName = awayIsSlot ? tournamentSlotLabel_(awayRaw) : teamNameToSpanish_(awayRaw);
    const homeTeamKey = homeIsSlot ? null : canonicalTeamKey_(homeName);
    const awayTeamKey = awayIsSlot ? null : canonicalTeamKey_(awayName);
    if (!homeIsSlot) finalCollectMinimalTeam_(missingTeams, homeTeamKey, homeName, competitionSeasonId, row.grupo || row.group);
    if (!awayIsSlot) finalCollectMinimalTeam_(missingTeams, awayTeamKey, awayName, competitionSeasonId, row.grupo || row.group);
    matchRows.push({
      match_id: matchId,
      competition_id: competitionSeasonId,
      competition_season_id: competitionSeasonId,
      season: toNumberOrNull_(row.season) || getActiveLeague_().season || null,
      match_key: safe_(row.match_key || matchId),
      date: normalizeFecha_(row.fecha || row.fecha_chile || row.date || ''),
      kickoff_chile: safeHoraChile_(row.hora_chile || row.hora || ''),
      kickoff_utc: toIsoOrNull_(row.hora_utc || row.kickoff_utc),
      stage: safe_(row.fase || row.ronda || ''),
      match_type: getMatchTypeFromFixture_(row),
      group_code: safe_(row.grupo || row.group || ''),
      home_team_key: homeTeamKey,
      home_team_name: homeName,
      away_team_key: awayTeamKey,
      away_team_name: awayName,
      venue_name: safe_(row.estadio),
      venue_city: safe_(row.ciudad),
      venue_country: safe_(row.pais_estadio || row.pais || row.pais_torneo),
      venue_id: safe_(row.venue_id),
      lat: toNumberOrNull_(row.lat),
      lon: toNumberOrNull_(row.lon),
      home_score: toNumberOrNull_(row.goles_local),
      away_score: toNumberOrNull_(row.goles_visitante),
      status: safe_(row.status || row.estado || 'NS'),
      winner: safe_(row.winner),
      source: safe_(row.fuente || 'sheet_seed'),
      sources_used: safe_(row.sources_used),
      confidence_score: toNumberOrNull_(row.confidence_score),
      has_conflict: toBool_(row.has_conflict),
      conflict_detail: safe_(row.conflict_detail),
      data_quality_notes: safe_(row.data_quality_notes),
      payload: {},
      updated_at: nowIso_()
    });
    addMatchSource_(sourceRows, matchId, 'api_football', row.fixture_id_api_football || row.fixture_id_af, 1);
    addMatchSource_(sourceRows, matchId, 'football_data', row.match_id_football_data || row.fixture_id_fd, 1);
    addMatchSource_(sourceRows, matchId, 'espn', row.espn_event_id || row.espn_id, 1);
  });
  const teamSeed = finalBuildMinimalTeamSeed_(missingTeams);
  if (teamSeed.teams.length) supabaseUpsert_('teams', teamSeed.teams, 'team_key');
  if (teamSeed.aliases.length) supabaseUpsert_('team_aliases', teamSeed.aliases, 'normalized_alias,source');
  if (teamSeed.competitionTeams.length) supabaseUpsert_('competition_team_mapping', teamSeed.competitionTeams, 'competition_season_id,team_key');
  const dedupedMatches = finalDedupeRowsByKey_(matchRows, ['match_id']);
  const dedupedSources = finalDedupeRowsByKey_(sourceRows, ['source', 'source_match_id']);
  if (dedupedMatches.length) supabaseUpsert_('matches', dedupedMatches, 'match_id');
  if (dedupedSources.length) supabaseUpsert_('match_source_ids', dedupedSources, 'source,source_match_id');
  return {
    matches: dedupedMatches.length,
    match_source_ids: dedupedSources.length,
    minimal_teams_seeded: teamSeed.teams.length,
    source_rows: matchRows.length,
    duplicate_matches_removed: matchRows.length - dedupedMatches.length
  };
}

function finalCollectMinimalTeam_(target, teamKey, displayName, competitionSeasonId, groupCode) {
  if (!teamKey || !displayName) return;
  const key = competitionSeasonId + '|' + teamKey;
  target[key] = {
    competition_season_id: competitionSeasonId,
    team_key: teamKey,
    display_name: displayName,
    group_code: safe_(groupCode)
  };
}

function finalBuildMinimalTeamSeed_(teamsByCompetition) {
  const teams = {};
  const aliases = {};
  const competitionTeams = {};
  Object.keys(teamsByCompetition || {}).forEach(function(key) {
    const item = teamsByCompetition[key];
    teams[item.team_key] = {
      team_key: item.team_key,
      display_name: item.display_name,
      normalized_name: normalizeTeamNameStrong_(item.display_name),
      team_type: 'NATIONAL_TEAM',
      country_code: '',
      gender: '',
      payload: {},
      updated_at: nowIso_()
    };
    addTeamAlias_(aliases, item.team_key, item.display_name, 'canonical');
    competitionTeams[key] = {
      competition_season_id: item.competition_season_id,
      team_key: item.team_key,
      group_code: item.group_code,
      status: 'ACTIVE',
      seed_rating: null,
      payload: {},
      updated_at: nowIso_()
    };
  });
  return {
    teams: Object.values(teams),
    aliases: Object.values(aliases),
    competitionTeams: Object.values(competitionTeams)
  };
}

function finalDeleteTeamsByKeys_(teamKeys) {
  const result = {
    matches_home_cleared: 0,
    matches_away_cleared: 0,
    team_aliases_deleted: 0,
    source_team_mapping_deleted: 0,
    competition_team_mapping_deleted: 0,
    teams_deleted: 0
  };
  finalChunk_(teamKeys, 50).forEach(function(keys) {
    const filter = 'team_key=in.(' + keys.join(',') + ')';
    const homeFilter = 'home_team_key=in.(' + keys.join(',') + ')';
    const awayFilter = 'away_team_key=in.(' + keys.join(',') + ')';

    result.matches_home_cleared += finalCountResponse_(supabaseRequest_('patch', 'matches', { home_team_key: null }, {
      query: homeFilter,
      prefer: 'return=representation'
    }));
    result.matches_away_cleared += finalCountResponse_(supabaseRequest_('patch', 'matches', { away_team_key: null }, {
      query: awayFilter,
      prefer: 'return=representation'
    }));
    result.team_aliases_deleted += finalCountResponse_(supabaseRequest_('delete', 'team_aliases', null, {
      query: filter,
      prefer: 'return=representation'
    }));
    result.rating_snapshots_deleted = (result.rating_snapshots_deleted || 0) + finalTryDeleteByFilter_('rating_snapshots', filter);
    result.team_memberships_deleted = (result.team_memberships_deleted || 0) + finalTryDeleteByFilter_('team_memberships', filter);
    result.competition_rosters_deleted = (result.competition_rosters_deleted || 0) + finalTryDeleteByFilter_('competition_rosters', filter);
    result.match_lineups_deleted = (result.match_lineups_deleted || 0) + finalTryDeleteByFilter_('match_lineups', filter);
    result.match_events_cleared = (result.match_events_cleared || 0) + finalTryPatchByFilter_('match_events', filter, { team_key: null });
    result.source_team_mapping_deleted += finalCountResponse_(supabaseRequest_('delete', 'source_team_mapping', null, {
      query: filter,
      prefer: 'return=representation'
    }));
    result.competition_team_mapping_deleted += finalCountResponse_(supabaseRequest_('delete', 'competition_team_mapping', null, {
      query: filter,
      prefer: 'return=representation'
    }));
    result.teams_deleted += finalCountResponse_(supabaseRequest_('delete', 'teams', null, {
      query: filter,
      prefer: 'return=representation'
    }));
  });
  return result;
}

function finalTryDeleteByFilter_(table, query) {
  try {
    return finalCountResponse_(supabaseRequest_('delete', table, null, {
      query: query,
      prefer: 'return=representation'
    }));
  } catch (e_) {
    return 0;
  }
}

function finalTryPatchByFilter_(table, query, payload) {
  try {
    return finalCountResponse_(supabaseRequest_('patch', table, payload, {
      query: query,
      prefer: 'return=representation'
    }));
  } catch (e_) {
    return 0;
  }
}

function finalCountResponse_(response) {
  return Array.isArray(response) ? response.length : 0;
}

function finalChunk_(items, size) {
  const chunks = [];
  for (let i = 0; i < items.length; i += size) chunks.push(items.slice(i, i + size));
  return chunks;
}

function addMatchSource_(target, matchId, source, sourceId, confidence) {
  const id = String(sourceId || '').trim();
  if (!matchId || !id) return;
  target.push({
    match_id: matchId,
    source: source,
    source_match_id: id,
    confidence: confidence || 1,
    mapping_method: 'sheet_seed',
    payload: {},
    updated_at: nowIso_()
  });
}

function finalCanonicalLoadOddsApply() {
  if (!isSupabaseConfigured_()) throw new Error('Supabase no configurado.');
  const rows = [];
  readAllFromSheet_(CONFIG.SHEETS.ODDS).forEach(function(row) {
    const matchId = ensureMatchIdFromRow_(row);
    const market = safe_(row.mercado || row.market);
    const selection = safe_(row.seleccion || row.selection);
    if (!matchId || !market || !selection) return;
    rows.push({
      match_id: matchId,
      competition_season_id: getCompetitionSeasonIdFromFixture_(row),
      bookmaker: safe_(row.fuente || row.bookmaker || 'unknown'),
      market: market,
      selection: selection,
      line: toNumberOrNull_(row.linea || row.line),
      decimal_odds: toNumberOrNull_(row.cuota || row.cuota_real || row.odds),
      implied_probability: toNumberOrNull_(row.probabilidad_implicita || row.probabilidad_mercado || row.implied_probability),
      bookmaker_count: toNumberOrNull_(row.bookmakers_count || row.bookmaker_count),
      market_quality_score: toNumberOrNull_(row.market_quality_score),
      liquidity_tier: safe_(row.liquidity_tier),
      odds_volatility: toNumberOrNull_(row.odds_volatility),
      captured_at: toIsoOrNull_(row.timestamp || row.captured_at) || nowIso_(),
      is_closing: toBool_(row.is_closing) === true,
      payload: {}
    });
  });
  const deduped = finalDedupeRowsByKey_(rows, ['match_id', 'bookmaker', 'market', 'selection', 'captured_at']);
  if (deduped.length) supabaseUpsert_('odds_snapshots', deduped, 'match_id,bookmaker,market,selection,captured_at');
  return { odds_snapshots: deduped.length, source_rows: rows.length, duplicates_removed: rows.length - deduped.length };
}

function finalCanonicalLoadPoissonPredictionsApply() {
  if (!isSupabaseConfigured_()) throw new Error('Supabase no configurado.');
  const run = finalCreateModelRun_('POISSON_DC', 'v1', '1X2');
  const predictions = [];
  readAllFromSheet_(CONFIG.SHEETS.POISSON_ODDS).forEach(function(row) {
    const matchId = ensureMatchIdFromRow_(row);
    if (!matchId) return;
    const competitionSeasonId = getCompetitionSeasonIdFromFixture_(row);
    const asOf = toIsoOrNull_(row.updated_at || row.timestamp || row.run_at) || nowIso_();
    [
      { selection: 'HOME', p: row.prob_local || row.prob_home || row.home_prob },
      { selection: 'DRAW', p: row.prob_empate || row.prob_draw || row.draw_prob },
      { selection: 'AWAY', p: row.prob_visitante || row.prob_away || row.away_prob }
    ].forEach(function(item) {
      const p = toNumberOrNull_(item.p);
      if (p === null) return;
      predictions.push({
        model_run_id: run.model_run_id,
        competition_season_id: competitionSeasonId,
        match_id: matchId,
        match_type: getMatchTypeFromFixture_(row),
        market: '1X2',
        selection: item.selection,
        raw_probability: p,
        calibrated_probability: p,
        fair_odds: p > 0 ? 1 / p : null,
        as_of: asOf,
        flags: [],
        payload: {}
      });
    });
  });
  const deduped = finalDedupeRowsByKey_(predictions, ['model_run_id', 'match_id', 'market', 'selection', 'as_of']);
  if (deduped.length) supabaseUpsert_('model_predictions', deduped, 'model_run_id,match_id,market,selection,as_of');
  return {
    model_run_id: run.model_run_id,
    model_predictions: deduped.length,
    source_rows: predictions.length,
    duplicates_removed: predictions.length - deduped.length
  };
}

function finalCreateModelRun_(modelName, modelVersion, market) {
  const rows = supabaseRequest_('post', 'model_runs', [{
    model_name: modelName,
    model_version: modelVersion,
    competition_season_id: getActiveCompetitionSeasonId_(),
    market: market,
    feature_set_version: (typeof FEATURE_SET_VERSION_DEFAULT !== 'undefined' ? FEATURE_SET_VERSION_DEFAULT : 'v1'),
    calibration_method: 'none_seed',
    git_sha: '',
    params: {}
  }], { prefer: 'return=representation' });
  return rows && rows[0] ? rows[0] : {};
}

function finalCanonicalLoadBettingHistoryApply() {
  if (!isSupabaseConfigured_()) throw new Error('Supabase no configurado.');
  const rows = [];
  readAllFromSheet_(CONFIG.SHEETS.BETTING_HISTORY).forEach(function(row) {
    const betId = safe_(row.bet_id) || hash_(JSON.stringify([
      row.fecha, row.local, row.visitante, row.mercado, row.seleccion, row.cuota, row.stake
    ]));
    rows.push({
      bet_id: betId,
      betting_decision_id: null,
      bet_mode: String(row.bet_mode || row.modo || 'PAPER').toUpperCase() === 'REAL' ? 'REAL' : 'PAPER',
      pick_key: safe_(row.pick_key),
      match_id: ensureMatchIdFromRow_(row),
      market: safe_(row.mercado || row.market),
      selection: safe_(row.seleccion || row.selection),
      decimal_odds: toNumberOrNull_(row.cuota || row.decimal_odds),
      decimal_odds_taken: toNumberOrNull_(row.cuota || row.decimal_odds_taken),
      model_probability: toNumberOrNull_(row.prob_modelo || row.model_probability),
      ev: toNumberOrNull_(row.ev),
      kelly_fraction: toNumberOrNull_(row.kelly || row.kelly_fraction),
      stake: toNumberOrNull_(row.stake),
      result: safe_(row.resultado || row.result),
      profit_loss: toNumberOrNull_(row.profit_loss),
      roi_accumulated: toNumberOrNull_(row.roi_acum),
      notes: safe_(row.notas || row.notes),
      taken_at: toIsoOrNull_(row.fecha || row.taken_at) || nowIso_(),
      placed_at: toIsoOrNull_(row.placed_at || row.fecha) || null,
      settled_at: toIsoOrNull_(row.settled_at || row.resolved_at) || null,
      payload: {}
    });
  });
  if (rows.length) supabaseUpsert_('bets', rows, 'bet_id');
  return { bets: rows.length };
}

function toDateOrNull_(value) {
  const iso = toIsoOrNull_(value);
  return iso ? iso.substring(0, 10) : null;
}

function finalDedupeRowsByKey_(rows, keyColumns) {
  const byKey = {};
  const ordered = [];
  (rows || []).forEach(function(row) {
    const key = (keyColumns || []).map(function(col) {
      return row[col] === null || row[col] === undefined ? '' : String(row[col]);
    }).join('|');
    if (!key || key.replace(/\|/g, '') === '') return;
    if (!byKey[key]) ordered.push(key);
    byKey[key] = row;
  });
  return ordered.map(function(key) { return byKey[key]; });
}
